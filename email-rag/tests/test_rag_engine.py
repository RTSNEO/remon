import pytest
import sys
from unittest.mock import MagicMock

# Mock out langchain modules before importing rag_engine
sys.modules['langchain_community.chat_models'] = MagicMock()
sys.modules['langchain_core.prompts'] = MagicMock()
sys.modules['langchain_core.output_parsers'] = MagicMock()
sys.modules['langchain_core.runnables'] = MagicMock()
sys.modules['database'] = MagicMock()
sys.modules['config'] = MagicMock()

from rag_engine import format_docs

def test_format_docs_empty():
    """Test format_docs with an empty list of documents."""
    assert format_docs([]) == ""

def test_format_docs_single_complete():
    """Test format_docs with a single document containing all metadata."""
    docs = [
        {
            "metadata": {
                "subject": "Test Subject",
                "from": "sender@example.com",
                "date": "2023-10-27"
            },
            "content": "This is the content of the test email."
        }
    ]
    expected_output = (
        "--- Email 1 ---\n"
        "From: sender@example.com\n"
        "Date: 2023-10-27\n"
        "Subject: Test Subject\n"
        "Content:\n"
        "This is the content of the test email.\n"
    )
    assert format_docs(docs) == expected_output

def test_format_docs_single_missing_metadata():
    """Test format_docs with a single document missing some or all metadata."""
    docs = [
        {
            "metadata": {},
            "content": "Content with no metadata."
        }
    ]
    expected_output = (
        "--- Email 1 ---\n"
        "From: Unknown Sender\n"
        "Date: Unknown Date\n"
        "Subject: No Subject\n"
        "Content:\n"
        "Content with no metadata.\n"
    )
    assert format_docs(docs) == expected_output

def test_format_docs_multiple_docs():
    """Test format_docs with multiple documents to ensure correct joining."""
    docs = [
        {
            "metadata": {
                "subject": "First Email",
                "from": "first@example.com",
                "date": "2023-10-26"
            },
            "content": "First content."
        },
        {
            "metadata": {
                "subject": "Second Email",
                "from": "second@example.com",
                "date": "2023-10-27"
            },
            "content": "Second content."
        }
    ]
    expected_output = (
        "--- Email 1 ---\n"
        "From: first@example.com\n"
        "Date: 2023-10-26\n"
        "Subject: First Email\n"
        "Content:\n"
        "First content.\n"
        "\n\n"
        "--- Email 2 ---\n"
        "From: second@example.com\n"
        "Date: 2023-10-27\n"
        "Subject: Second Email\n"
        "Content:\n"
        "Second content.\n"
    )
    assert format_docs(docs) == expected_output
