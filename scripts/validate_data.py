"""Validate a research-library dataset and report missing metadata."""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import date
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
TYPE_CLASSES = {
    "Journal article": "Journal article",
    "Book": "Book",
    "Presentation paper": "Conference paper",
    "Working paper": "Working paper / preprint",
    "Research brief": "Report / brief",
    "Research report": "Report / brief",
    "White paper": "Report / brief",
    "Policy brief": "Report / brief",
    "Technical brief": "Technical / psychometric",
    "Technical report": "Technical / psychometric",
    "Presentation": "Conference presentation",
    "Guide": "Practitioner guide",
    "Blog article": "Blog / web",
    "Data visualization": "Blog / web",
    "(untyped)": "Unclassified",
}
CLASS_ORDER = [
    "Journal article", "Book", "Conference paper", "Working paper / preprint",
    "Report / brief", "Technical / psychometric", "Conference presentation",
    "Practitioner guide", "Blog / web", "Unclassified",
]
TEXT_FIELDS = ("id", "title", "date", "year", "type", "product", "center", "byline", "pdf", "url")
ARRAY_FIELDS = ("types", "cls", "themes", "authors", "nwea")


class ValidationError(ValueError):
    """A dataset does not satisfy the published data contract."""


def safe_url(value: str) -> bool:
    """Accept absolute HTTP(S) links without embedded credentials or controls."""
    if not isinstance(value, str) or any(c.isspace() or ord(c) < 32 for c in value):
        return False
    try:
        parsed = urlsplit(value)
        return bool(
            parsed.scheme in {"http", "https"} and parsed.hostname
            and parsed.username is None and parsed.password is None
            and "\\" not in value
        )
    except ValueError:
        return False


def parse_date(value: object, label: str, errors: list[str]) -> date | None:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        errors.append(f"{label}: expected YYYY-MM-DD")
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        errors.append(f"{label}: invalid calendar date")
        return None


def validate_dataset(dataset: object) -> dict:
    """Return deterministic QA metrics; raise ValidationError for structural errors.

    Missing optional metadata and repeated titles are reported, not rejected.
    Distinct library entries may legitimately have the same title.
    """
    errors: list[str] = []
    if not isinstance(dataset, dict):
        raise ValidationError("dataset: expected an object")
    meta, works = dataset.get("meta"), dataset.get("works")
    if not isinstance(meta, dict) or not isinstance(works, list):
        raise ValidationError("dataset: meta must be an object and works must be an array")
    pulled = parse_date(meta.get("pulled"), "meta.pulled", errors)
    if type(meta.get("n")) is not int or meta["n"] != len(works):
        errors.append("meta.n: must equal the record count")
    roster = meta.get("roster")
    if not isinstance(roster, list) or any(not isinstance(a, str) or not a.strip() for a in roster):
        errors.append("meta.roster: expected an array of nonempty strings")
        roster = []
    if len(roster) != len(set(roster)):
        errors.append("meta.roster: duplicate names")
    if meta.get("classOrder") != CLASS_ORDER:
        errors.append("meta.classOrder: unexpected classification order")
    roster_set = set(roster)
    ids: Counter[str] = Counter()
    urls: Counter[str] = Counter()
    titles: dict[str, list[str]] = {}
    missing = Counter({key: 0 for key in ("authors", "byline", "themes", "product", "center", "pdf", "nwea")})
    type_counts: Counter[str] = Counter()
    class_counts: Counter[str] = Counter()
    year_counts: Counter[str] = Counter()
    all_authors: set[str] = set()
    editor_ids, organization_ids = [], []
    for position, work in enumerate(works):
        label = f"works[{position}]"
        if not isinstance(work, dict):
            errors.append(f"{label}: expected an object")
            continue
        local_errors = len(errors)
        for key in TEXT_FIELDS:
            if not isinstance(work.get(key), str):
                errors.append(f"{label}.{key}: expected a string")
        for key in ARRAY_FIELDS:
            values = work.get(key)
            if not isinstance(values, list) or any(not isinstance(v, str) or not v.strip() for v in values):
                errors.append(f"{label}.{key}: expected an array of nonempty strings")
            elif len(values) != len(set(values)):
                errors.append(f"{label}.{key}: duplicate values")
        if type(work.get("editors")) is not bool:
            errors.append(f"{label}.editors: expected a boolean")
        if len(errors) != local_errors:
            continue
        for key in ("id", "title", "type", "url"):
            if not work[key].strip():
                errors.append(f"{label}.{key}: must not be empty")
        if not work["id"].isdigit():
            errors.append(f"{label}.id: expected a numeric WordPress identifier stored as text")
        ids[work["id"]] += 1
        urls[work["url"]] += 1
        titles.setdefault(work["title"], []).append(work["id"])
        posted = parse_date(work["date"], f"{label}.date", errors)
        if posted and work["year"] != str(posted.year):
            errors.append(f"{label}.year: differs from the posted date")
        if posted and pulled and posted > pulled:
            errors.append(f"{label}.date: later than the snapshot date")
        for key in ("url", "pdf"):
            if work[key] and not safe_url(work[key]):
                errors.append(f"{label}.{key}: unsafe or invalid web URL")
        unknown_types = set(work["types"]) - TYPE_CLASSES.keys()
        if not work["types"] or unknown_types:
            errors.append(f"{label}.types: empty or unrecognized work type")
        expected_classes = {TYPE_CLASSES[t] for t in work["types"] if t in TYPE_CLASSES}
        if set(work["cls"]) != expected_classes:
            errors.append(f"{label}.cls: does not match the work types")
        expected_roster = [a for a in work["authors"] if a in roster_set]
        if work["nwea"] != expected_roster:
            errors.append(f"{label}.nwea: does not match the saved roster")
        if bool(work["authors"]) != bool(work["byline"].strip()):
            errors.append(f"{label}.byline: inconsistent with the contributor list")
        for key in missing:
            missing[key] += not bool(work[key])
        type_counts.update(work["types"])
        class_counts.update(work["cls"])
        year_counts.update([work["year"]])
        all_authors.update(work["authors"])
        if work["editors"]:
            editor_ids.append(work["id"])
        if "NWEA" in work["authors"]:
            organization_ids.append(work["id"])
    for key, counts in (("id", ids), ("url", urls)):
        for value, count in counts.items():
            if count > 1:
                errors.append(f"duplicate {key}: {value} ({count} entries)")
    if errors:
        raise ValidationError("\n".join(errors))
    duplicate_titles = [{"title": title, "ids": entries} for title, entries in titles.items() if len(entries) > 1]
    return {
        "snapshot_date": meta["pulled"], "record_count": len(works),
        "unique_ids": len(ids), "unique_urls": len(urls),
        "missing_metadata": dict(sorted(missing.items())),
        "duplicate_titles": duplicate_titles,
        "type_counts": dict(sorted(type_counts.items())),
        "class_counts": dict(sorted(class_counts.items())),
        "posted_year_counts": dict(sorted(year_counts.items())),
        "march_2020_entries": sum(w["date"].startswith("2020-03") for w in works),
        "distinct_contributor_names": len(all_authors),
        "contributor_appearances": sum(len(w["authors"]) for w in works),
        "roster_names": len(roster),
        "editor_entry_ids": editor_ids, "organizational_byline_entry_ids": organization_ids,
        "notes": [
            "Counts describe saved library entries, not distinct studies or complete author bibliographies.",
            "Posted dates are website dates, not verified original publication dates.",
            "Roster matches are name matches to a saved list, not institutional affiliation evidence.",
            "Missing bylines and unverified aliases affect contributor and network coverage.",
            "Journal article classification follows source work types and does not independently verify peer review.",
            "Multi-type entries count in each applicable type and class.",
        ],
    }


def load_data_js(path: Path) -> dict:
    text = path.read_text(encoding="utf-8-sig").strip()
    prefix = "window.NWEA = "
    if not text.startswith(prefix) or not text.endswith(";"):
        raise ValidationError("data.js: unexpected wrapper")
    return json.loads(text[len(prefix):-1])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", type=Path, default=ROOT / "data.js")
    args = parser.parse_args()
    try:
        dataset = load_data_js(args.path) if args.path.suffix == ".js" else json.loads(args.path.read_text(encoding="utf-8"))
        report = validate_dataset(dataset)
    except (ValidationError, OSError, json.JSONDecodeError) as exc:
        print(f"Validation failed: {exc}")
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
