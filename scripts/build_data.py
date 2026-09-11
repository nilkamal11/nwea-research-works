"""Build browser data, CSV, and QA metrics from the preserved library snapshot."""

from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
from pathlib import Path

from validate_data import CLASS_ORDER, TYPE_CLASSES, validate_dataset

ROOT = Path(__file__).resolve().parents[1]


def json_text(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def build_dataset(source: dict, aliases: dict) -> dict:
    """Apply explicitly recorded display corrections without discarding bylines."""
    dataset = copy.deepcopy(source)
    dataset["meta"].update({
        "classOrder": CLASS_ORDER,
        "scope": "Saved NWEA research-library snapshot; completeness is not independently verified.",
        "dateMeaning": "Website posted date, not verified original publication date",
        "rosterMeaning": "Name match to the saved 22-name roster, not affiliation at publication",
        "rosterDate": source["meta"]["pulled"],
        "authorIdentityMeaning": "Display names with documented legacy aliases; identities are not independently verified",
    })
    roster = set(dataset["meta"]["roster"])
    for work in dataset["works"]:
        corrections = {
            row["legacy_name"]: row["display_name"]
            for row in aliases["corrections"] if work["id"] in row["entry_ids"]
        }
        for legacy, display in corrections.items():
            if legacy in work["authors"] and display not in work["byline"]:
                raise ValueError(f"Entry {work['id']}: correction is not supported by its saved byline")
        work["authors"] = list(dict.fromkeys(corrections.get(name, name) for name in work["authors"]))
        work["nwea"] = [name for name in work["authors"] if name in roster]
        classes = {TYPE_CLASSES[work_type] for work_type in work["types"]}
        work["cls"] = [name for name in CLASS_ORDER if name in classes]
    dataset["meta"]["n"] = len(dataset["works"])
    return dataset


def csv_text(dataset: dict) -> str:
    buffer = io.StringIO(newline="")
    fields = ["id", "posted_date", "posted_year", "title", "work_types", "publication_classes", "themes", "product", "center", "source_byline", "contributors", "contributor_role", "authors_roster_matched", "roster_match_count", "pdf", "url"]
    writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for work in dataset["works"]:
        writer.writerow({
            "id": work["id"], "posted_date": work["date"], "posted_year": work["year"],
            "title": work["title"], "work_types": "; ".join(work["types"]),
            "publication_classes": "; ".join(work["cls"]), "themes": "; ".join(work["themes"]),
            "product": work["product"], "center": work["center"], "source_byline": work["byline"],
            "contributors": "; ".join(work["authors"]),
            "contributor_role": "editor" if work["editors"] else "author",
            "authors_roster_matched": "; ".join(work["nwea"]), "roster_match_count": len(work["nwea"]),
            "pdf": work["pdf"], "url": work["url"],
        })
    return buffer.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail when checked-in exports differ from the build")
    args = parser.parse_args()
    source_path = ROOT / "data" / "snapshot_2026-09-04.json"
    source_bytes = source_path.read_bytes()
    provenance = json.loads((ROOT / "data" / "provenance.json").read_text(encoding="utf-8"))
    if hashlib.sha256(source_bytes).hexdigest() != provenance["canonical_snapshot_sha256"]:
        raise ValueError("The preserved snapshot differs from its provenance checksum")
    source = json.loads(source_bytes)
    aliases = json.loads((ROOT / "data" / "author_aliases.json").read_text(encoding="utf-8"))
    dataset = build_dataset(source, aliases)
    report = validate_dataset(dataset)
    report["source_sha256"] = hashlib.sha256(source_bytes).hexdigest()
    report["author_aliases"] = aliases
    outputs = {
        ROOT / "data.js": "window.NWEA = " + json_text(dataset).rstrip() + ";\n",
        ROOT / "nwea_publications_317.csv": "\ufeff" + csv_text(dataset),
        ROOT / "data" / "qa_report.json": json_text(report),
    }
    different = []
    for path, content in outputs.items():
        wanted = content.encode("utf-8")
        if args.check:
            if not path.exists() or path.read_bytes() != wanted:
                different.append(path.relative_to(ROOT).as_posix())
        else:
            path.write_bytes(wanted)
    if different:
        print("Exports differ: " + ", ".join(different))
        return 1
    action = "Verified" if args.check else "Built"
    print(f"{action} {report['record_count']} entries, {report['distinct_contributor_names']} contributor names, {len(report['duplicate_titles'])} repeated titles.")
    print("Missing metadata and interpretation notes: data/qa_report.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
