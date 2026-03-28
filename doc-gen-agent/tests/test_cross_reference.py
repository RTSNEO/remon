import sys
import os
import pytest
from unittest.mock import patch, MagicMock

# Add src directory to sys.path to allow importing the cross_reference module
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))

try:
    import pandas
except ImportError:
    sys.modules["pandas"] = MagicMock()

from cross_reference import extract_requirements, update_rtm_with_design

def test_extract_requirements_basic(tmp_path):
    # Setup temporary markdown file
    d = tmp_path / "srd"
    d.mkdir()
    f = d / "section1.md"
    f.write_text("This is a requirement [REQ-ITS-001]. Another one [REQ-ITS-002].", encoding="utf-8")

    requirements = extract_requirements(str(d))

    assert "[REQ-ITS-001]" in requirements
    assert "[REQ-ITS-002]" in requirements
    assert requirements["[REQ-ITS-001]"]["SRD_Section"] == "section1.md"
    assert requirements["[REQ-ITS-001]"]["HLD_Section"] is None

def test_extract_requirements_deduplication(tmp_path):
    # Setup temporary markdown file with duplicate requirement
    d = tmp_path / "srd"
    d.mkdir()
    f = d / "section1.md"
    f.write_text("Repeat [REQ-ITS-001] and [REQ-ITS-001].", encoding="utf-8")

    requirements = extract_requirements(str(d))

    assert len(requirements) == 1
    # Note: the actual code uses compiled_regex.findall(content) then set(matches)
    assert "[REQ-ITS-001]" in requirements
    assert requirements["[REQ-ITS-001]"]["SRD_Section"] == "section1.md"

def test_extract_requirements_multiple_files(tmp_path):
    # Setup multiple temporary markdown files
    d = tmp_path / "srd"
    d.mkdir()
    f1 = d / "section1.md"
    f1.write_text("Req [REQ-ITS-001]", encoding="utf-8")
    f2 = d / "section2.md"
    f2.write_text("Same Req [REQ-ITS-001]", encoding="utf-8")

    requirements = extract_requirements(str(d))

    assert "[REQ-ITS-001]" in requirements
    # Logic in cross_reference.py: requirements[match]["SRD_Section"] += f", {section_name}"
    assert "section1.md" in requirements["[REQ-ITS-001]"]["SRD_Section"]
    assert "section2.md" in requirements["[REQ-ITS-001]"]["SRD_Section"]
    assert "," in requirements["[REQ-ITS-001]"]["SRD_Section"]

def test_update_rtm_with_design_single_match(tmp_path):
    # Setup rtm_data
    rtm_data = {
        "[REQ-ITS-001]": {"SRD_Section": "srd1.md", "HLD_Section": None, "LLD_Section": None}
    }

    # Setup design directory
    d = tmp_path / "hld"
    d.mkdir()
    f = d / "hld1.md"
    f.write_text("Addressing [REQ-ITS-001]", encoding="utf-8")

    updated_rtm = update_rtm_with_design(rtm_data, str(d), "HLD")

    assert updated_rtm["[REQ-ITS-001]"]["HLD_Section"] == "hld1.md"
    assert updated_rtm["[REQ-ITS-001]"]["LLD_Section"] is None

def test_update_rtm_with_design_multiple_files(tmp_path):
    # Setup rtm_data
    rtm_data = {
        "[REQ-ITS-001]": {"SRD_Section": "srd1.md", "HLD_Section": None, "LLD_Section": None}
    }

    # Setup design directory with multiple files addressing same requirement
    d = tmp_path / "lld"
    d.mkdir()
    f1 = d / "lld1.md"
    f1.write_text("Addressing [REQ-ITS-001]", encoding="utf-8")
    f2 = d / "lld2.md"
    f2.write_text("Also addressing [REQ-ITS-001]", encoding="utf-8")

    updated_rtm = update_rtm_with_design(rtm_data, str(d), "LLD")

    assert "lld1.md" in updated_rtm["[REQ-ITS-001]"]["LLD_Section"]
    assert "lld2.md" in updated_rtm["[REQ-ITS-001]"]["LLD_Section"]
    assert "," in updated_rtm["[REQ-ITS-001]"]["LLD_Section"]

def test_update_rtm_with_design_missing_in_srd(tmp_path, capsys):
    # Setup rtm_data empty
    rtm_data = {}

    # Setup design directory
    d = tmp_path / "hld"
    d.mkdir()
    f = d / "hld1.md"
    f.write_text("New requirement [REQ-ITS-999]", encoding="utf-8")

    updated_rtm = update_rtm_with_design(rtm_data, str(d), "HLD")

    captured = capsys.readouterr()
    assert "Warning: Found requirement [REQ-ITS-999] in HLD that was NOT in SRD." in captured.out
    assert "[REQ-ITS-999]" not in updated_rtm

def test_update_rtm_with_design_empty_directory(tmp_path):
    rtm_data = {
        "[REQ-ITS-001]": {"SRD_Section": "srd1.md", "HLD_Section": None, "LLD_Section": None}
    }
    d = tmp_path / "empty"
    d.mkdir()

    updated_rtm = update_rtm_with_design(rtm_data, str(d), "HLD")

    assert updated_rtm["[REQ-ITS-001]"]["HLD_Section"] is None

def test_update_rtm_with_design_custom_regex(tmp_path):
    rtm_data = {
        "CUSTOM-1": {"SRD_Section": "srd1.md", "HLD_Section": None, "LLD_Section": None}
    }
    d = tmp_path / "hld"
    d.mkdir()
    f = d / "hld1.md"
    f.write_text("Matching CUSTOM-1", encoding="utf-8")

    updated_rtm = update_rtm_with_design(rtm_data, str(d), "HLD", regex_pattern=r"CUSTOM-\d")

    assert updated_rtm["CUSTOM-1"]["HLD_Section"] == "hld1.md"
