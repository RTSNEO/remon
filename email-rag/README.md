# Local Email RAG (Retrieval-Augmented Generation)

A standalone Python application that securely connects to your Microsoft 365 / Outlook account via IMAP, downloads your emails locally, stores them in a local vector database (ChromaDB), and allows you to ask questions about your emails using a completely local, free, open-source AI model (Ollama).

**Your data never leaves your computer.**

## Features
*   **Secure IMAP Connection:** Fetches emails in the background directly from Outlook.
*   **Local Vector Database:** Uses ChromaDB to store and instantly search thousands of emails.
*   **Local AI (Ollama):** Uses Ollama to run embedding and chat models (like Llama 3) entirely offline.
*   **Web Interface:** Built with Streamlit for a clean, intuitive chat experience.
*   **Background Sync:** Continuously checks for new emails while the app is running.

## Requirements
*   Python 3.10+
*   [Ollama](https://ollama.com/) installed and running on your machine.
*   An Outlook / Microsoft 365 account with an App Password (or OAuth2 setup).

## Setup Instructions

### 1. Install Ollama and Download Models
1.  Download and install Ollama from [ollama.com](https://ollama.com/).
2.  Open your terminal/command prompt and download the required models:
    ```bash
    # Download the chat model (Llama 3 is recommended for speed/quality)
    ollama pull llama3

    # Download the embedding model (Nomic Embed Text is fast and designed for RAG)
    ollama pull nomic-embed-text
    ```
3.  Ensure Ollama is running in the background (usually runs automatically on startup, accessible at `http://localhost:11434`).

### 2. Install Python Dependencies
Open your terminal, navigate to this `email-rag` folder, and install the requirements:
```bash
pip install -r requirements.txt
```

### 3. Configure Your Email Account
You need to provide your email address and an App Password.
*Note: Microsoft 365 accounts often require App Passwords if Two-Factor Authentication is enabled. If your organization has disabled Basic Authentication entirely, you will need to use OAuth2. See `README-OAUTH2.md` for instructions.*

1.  Create a file named `.env` in this directory.
2.  Add your credentials to the `.env` file:
    ```env
    EMAIL_ADDRESS="your.email@outlook.com"
    EMAIL_PASSWORD="your-app-password-here"
    ```

### 4. Run the Application
Start the Streamlit web server:
```bash
streamlit run app.py
```

This will automatically open the web interface in your default browser (usually at `http://localhost:8501`).

## How to Use
1.  **Start Syncing:** When you first open the app, click the **"▶️ Start Background Sync"** button in the sidebar. This will begin downloading your most recent emails and adding them to the local database.
2.  **Wait for Processing:** The first sync might take a few minutes depending on how many emails it is fetching. You can see the "Total Synced Emails" counter increase in the sidebar.
3.  **Ask Questions:** Once emails are synced, use the chat box at the bottom to ask questions like:
    *   *"What did Sarah say about the marketing budget last week?"*
    *   *"Summarize the updates from the project status meeting."*
    *   *"When is my flight to New York based on my flight confirmation email?"*

## Architecture Overview
*   `app.py`: The Streamlit frontend UI.
*   `email_fetcher.py`: Handles connecting to Outlook via IMAP and parsing email content. Runs a background thread via the `schedule` library.
*   `database.py`: Initializes the local ChromaDB vector store and uses LangChain to generate embeddings via Ollama.
*   `rag_engine.py`: Constructs the LangChain RAG pipeline. It takes your question, searches ChromaDB for relevant emails, and passes them to the Ollama chat model to generate an answer.
*   `config.py`: Centralized configuration settings.

## Troubleshooting
*   **"Ollama not found" error:** Make sure the Ollama application is actually running on your computer.
*   **IMAP Authentication Error:** Double-check your `.env` file. Ensure you are using an App Password, not your regular account password (if 2FA is enabled). If your organization blocks IMAP, see the OAuth2 fallback guide.
*   **Slow responses:** Local AI models require significant CPU/RAM. If generation is slow, make sure you are using a smaller model (like `phi3` or `llama3`) and close other heavy applications.
