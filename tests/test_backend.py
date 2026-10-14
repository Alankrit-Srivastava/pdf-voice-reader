"""Unit tests for Clarity Reader Python backend."""

import unittest
from pathlib import Path
import json

from ai_pdf_voice_reader import (
    local_explanation,
    extract_pdf_lines,
    explain_text,
    antigravity_status,
)


class TestClarityBackend(unittest.TestCase):
    def test_local_explanation_rules(self):
        text = "In order to facilitate the process, please utilize this system subsequently."
        res = local_explanation(text)
        self.assertIn("to help the process", res)
        self.assertIn("use this system", res)
        self.assertIn("then.", res)

    def test_sample_pdf_extraction(self):
        sample_path = Path(__file__).parent.parent / "output" / "pdf" / "clarity_reader_sample.pdf"
        self.assertTrue(sample_path.is_file())
        lines = extract_pdf_lines(sample_path)
        self.assertGreater(len(lines), 0)
        self.assertTrue(any("Clarity Reader" in l for l in lines))

    def test_explain_text_fallback(self):
        payload = {
            "text": "Furthermore, prior to commencing, verify all parameters.",
            "pageNumber": 1,
        }
        explanation, provider = explain_text(payload)
        self.assertTrue(len(explanation) > 0)
        self.assertIn("before", explanation)

    def test_status_endpoint_returns_tuple(self):
        ready, detail = antigravity_status()
        self.assertIsInstance(ready, bool)
        self.assertIsInstance(detail, str)


if __name__ == "__main__":
    unittest.main()
