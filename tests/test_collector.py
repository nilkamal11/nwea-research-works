"""Guard against mixing a record's byline with related-page contributors."""
import importlib.util
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location(
    "collector", Path(__file__).resolve().parents[1] / "scripts" / "collect_sources.py"
)
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)


class CollectorTests(unittest.TestCase):
    def test_first_main_byline_excludes_related_content(self):
        parser = collector.PageMetadata()
        parser.feed('''<p class="authors">By: <a title="A">A</a>,
            <span title="B">B</span></p><p class="author">Unrelated C</p>
            <p class="authors"><a title="D">D</a></p>''')
        result = parser.result()
        self.assertEqual(result["source_byline"], "By: A, B")
        self.assertEqual(result["contributor_labels"], ["A", "B"])

    def test_pdf_candidates_are_absolute_and_deduplicated(self):
        parser = collector.PageMetadata()
        parser.feed('<a href="/paper.pdf">PDF</a><a href="/paper.pdf">Again</a>')
        self.assertEqual(parser.result()["pdf_candidates"], ["https://www.nwea.org/paper.pdf"])

    def test_relative_pdf_candidates_use_publication_page_url(self):
        parser = collector.PageMetadata("https://www.nwea.org/research/publication/example/")
        parser.feed('<a href="paper.pdf">PDF</a>')
        self.assertEqual(parser.result()["pdf_candidates"], [
            "https://www.nwea.org/research/publication/example/paper.pdf"
        ])


if __name__ == "__main__":
    unittest.main()
