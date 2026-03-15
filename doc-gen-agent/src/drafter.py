import os
import json
from google import genai
from google.genai import types
from planner import DocumentPlan, SectionConfig

def generate_section_content(
    client: genai.Client,
    cache_name: str,
    plan: DocumentPlan,
    section: SectionConfig,
    previously_generated_text: str = ""
) -> str:
    """Generates a single section natively utilizing the Context Cache and optionally previous text context."""
    print(f"Drafting Section {section.section_number}: {section.title}...")
    
    # We want to maintain flow but ensure we aren't blowing up the prompt context limit.
    # Just include the immediate previous context.
    previous_context_snippet = ""
    if len(previously_generated_text) > 0:
        previous_context_snippet = f"\n\nHere is a snippet of the previously generated text to maintain tone and continuity:\n{previously_generated_text[-3000:]}"
        
    prompt = f"""
    You are an expert ITS Systems Engineer drafting the '{plan.document_type}'.
    
    Please write the content for the following section:
    Section Number: {section.section_number}
    Title: {section.title}
    Description/Requirements: {section.description}
    
    Ensure your response directly addresses this section without starting off with a preamble. Feel free to use tables, markdown lists, and standard formatting.
    Only write this single section. Do not output anything outside of this section.
    {previous_context_snippet}
    """
    
    response = client.models.generate_content(
        model='gemini-2.5-pro',
        contents=[prompt],
        config=types.GenerateContentConfig(
            cached_content=cache_name,
            temperature=0.3
        )
    )
    return response.text

def draft_document(client: genai.Client, cache_name: str, plan: DocumentPlan, output_dir: str):
    """Orchestrates section-by-section drafting based on the ToC plan."""
    os.makedirs(output_dir, exist_ok=True)
    
    previously_generated_text = ""
    for idx, section in enumerate(plan.sections):
        safe_title = section.title.replace(" ", "_").replace("/", "-")
        filename = os.path.join(output_dir, f"{str(idx).zfill(3)}_{section.section_number}_{safe_title}.md")
        
        # Checking if already drafted (resumability)
        if os.path.exists(filename):
            print(f"Skipping {filename}, already exists.")
            with open(filename, 'r', encoding='utf-8') as f:
                previously_generated_text = f.read()
            continue
            
        content = generate_section_content(client, cache_name, plan, section, previously_generated_text)
        
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(f"# {section.section_number} {section.title}\n\n{content}\n")
            
        print(f"Saved {filename}")
        previously_generated_text = content

if __name__ == "__main__":
    from dotenv import load_dotenv
    from ingestion import setup_client
    load_dotenv()
    
    # client = setup_client()
    # cache_name = "cachedContent/some-cached-id" # Must exist in your Google Cloud Project
    # with open("../output/srd_plan.json", "r") as f:
    #     plan = DocumentPlan(**json.load(f))
    # draft_document(client, cache_name, plan, "../output/srd_drafts")
