"""Data-contract tests for failures that can distort displayed research counts."""

from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from build_data import build_dataset
from validate_data import CLASS_ORDER, ValidationError, safe_url, validate_dataset


def sample() -> dict:
    return {
        "meta": {"pulled": "2026-09-04", "n": 1, "roster": ["Megan Kuhfeld"], "classOrder": CLASS_ORDER},
        "works": [{
            "id": "1", "title": "Example", "date": "2026-08-01", "year": "2026", "type": "Journal article",
            "types": ["Journal article"], "cls": ["Journal article"], "themes": [], "product": "", "center": "",
            "authors": ["Megan Kuhfeld"], "nwea": ["Megan Kuhfeld"], "byline": "Megan Kuhfeld",
            "editors": False, "pdf": "", "url": "https://www.nwea.org/research/publication/example/",
        }],
    }


class DatasetTests(unittest.TestCase):
    def test_missing_optional_metadata_is_reported(self):
        report = validate_dataset(sample())
        self.assertEqual(report["missing_metadata"]["pdf"], 1)
        self.assertEqual(report["record_count"], 1)

    def test_missing_required_key_fails(self):
        data = sample()
        del data["works"][0]["id"]
        with self.assertRaisesRegex(ValidationError, r"\.id"):
            validate_dataset(data)

    def test_duplicate_id_fails_even_with_different_url(self):
        data = sample()
        second = copy.deepcopy(data["works"][0])
        second["url"] += "second/"
        data["works"].append(second)
        data["meta"]["n"] = 2
        with self.assertRaisesRegex(ValidationError, "duplicate id"):
            validate_dataset(data)

    def test_duplicate_url_fails_even_with_different_id(self):
        data = sample()
        second = copy.deepcopy(data["works"][0])
        second["id"] = "2"
        data["works"].append(second)
        data["meta"]["n"] = 2
        with self.assertRaisesRegex(ValidationError, "duplicate url"):
            validate_dataset(data)

    def test_string_is_not_an_author_array(self):
        data = sample()
        data["works"][0]["authors"] = "Megan Kuhfeld"
        with self.assertRaisesRegex(ValidationError, "authors"):
            validate_dataset(data)

    def test_invalid_array_member_fails(self):
        data = sample()
        data["works"][0]["themes"] = [None]
        with self.assertRaisesRegex(ValidationError, "themes"):
            validate_dataset(data)

    def test_unsafe_urls_fail(self):
        for value in ["javascript:alert(1)", "data:text/html,hello", "file:///private.csv", "//evil.example", "https://name:password@example.com/", "https://example.com/\npage", "https://example.com\\@evil.example/"]:
            with self.subTest(url=value):
                self.assertFalse(safe_url(value))
                data = sample()
                data["works"][0]["url"] = value
                with self.assertRaisesRegex(ValidationError, "URL"):
                    validate_dataset(data)

    def test_date_and_year_must_agree(self):
        data = sample()
        data["works"][0]["year"] = "2025"
        with self.assertRaisesRegex(ValidationError, "year"):
            validate_dataset(data)

    def test_invalid_calendar_date_fails(self):
        data = sample()
        data["works"][0]["date"] = "2026-02-30"
        with self.assertRaisesRegex(ValidationError, "calendar date"):
            validate_dataset(data)

    def test_roster_membership_is_derived(self):
        data = sample()
        data["works"][0]["nwea"] = []
        with self.assertRaisesRegex(ValidationError, "saved roster"):
            validate_dataset(data)

    def test_class_must_follow_source_type(self):
        data = sample()
        data["works"][0]["cls"] = ["Peer-reviewed article"]
        with self.assertRaisesRegex(ValidationError, "work types"):
            validate_dataset(data)

    def test_duplicate_titles_are_reported_not_dropped(self):
        data = sample()
        second = copy.deepcopy(data["works"][0])
        second.update(id="2", url="https://www.nwea.org/research/publication/second/")
        data["works"].append(second)
        data["meta"]["n"] = 2
        self.assertEqual(validate_dataset(data)["duplicate_titles"], [{"title": "Example", "ids": ["1", "2"]}])

    def test_display_correction_preserves_source_byline_and_input(self):
        data = sample()
        data["works"][0].update(authors=["Shannon Bi"], nwea=[], byline="Sharon Bi")
        fixed = build_dataset(data, {"corrections": [{"legacy_name": "Shannon Bi", "display_name": "Sharon Bi", "entry_ids": ["1"]}]})
        self.assertEqual(fixed["works"][0]["authors"], ["Sharon Bi"])
        self.assertEqual(fixed["works"][0]["byline"], "Sharon Bi")
        self.assertEqual(data["works"][0]["authors"], ["Shannon Bi"])

    def test_name_correction_is_limited_to_reviewed_entries(self):
        data = sample()
        data["works"][0].update(authors=["Shannon Bi"], nwea=[], byline="Shannon Bi")
        fixed = build_dataset(data, {"corrections": [{"legacy_name": "Shannon Bi", "display_name": "Sharon Bi", "entry_ids": ["999"]}]})
        self.assertEqual(fixed["works"][0]["authors"], ["Shannon Bi"])

    def test_full_snapshot_build_validates(self):
        source = json.loads((ROOT / "data" / "snapshot_2026-09-04.json").read_text(encoding="utf-8"))
        aliases = json.loads((ROOT / "data" / "author_aliases.json").read_text(encoding="utf-8"))
        report = validate_dataset(build_dataset(source, aliases))
        self.assertEqual(report["record_count"], 317)
        self.assertEqual(report["unique_urls"], 317)


if __name__ == "__main__":
    unittest.main()
