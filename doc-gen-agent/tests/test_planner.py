import sys
import os
from unittest.mock import mock_open, patch, MagicMock
import pytest

# Add src directory to sys.path to allow importing the planner module
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))

# Mock dependencies only if they are not already available
try:
    import google.genai
except ImportError:
    sys.modules["google"] = MagicMock()
    sys.modules["google.genai"] = MagicMock()
    sys.modules["google.genai.types"] = MagicMock()

try:
    import pydantic
except ImportError:
    # Minimal mock for pydantic if not installed
    mock_pydantic = MagicMock()
    sys.modules["pydantic"] = mock_pydantic

    class MockBaseModel:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)
        def model_dump_json(self, **kwargs):
            # In a real environment, pydantic handles this.
            # Here we simulate it for the test to pass in the restricted environment.
            import json
            def serialize(obj):
                if isinstance(obj, list):
                    return [serialize(i) for i in obj]
                if hasattr(obj, "__dict__"):
                    return {k: serialize(v) for k, v in obj.__dict__.items() if not k.startswith('_')}
                return obj

            data = serialize(self)
            return json.dumps(data, **kwargs)

    def mock_field(**kwargs):
        return MagicMock()

    mock_pydantic.BaseModel = MockBaseModel
    mock_pydantic.Field = mock_field

from planner import DocumentPlan, SectionConfig, save_plan_to_disk

@pytest.fixture
def sample_plan():
    return DocumentPlan(
        document_type="SRD",
        sections=[
            SectionConfig(
                title="Introduction",
                section_number="1.0",
                description="Intro description"
            )
        ]
    )

def test_save_plan_to_disk_success(sample_plan):
    """Test happy path for saving a plan to disk."""
    output_path = "test_plan.json"
    m = mock_open()
    with patch("builtins.open", m):
        save_plan_to_disk(sample_plan, output_path)

    # Check if open was called with correct arguments
    m.assert_called_once_with(output_path, "w", encoding="utf-8")

    # Check if write was called
    handle = m()
    handle.write.assert_called_once()

    # Verify the content written is valid JSON and contains expected data
    written_data = handle.write.call_args[0][0]
    import json
    parsed_data = json.loads(written_data)
    assert parsed_data["document_type"] == "SRD"
    assert len(parsed_data["sections"]) == 1
    assert parsed_data["sections"][0]["title"] == "Introduction"

def test_save_plan_to_disk_none_plan():
    """Test that the function does nothing if plan is None."""
    output_path = "test_plan.json"
    m = mock_open()
    with patch("builtins.open", m):
        save_plan_to_disk(None, output_path)

    # Check that open was never called
    m.assert_not_called()

def test_save_plan_to_disk_file_error(sample_plan):
    """Test that the function propagates exceptions during file writing."""
    output_path = "test_plan.json"
    m = mock_open()
    m.side_effect = PermissionError("Permission denied")

    with patch("builtins.open", m):
        with pytest.raises(PermissionError):
            save_plan_to_disk(sample_plan, output_path)
