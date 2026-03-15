from langchain_community.chat_models import ChatOllama
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from database import db_instance
from config import OLLAMA_BASE_URL, CHAT_MODEL

# Initialize the local chat model via Ollama
llm = ChatOllama(
    base_url=OLLAMA_BASE_URL,
    model=CHAT_MODEL,
    temperature=0.3, # Lower temperature for more factual, less creative answers
)

# The prompt template that guides the AI
template = """You are a helpful assistant that answers questions based strictly on the user's personal emails.

Use the following pieces of retrieved email context to answer the question.
If you don't know the answer based on the provided emails, just say that you don't know or that the information is not in the emails.
Do not use outside knowledge.
Provide a clear, concise, and helpful answer. Mention the date or sender if it is relevant.

Context (Retrieved Emails):
{context}

Question: {question}
Answer:"""

prompt = ChatPromptTemplate.from_template(template)

def format_docs(docs):
    """Formats the retrieved documents into a single string for the prompt."""
    formatted_texts = []
    for i, doc in enumerate(docs):
        # Extract metadata from dictionary
        subject = doc["metadata"].get("subject", "No Subject")
        sender = doc["metadata"].get("from", "Unknown Sender")
        date = doc["metadata"].get("date", "Unknown Date")
        content = doc["content"]

        # Format the email representation
        email_str = f"--- Email {i+1} ---\n"
        email_str += f"From: {sender}\n"
        email_str += f"Date: {date}\n"
        email_str += f"Subject: {subject}\n"
        email_str += f"Content:\n{content}\n"

        formatted_texts.append(email_str)

    return "\n\n".join(formatted_texts)

def ask_question(question: str):
    """
    RAG Pipeline:
    1. Retrieve relevant emails from ChromaDB.
    2. Format them.
    3. Pass them to Ollama via LangChain.
    4. Return the generated answer and the source emails used.
    """
    # 1. Retrieve the top 5 most relevant emails
    results = db_instance.search(question, k=5)

    # Check if we have any results
    if not results:
        return "I couldn't find any relevant emails in your database to answer this question. Make sure your emails have finished syncing.", []

    # Format the results for the prompt context
    context_str = format_docs(results)

    # Build the LangChain execution chain
    # The RunnablePassthrough allows us to pass variables directly into the prompt template
    chain = (
        {"context": lambda x: context_str, "question": RunnablePassthrough()}
        | prompt
        | llm
        | StrOutputParser()
    )

    # Execute the chain
    answer = chain.invoke(question)

    # Return both the generated answer and the raw source documents used
    return answer, results
