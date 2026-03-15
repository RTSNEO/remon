import streamlit as st
import os
from rag_engine import ask_question
from database import db_instance
from email_fetcher import start_background_sync
from config import OLLAMA_BASE_URL, EMBEDDING_MODEL, CHAT_MODEL

st.set_page_config(page_title="Local Email RAG", page_icon="📧", layout="wide")

st.title("📧 Local Email AI Assistant")
st.markdown("Ask questions about your Outlook emails, entirely offline and private.")

# --- Session State Initialization ---
if "messages" not in st.session_state:
    st.session_state.messages = [
        {"role": "assistant", "content": "Hello! I have access to your synced emails. What would you like to know?"}
    ]

if "sync_thread" not in st.session_state:
    st.session_state.sync_thread = None

# --- Sidebar Configuration & Status ---
with st.sidebar:
    st.header("⚙️ Configuration")

    # 1. Check Ollama Status
    import requests
    try:
        response = requests.get(OLLAMA_BASE_URL)
        if response.status_code == 200:
            st.success(f"🟢 Ollama is running ({OLLAMA_BASE_URL})")
        else:
            st.error(f"🔴 Ollama error: {response.status_code}")
    except requests.exceptions.ConnectionError:
        st.error(f"🔴 Ollama not found at {OLLAMA_BASE_URL}. Please start Ollama locally.")
        st.info(f"Make sure you have pulled the models: \n`ollama pull {CHAT_MODEL}` \n`ollama pull {EMBEDDING_MODEL}`")

    st.divider()

    # 2. Sync Controls
    st.header("🔄 Email Sync")
    st.write("Background sync fetches new emails from Outlook and adds them to your local database.")

    if st.session_state.sync_thread is None or not st.session_state.sync_thread.is_alive():
        if st.button("▶️ Start Background Sync", type="primary"):
            st.session_state.sync_thread = start_background_sync(db_instance.add_email)
            st.rerun()
    else:
        st.success("🟢 Background Sync is Active")
        st.info("Emails are being fetched periodically.")

    st.divider()

    # 3. Database Stats
    st.header("🗄️ Database")
    try:
        # ChromaDB `count` returns the number of embeddings
        num_emails = db_instance.collection.count()
        st.metric(label="Total Synced Emails", value=num_emails)
    except Exception as e:
        st.write(f"Error checking database: {e}")

# --- Main Chat Interface ---

# Display chat messages from history on app rerun
for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

# React to user input
if prompt := st.chat_input("Ask about your emails... (e.g., 'What did John say about the project?')"):
    # Display user message in chat message container
    st.chat_message("user").markdown(prompt)

    # Add user message to chat history
    st.session_state.messages.append({"role": "user", "content": prompt})

    # Generate response from RAG
    with st.chat_message("assistant"):
        with st.spinner("Searching your emails and generating answer..."):
            try:
                # Call the RAG pipeline
                answer, sources = ask_question(prompt)

                # Display the answer
                st.markdown(answer)

                # Add to chat history
                st.session_state.messages.append({"role": "assistant", "content": answer})

                # Display Expandable Sources
                if sources:
                    with st.expander("Show Source Emails"):
                        for i, doc in enumerate(sources):
                            st.markdown(f"**Source {i+1}: {doc['metadata'].get('subject', 'No Subject')}**")
                            st.markdown(f"**From:** {doc['metadata'].get('from', 'Unknown')} | **Date:** {doc['metadata'].get('date', 'Unknown')}")
                            st.text(doc['content'][:500] + "..." if len(doc['content']) > 500 else doc['content'])
                            st.divider()

            except Exception as e:
                error_msg = f"An error occurred: {str(e)}\n\nPlease ensure Ollama is running and models are downloaded."
                st.error(error_msg)
                st.session_state.messages.append({"role": "assistant", "content": error_msg})
