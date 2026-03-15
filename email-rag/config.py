import os
from dotenv import load_dotenv

load_dotenv()

# IMAP Configuration
IMAP_SERVER = "outlook.office365.com"
EMAIL_ADDRESS = os.getenv("EMAIL_ADDRESS", "")
# Use an App Password if using Basic Auth, or an Access Token if using OAuth2
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD", "")

# ChromaDB Configuration
CHROMA_DB_DIR = "./chroma_db"
COLLECTION_NAME = "outlook_emails"

# Ollama Configuration
OLLAMA_BASE_URL = "http://localhost:11434"
# Embedding model to use. Recommend: nomic-embed-text or mxbai-embed-large
EMBEDDING_MODEL = "nomic-embed-text"
# Chat model to use. Recommend: llama3 or phi3
CHAT_MODEL = "llama3"

# Background Sync Interval (in minutes)
SYNC_INTERVAL_MINUTES = 15
