import streamlit as st
import os
import sys
import time
import uuid
from pathlib import Path
from dotenv import load_dotenv

# Ensure the 'src' directory is in the python path for imports
script_dir = os.path.dirname(os.path.abspath(__file__))
src_path = os.path.join(script_dir, 'src')
if src_path not in sys.path:
    sys.path.insert(0, src_path)

# Ensure output format directories exist
os.makedirs("output/srd_drafts", exist_ok=True)
os.makedirs("output/hld_drafts", exist_ok=True)
os.makedirs("output/lld_drafts", exist_ok=True)
os.makedirs("uploads", exist_ok=True)

# Import our custom modules
from ingestion import setup_client, upload_document, create_context_cache
from planner import generate_document_plan, save_plan_to_disk
from drafter import draft_document
from compiler import compile_markdown_to_docx
from cross_reference import extract_requirements, update_rtm_with_design, generate_rtm_excel

load_dotenv()

st.set_page_config(page_title="ITS Document Generator AI", layout="wide")
st.title("ITS Document Generator AI Agent")
st.markdown("Generates compliant SRD, HLD, LLD documents based on ISO standards and checks cross-reference traceability.")

if "gemini_cache_name" not in st.session_state:
    st.session_state.gemini_cache_name = None
if "uploaded_gemini_files" not in st.session_state:
    st.session_state.uploaded_gemini_files = []

# --- Sidebar Configuration ---
with st.sidebar:
    st.header("1. Data Ingestion")
    uploaded_files = st.file_uploader("Upload ISO Standards & Project Specs", accept_multiple_files=True, type=['pdf', 'docx', 'txt'])
    
    if st.button("Upload to Gemini & Create Cache"):
        if not uploaded_files:
            st.error("Please upload files.")
        else:
            try:
                client = setup_client()
                with st.spinner("Uploading files and creating context cache..."):
                    gemini_files = []
                    for uploaded_file in uploaded_files:
                        # Sanitize filename by using a UUID for local storage
                        # while preserving the original extension.
                        safe_filename = f"{uuid.uuid4()}{Path(uploaded_file.name).suffix}"
                        temp_path = os.path.join("uploads", safe_filename)
                        try:
                            with open(temp_path, "wb") as f:
                                f.write(uploaded_file.getbuffer())

                            g_file = upload_document(client, temp_path, display_name=uploaded_file.name)
                            gemini_files.append(g_file)
                            st.success(f"Uploaded: {uploaded_file.name} (Type: {g_file.mime_type})")
                        finally:
                            # Clean up the temporary file
                            if os.path.exists(temp_path):
                                os.remove(temp_path)
                    
                    st.session_state.uploaded_gemini_files = gemini_files
                    cache = create_context_cache(client, gemini_files)
                    st.session_state.gemini_cache_name = cache.name
                    st.success(f"Context Cache created: {cache.name}")
            except Exception as e:
                st.error(f"Error: {e}")

# --- Main App ---
tab1, tab2, tab3 = st.tabs(["Generate Document", "Compile", "Traceability Matrix"])

with tab1:
    st.header("2. Generate Document")
    doc_type = st.selectbox("Select Document Type", ["System Requirements Document (SRD)", "High-Level Design (HLD)", "Low-Level Design (LLD)"])
    output_folder_map = {
        "System Requirements Document (SRD)": "output/srd_drafts",
        "High-Level Design (HLD)": "output/hld_drafts",
        "Low-Level Design (LLD)": "output/lld_drafts"
    }
    
    if st.button("Start AI Drafting Phase"):
        if not st.session_state.gemini_cache_name:
            st.error("Please create the Context Cache first (Sidebar).")
        else:
            client = setup_client()
            output_dir = output_folder_map[doc_type]
            
            with st.spinner("Step A: Creating Document Plan (ToC)..."):
                plan = generate_document_plan(client, st.session_state.gemini_cache_name, doc_type)
                if plan:
                    save_plan_to_disk(plan, f"output/{doc_type.split()[0].lower()}_plan.json")
                    st.success("Plan Created!")
                    st.json(plan.model_dump())
                else:
                    st.error("Failed to generate plan.")
            
            if plan:
                with st.spinner(f"Step B: Iteratively Drafting {len(plan.sections)} Sections... This may take a while."):
                    draft_document(client, st.session_state.gemini_cache_name, plan, output_dir)
                st.success(f"All sections drafted successfully to `{output_dir}`!")


with tab2:
    st.header("3. Compile to Word")
    st.markdown("Stitch all the generated Markdown files into a single massive Word document.")
    c_doc_type = st.selectbox("Select Directory to Compile", ["SRD", "HLD", "LLD"])
    
    dir_map = {
        "SRD": "output/srd_drafts",
        "HLD": "output/hld_drafts",
        "LLD": "output/lld_drafts"
    }
    
    if st.button("Compile DOCX"):
        target_dir = dir_map[c_doc_type]
        output_file = f"output/Final_{c_doc_type}.docx"
        
        with st.spinner("Compiling..."):
            compile_markdown_to_docx(target_dir, output_file)
        
        if os.path.exists(output_file):
            st.success(f"Compiled successfully to `{output_file}`")
            with open(output_file, "rb") as file:
                btn = st.download_button(
                    label="Download Document",
                    data=file,
                    file_name=f"Final_{c_doc_type}.docx",
                    mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                )

with tab3:
    st.header("4. Generate RTM")
    st.markdown("Scan all documents for requirement tags (e.g. `[REQ-ITS-XXX]`) and map traceability.")
    
    if st.button("Generate Matrix"):
        with st.spinner("Analyzing cross-references..."):
            reqs = extract_requirements("output/srd_drafts")
            hld_traced = update_rtm_with_design(reqs, "output/hld_drafts", "HLD")
            complete_traced = update_rtm_with_design(hld_traced, "output/lld_drafts", "LLD")
            
            rtm_file = "output/RTM.csv"
            generate_rtm_excel(complete_traced, rtm_file)
            
        st.success(f"RTM Generated at `{rtm_file}`")
        if os.path.exists(rtm_file):
            import pandas as pd
            df = pd.read_csv(rtm_file)
            st.dataframe(df)

