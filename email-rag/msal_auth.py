import os
from dotenv import load_dotenv
import msal
import imaplib

load_dotenv()

# OAuth2 Configuration for Microsoft 365 IMAP
CLIENT_ID = os.getenv("CLIENT_ID", "") # Your Application (client) ID from Azure
# Optional: Use if you are a multi-tenant app, or common/consumers
TENANT_ID = os.getenv("TENANT_ID", "common")
# Optional: Use if server-to-server auth is needed
CLIENT_SECRET = os.getenv("CLIENT_SECRET", "")
# Needs offline_access for refresh tokens, and IMAP.AccessAsUser.All
SCOPES = ["https://outlook.office365.com/IMAP.AccessAsUser.All", "offline_access"]
# The URL where Azure will redirect you to get the code
REDIRECT_URI = "http://localhost:8080" # Make sure this matches Azure App Registration

def get_oauth2_access_token():
    """
    Acquires an OAuth2 Access Token for Microsoft 365 IMAP using MSAL.
    This opens a web browser for interactive login.
    """
    if not CLIENT_ID:
        raise ValueError("CLIENT_ID must be set in your .env file or config.py")

    # Using PublicClientApplication for desktop interactive login
    app = msal.PublicClientApplication(
        CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{TENANT_ID}"
    )

    # Try to get token from cache silently first
    accounts = app.get_accounts()
    result = None
    if accounts:
        print("Found existing account, attempting silent login...")
        result = app.acquire_token_silent(SCOPES, account=accounts[0])

    # If no token in cache, prompt interactive login
    if not result:
        print("No cached token found. Opening browser for interactive login...")
        # Note: You can also use acquire_token_by_device_flow() for headless environments
        result = app.acquire_token_interactive(
            scopes=SCOPES,
            port=8080 # Matches REDIRECT_URI
        )

    if "access_token" in result:
        print("Successfully acquired access token.")
        return result["access_token"]
    else:
        print(f"Error acquiring token: {result.get('error')}")
        print(f"Description: {result.get('error_description')}")
        return None

def generate_oauth2_string(username, access_token):
    """
    Generates the properly formatted base64 string required for IMAP AUTHENTICATE XOAUTH2.
    Format: user={user}\x01auth=Bearer {token}\x01\x01
    """
    auth_string = f"user={username}\x01auth=Bearer {access_token}\x01\x01"
    return auth_string

def test_imap_oauth2_connection(username, access_token):
    """
    Tests an IMAP connection using an OAuth2 access token.
    """
    try:
        imap = imaplib.IMAP4_SSL('outlook.office365.com')

        # Authenticate using XOAUTH2
        auth_string = generate_oauth2_string(username, access_token)
        # imaplib expects the auth string to be encoded
        imap.authenticate('XOAUTH2', lambda x: auth_string.encode('utf-8'))

        print("Successfully authenticated with IMAP via OAuth2!")

        # Select mailbox and get count
        status, response = imap.select('INBOX')
        if status == 'OK':
            print(f"INBOX contains {response[0].decode()} emails.")

        imap.close()
        imap.logout()
        return True

    except Exception as e:
        print(f"Failed to connect via IMAP OAuth2: {e}")
        return False

if __name__ == "__main__":
    print("--- Microsoft 365 OAuth2 IMAP Authenticator ---")

    email_address = os.getenv("EMAIL_ADDRESS", input("Enter your Outlook email address: "))

    if email_address:
        print("\nAttempting to acquire token...")
        token = get_oauth2_access_token()

        if token:
            print("\nAttempting IMAP connection test...")
            test_imap_oauth2_connection(email_address, token)

            print("\nTo use this token in the main app, you would need to replace `mail.login(EMAIL_ADDRESS, EMAIL_PASSWORD)`")
            print("in `email_fetcher.py` with:")
            print("  auth_string = f'user={EMAIL_ADDRESS}\\x01auth=Bearer {access_token}\\x01\\x01'")
            print("  mail.authenticate('XOAUTH2', lambda x: auth_string.encode('utf-8'))")
    else:
        print("Please provide an email address.")
