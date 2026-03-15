import unittest
from email_fetcher import decode_mime_header

class TestDecodeMimeHeader(unittest.TestCase):

    def test_empty_and_none(self):
        self.assertEqual(decode_mime_header(None), "")
        self.assertEqual(decode_mime_header(""), "")

    def test_plain_text(self):
        self.assertEqual(decode_mime_header("Hello World"), "Hello World")
        self.assertEqual(decode_mime_header("Re: Update on project"), "Re: Update on project")

    def test_single_encoded_part(self):
        # UTF-8 encoded
        self.assertEqual(decode_mime_header("=?utf-8?q?Hello=20World?="), "Hello World")
        # ISO-8859-1 encoded
        self.assertEqual(decode_mime_header("=?iso-8859-1?q?caf=E9?="), "café")

    def test_multiple_encoded_parts(self):
        # Mixed plain and encoded
        self.assertEqual(
            decode_mime_header("=?utf-8?q?Hello?= World =?utf-8?q?Again?="),
            "Hello World Again"
        )
        # Multiple encoded adjacent
        self.assertEqual(
            decode_mime_header("=?utf-8?q?Part1?= =?utf-8?q?Part2?="),
            "Part1Part2"
        )

    def test_invalid_encoding(self):
        # An invalid encoding should fallback to utf-8 replacement
        # "=?invalid-encoding?q?Hello?="
        # Python's decode_header might treat this as an unknown encoding, or raise an error.
        # We simulate the UnicodeDecodeError fallback by using a string that fails to decode

        # We can test an encoded string that claims to be utf-8 but is invalid utf-8 bytes
        # =?utf-8?b?...?= where ... is base64 for invalid utf-8
        # Base64 for b'\xff\xff' is '//8='
        # So "=?utf-8?b?//8=?=" will decode to b'\xff\xff', which is invalid utf-8.
        # The code tries to decode it as utf-8, fails with UnicodeDecodeError,
        # then falls back to part.decode("utf-8", errors="replace")
        self.assertEqual(
            decode_mime_header("=?utf-8?b?//8=?="),
            "\ufffd\ufffd" # Two replacement characters
        )

    def test_bytes_without_encoding(self):
        # If decode_header returns a byte string without an encoding,
        # it should decode as utf-8 with replace.
        # However, it's hard to trigger `decode_header` to return `(bytes, None)`
        # unless it's a raw unencoded byte string passed to it, which shouldn't happen
        # normally for `header_value` (which is a string).
        # We can test by calling `decode_header` indirectly via our string, but decode_header
        # usually returns `(bytes, charset)` or `(str, None)`.

        # But for full coverage, let's monkeypatch `decode_header` inside our test temporarily
        # to ensure we cover the branches in decode_mime_header

        import email_fetcher
        original_decode_header = email_fetcher.decode_header

        try:
            # Mock `decode_header` to return specific byte structures to test inner branches
            email_fetcher.decode_header = lambda h: [
                (b"Hello", None), # Bytes without encoding
                (b" \xff", None), # Invalid utf-8 bytes without encoding
            ]
            self.assertEqual(decode_mime_header("dummy"), "Hello \ufffd")

        finally:
            # Restore the original decode_header
            email_fetcher.decode_header = original_decode_header

if __name__ == '__main__':
    unittest.main()
