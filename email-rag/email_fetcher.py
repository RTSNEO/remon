import imaplib
import email
from email.header import decode_header
import html2text
from bs4 import BeautifulSoup
import logging
import schedule
import time
import threading
from config import IMAP_SERVER, EMAIL_ADDRESS, EMAIL_PASSWORD, SYNC_INTERVAL_MINUTES

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# To prevent re-processing emails, we can store parsed Message-IDs
# In a real app, this should be a persistent database table or part of ChromaDB metadata
PROCESSED_EMAILS_FILE = "processed_emails.txt"

def get_processed_emails():
    try:
        with open(PROCESSED_EMAILS_FILE, "r") as f:
            return set(f.read().splitlines())
    except FileNotFoundError:
        return set()

def save_processed_email(message_id):
    with open(PROCESSED_EMAILS_FILE, "a") as f:
        f.write(f"{message_id}\n")

def decode_mime_header(header_value):
    """Decodes a MIME-encoded header string."""
    if not header_value:
        return ""

    decoded_parts = decode_header(header_value)
    result = ""
    for part, encoding in decoded_parts:
        if isinstance(part, bytes):
            if encoding:
                try:
                    result += part.decode(encoding)
                except UnicodeDecodeError:
                    result += part.decode("utf-8", errors="replace")
            else:
                result += part.decode("utf-8", errors="replace")
        else:
            result += part
    return result

def extract_body(msg):
    """Extracts text content from an email message."""
    body = ""

    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition"))

            # Skip attachments
            if "attachment" in content_disposition:
                continue

            if content_type == "text/plain":
                try:
                    body += part.get_payload(decode=True).decode("utf-8", errors="replace")
                except:
                    pass
            elif content_type == "text/html":
                try:
                    html = part.get_payload(decode=True).decode("utf-8", errors="replace")
                    # Convert HTML to Markdown-like text for better LLM processing
                    h = html2text.HTML2Text()
                    h.ignore_links = False
                    h.ignore_images = True
                    body += h.handle(html)
                except:
                    pass
    else:
        # Not multipart
        content_type = msg.get_content_type()
        try:
            payload = msg.get_payload(decode=True).decode("utf-8", errors="replace")
            if content_type == "text/html":
                h = html2text.HTML2Text()
                h.ignore_links = False
                h.ignore_images = True
                body = h.handle(payload)
            else:
                body = payload
        except:
            pass

    return body.strip()

def fetch_recent_emails(db_add_callback, limit=None):
    """Connects to IMAP, fetches recent emails, and passes them to a callback."""
    if not EMAIL_ADDRESS or not EMAIL_PASSWORD:
        logger.error("Email address or password not configured in config.py or .env")
        return

    logger.info(f"Connecting to {IMAP_SERVER} as {EMAIL_ADDRESS}...")
    try:
        # Create an IMAP4 class with SSL
        mail = imaplib.IMAP4_SSL(IMAP_SERVER)
        # Authenticate
        mail.login(EMAIL_ADDRESS, EMAIL_PASSWORD)

        # Select the mailbox (Inbox)
        mail.select('inbox')

        # Search for all emails
        status, data = mail.search(None, 'ALL')

        if status != 'OK':
            logger.error(f"Failed to search mailbox: {status}")
            return

        mail_ids = data[0].split()

        if not mail_ids:
            logger.info("No emails found.")
            return

        # If a limit is provided, fetch only the most recent N emails
        if limit is not None:
            mail_ids = mail_ids[-limit:]

        processed_ids = get_processed_emails()
        new_emails_processed = 0

        for e_id in mail_ids:
            # Use (BODY.PEEK[]) to prevent marking the email as read
            status, msg_data = mail.fetch(e_id, '(BODY.PEEK[])')
            if status != 'OK':
                continue

            for response_part in msg_data:
                if isinstance(response_part, tuple):
                    # Parse the raw email bytes
                    msg = email.message_from_bytes(response_part[1])

                    message_id = msg.get("Message-ID", "")
                    if message_id in processed_ids:
                        continue # Skip already processed emails

                    subject = decode_mime_header(msg.get("Subject", ""))
                    from_ = decode_mime_header(msg.get("From", ""))
                    to_ = decode_mime_header(msg.get("To", ""))
                    date_ = msg.get("Date", "")

                    body = extract_body(msg)

                    if body:
                        # Call the provided callback to add to vector database
                        metadata = {
                            "message_id": message_id,
                            "subject": subject,
                            "from": from_,
                            "to": to_,
                            "date": date_
                        }

                        logger.info(f"Processing new email: {subject} from {from_}")
                        db_add_callback(body, metadata)

                        save_processed_email(message_id)
                        new_emails_processed += 1

        logger.info(f"Finished fetching. Processed {new_emails_processed} new emails.")
        mail.close()
        mail.logout()

    except Exception as e:
        logger.error(f"Error fetching emails: {e}")

def _run_scheduler(db_add_callback):
    """Background thread function to run the schedule."""
    # First run: Fetch ALL emails
    logger.info("Starting initial full sync of all emails...")
    fetch_recent_emails(db_add_callback, limit=None)

    # Schedule subsequent runs to fetch only the most recent emails
    schedule.every(SYNC_INTERVAL_MINUTES).minutes.do(fetch_recent_emails, db_add_callback, limit=50)

    while True:
        schedule.run_pending()
        time.sleep(60) # Check every minute if a job is due

def start_background_sync(db_add_callback):
    """Starts the background thread that periodically fetches emails."""
    logger.info(f"Starting background email sync (every {SYNC_INTERVAL_MINUTES} minutes).")
    sync_thread = threading.Thread(target=_run_scheduler, args=(db_add_callback,), daemon=True)
    sync_thread.start()
    return sync_thread
