import json
import os
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

class SectionConfig(BaseModel):
    title: str = Field(description="Title of the section")
    section_number: str = Field(description="Hierarchical section number, e.g., '1.0', '1.1', '2.3.1'")
    description: str = Field(description="A brief description of what this section should contain based on the ITS project context and ISO standards.")

class DocumentPlan(BaseModel):
    document_type: str = Field(description="Type of document, e.g., 'SRD', 'HLD', 'LLD'")
    sections: list[SectionConfig] = Field(description="Ordered list of sections for this document.")

def generate_document_plan(client: genai.Client, cache_name: str, document_type: str) -> DocumentPlan:
    """Generates a structured Table of Contents (Plan) for a target document using the cached context."""
    print(f"Generating Table of Contents for {document_type}...")
    
    prompt = f"""
    Please generate a detailed Table of Contents for a {document_type} (e.g., System Requirements Document, High-Level Design, or Low-Level Design).
    Base the structure strictly on the provided ISO standards (like ISO 14813) and tailor the sections to the ITS project requirements detailed in the documents.
    Include a descriptive summary of what each section should contain so the writer agent can fill it out accurately later.
    Ensure standard sections (Introduction, Scope, References, Architecture, etc.) are included and properly numbered.
    """
    
    # We call the model using the cache
    response = client.models.generate_content(
        model='gemini-2.5-pro',
        contents=[prompt],
        config=types.GenerateContentConfig(
            cached_content=cache_name,
            response_mime_type="application/json",
            response_schema=DocumentPlan,
            temperature=0.2
        )
    )
    
    # Parse out the JSON Response
    try:
        plan_data = json.loads(response.text)
        plan = DocumentPlan(**plan_data)
        return plan
    except Exception as e:
        print(f"Failed to parse model output into JSON: {e}")
        return None

def save_plan_to_disk(plan: DocumentPlan, output_path: str):
    """Saves the generated plan to a local JSON file."""
    if plan:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(plan.model_dump_json(indent=4))
        print(f"Plan saved to {output_path}")

if __name__ == "__main__":
    from dotenv import load_dotenv
    from ingestion import setup_client
    load_dotenv()
    
    # client = setup_client()
    # cache_name = "cachedContent/some-cached-id" # Note: Needs an active cache to test
    # plan = generate_document_plan(client, cache_name, "System Requirements Document (SRD)")
    # os.makedirs("../output", exist_ok=True)
    # save_plan_to_disk(plan, "../output/srd_plan.json")
