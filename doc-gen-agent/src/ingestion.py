import os
from google import genai
from google.genai import types
import time

import mimetypes

def setup_client():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable not set.")
    return genai.Client(api_key=api_key)

def upload_document(client, file_path, display_name=None):
    """Uploads a document to the Gemini File API with robust mime-type mapping."""
    # Hardcoded map for high reliability
    extension_map = {
        '.pdf': 'application/pdf',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.doc': 'application/msword',
        '.txt': 'text/plain',
        '.csv': 'text/csv',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }
    
    _, ext = os.path.splitext(file_path.lower())
    mime_type = extension_map.get(ext)
    
    # If not in map, try system detection
    if not mime_type:
        mime_type, _ = mimetypes.guess_type(file_path)
    
    # Final fallback to avoid None
    if not mime_type:
        mime_type = 'application/octet-stream'
    
    print(f"Uploading {file_path} to Gemini (mime_type: {mime_type})...")
    uploaded_file = client.files.upload(
        file=file_path,
        config={
            'display_name': display_name,
            'mime_type': mime_type
        }
    )
    print(f"Uploaded as: {uploaded_file.name}")
    
    # Wait for processing if it's a large PDF
    print("Waiting for file processing...")
    while True:
        file_info = client.files.get(name=uploaded_file.name)
        if file_info.state == "ACTIVE":
            print(f"File {uploaded_file.name} is ready.")
            break
        elif file_info.state == "FAILED":
            raise RuntimeError(f"File processing failed for {uploaded_file.name}")
        time.sleep(5)
        
    return uploaded_file

def create_context_cache(client, uploaded_files, system_instruction="You are an expert ITS Systems Engineer and Document Writer."):
    """Creates a Gemini Context Cache out of uploaded files."""
    contents = [
        types.Content(role="user", parts=[types.Part.from_uri(file_uri=f.uri)]) 
        for f in uploaded_files
    ]
    
    print("Creating Context Cache...")
    cache = client.caches.create(
        model='gemini-2.5-pro',
        config=types.CreateCachedContentConfig(
            contents=contents,
            system_instruction=system_instruction,
            ttl="1h",
        )
    )
    print(f"Cache created successfully: {cache.name}")
    return cache

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    # Example Usage:
    # client = setup_client()
    # file_paths = ["path/to/iso14813.pdf", "path/to/its_project_reqs.docx"]
    # uploaded_files = [upload_document(client, path) for path in file_paths]
    # cache = create_context_cache(client, uploaded_files)
