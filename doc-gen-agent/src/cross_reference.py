import os
import glob
import re
import pandas as pd

def extract_requirements(input_dir: str, regex_pattern: str = r"\[REQ-ITS-\d{3,4}\]"):
    """
    Scans generated markdowns for a specific requirement pattern.
    Returns a dictionary mapping requirement ID to the section file it was found in.
    """
    print(f"Extracting requirements matching '{regex_pattern}' from {input_dir}...")
    requirements = {}
    
    md_files = glob.glob(os.path.join(input_dir, "*.md"))
    for file_path in md_files:
        section_name = os.path.basename(file_path)
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            # Find all instances of the pattern
            matches = re.findall(regex_pattern, content)
            
            # Deduplicate per file
            for match in set(matches):
                if match not in requirements:
                    requirements[match] = {
                        "SRD_Section": section_name,
                        "HLD_Section": None,
                        "LLD_Section": None
                    }
                else:
                    # Update if found in multiple SRD sections (though uncommon)
                    requirements[match]["SRD_Section"] += f", {section_name}"
                    
    print(f"Extracted {len(requirements)} unique requirements.")
    return requirements

def update_rtm_with_design(rtm_data: dict, design_dir: str, design_type: str, regex_pattern: str = r"\[REQ-ITS-\d{3,4}\]"):
    """
    Scans HLD or LLD design documents to see where the requirements were addressed.
    Updates the rtm_data.
    """
    print(f"Scanning {design_type} documents in {design_dir} for traceability...")
    md_files = glob.glob(os.path.join(design_dir, "*.md"))
    
    for file_path in md_files:
        section_name = os.path.basename(file_path)
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            matches = re.findall(regex_pattern, content)
            
            for match in set(matches):
                if match in rtm_data:
                    key = f"{design_type}_Section"
                    if rtm_data[match][key] is None:
                        rtm_data[match][key] = section_name
                    else:
                        rtm_data[match][key] += f", {section_name}"
                else:
                    print(f"Warning: Found requirement {match} in {design_type} that was NOT in SRD.")
                    
    return rtm_data

def generate_rtm_excel(rtm_data: dict, output_filepath: str):
    """
    Outputs the RTM data structure to an Excel CSV or XLSX file.
    """
    data_list = []
    for req_id, locs in rtm_data.items():
        data_list.append({
            "Requirement_ID": req_id,
            "SRD_Location": locs["SRD_Section"],
            "HLD_Location": locs.get("HLD_Section", "MISSING"),
            "LLD_Location": locs.get("LLD_Section", "MISSING"),
            "Status": "Traced" if (locs.get("HLD_Section") and locs.get("LLD_Section")) else "Incomplete"
        })
        
    df = pd.DataFrame(data_list)
    df.to_csv(output_filepath, index=False)
    print(f"RTM generated successfully: {output_filepath}")

if __name__ == "__main__":
    # Example usage
    # srd_reqs = extract_requirements("../output/srd_drafts")
    # updated_reqs = update_rtm_with_design(srd_reqs, "../output/hld_drafts", "HLD")
    # complete_reqs = update_rtm_with_design(updated_reqs, "../output/lld_drafts", "LLD")
    # generate_rtm_excel(complete_reqs, "../output/Requirements_Traceability_Matrix.csv")
    pass
