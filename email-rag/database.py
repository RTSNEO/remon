import os
import chromadb
from chromadb.config import Settings
from langchain_community.embeddings import OllamaEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_core.documents import Document
from config import CHROMA_DB_DIR, COLLECTION_NAME, OLLAMA_BASE_URL, EMBEDDING_MODEL

# Ensure the database directory exists
os.makedirs(CHROMA_DB_DIR, exist_ok=True)

class VectorDatabase:
    def __init__(self):
        # Initialize the local embedding model via Ollama
        self.embeddings = OllamaEmbeddings(
            base_url=OLLAMA_BASE_URL,
            model=EMBEDDING_MODEL
        )

        # Initialize ChromaDB client pointing to our local directory
        self.client = chromadb.PersistentClient(path=CHROMA_DB_DIR)

        # Get or create the collection for storing emails
        self.collection = self.client.get_or_create_collection(name=COLLECTION_NAME)

        # Create a LangChain vector store wrapper
        self.vector_store = Chroma(
            client=self.client,
            collection_name=COLLECTION_NAME,
            embedding_function=self.embeddings,
        )

    def add_email(self, content: str, metadata: dict):
        """Adds a new email to the vector database."""
        # Clean up metadata (ChromaDB requires metadata values to be strings, ints, or floats)
        safe_metadata = {}
        for k, v in metadata.items():
            if isinstance(v, (str, int, float, bool)):
                safe_metadata[k] = v
            elif v is None:
                safe_metadata[k] = ""
            else:
                safe_metadata[k] = str(v)

        # Generate an ID based on the Message-ID or create a random one
        doc_id = safe_metadata.get("message_id", "")
        if not doc_id:
            import uuid
            doc_id = str(uuid.uuid4())

        document = Document(page_content=content, metadata=safe_metadata)

        # Add to the vector store
        # The Ollama embeddings will be automatically generated and stored by LangChain/Chroma
        self.vector_store.add_documents([document], ids=[doc_id])

    def search(self, query: str, k: int = 5):
        """Searches the database for the most relevant emails."""
        # Perform a similarity search
        results = self.vector_store.similarity_search_with_score(query, k=k)

        # Process and return the results
        formatted_results = []
        for doc, score in results:
            formatted_results.append({
                "content": doc.page_content,
                "metadata": doc.metadata,
                "score": score # Lower score usually means higher similarity in Chroma's L2 distance
            })

        return formatted_results

# Create a singleton instance to be used throughout the app
db_instance = VectorDatabase()
