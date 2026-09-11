"""Filter validated records and derive counts and contributor relationships."""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping
from itertools import combinations
from pathlib import Path
import re

from scripts.validate_data import load_data_js, validate_dataset

ROOT = Path(__file__).resolve().parents[1]
QUERY_FIELDS = {"q", "cls", "type", "theme", "author", "y0", "y1", "pdf", "roster_only", "min_shared"}


class QueryError(ValueError):
    """A request contains an unsupported or invalid filter."""


def label_key(label: str) -> tuple[str, str]:
    return label.casefold(), label


def parse_query(values: Mapping | None = None) -> dict:
    """Validate a single-valued query; booleans accept true or false only."""
    values = values or {}
    unknown = set(values) - QUERY_FIELDS
    if unknown:
        raise QueryError("Unknown filter: " + ", ".join(sorted(unknown)))
    if hasattr(values, "getlist"):
        repeated = [key for key in values if len(values.getlist(key)) != 1]
        if repeated:
            raise QueryError("Each filter must occur once: " + ", ".join(sorted(repeated)))
    result = {}
    for field in ("q", "cls", "type", "theme", "author", "y0", "y1"):
        value = values.get(field, "")
        if not isinstance(value, str):
            raise QueryError(f"{field} must be text")
        value = value.strip()
        if len(value) > 300:
            raise QueryError(f"{field} must be 300 characters or fewer")
        result[field] = value
    for field in ("y0", "y1"):
        if result[field] and (not re.fullmatch(r"[0-9]{4}", result[field]) or int(result[field]) == 0):
            raise QueryError(f"{field} must be a four-digit year")
    if result["y0"] and result["y1"] and result["y0"] > result["y1"]:
        raise QueryError("The first year must not be after the last year")
    for field, default in (("pdf", False), ("roster_only", True)):
        value = values.get(field, default)
        if isinstance(value, bool):
            result[field] = value
        elif value in ("true", "false"):
            result[field] = value == "true"
        else:
            raise QueryError(f"{field} must be true or false")
    minimum = values.get("min_shared", 1)
    if isinstance(minimum, bool) or not re.fullmatch(r"[0-9]{1,3}", str(minimum)):
        raise QueryError("min_shared must be an integer from 1 to 317")
    minimum = int(minimum)
    if not 1 <= minimum <= 317:
        raise QueryError("min_shared must be an integer from 1 to 317")
    result["min_shared"] = minimum
    return result


def count_labels(works: list[dict], field: str, *, chronological: bool = False) -> list[dict]:
    counts = Counter()
    for work in works:
        values = work[field] if isinstance(work[field], list) else [work[field]]
        counts.update(value for value in set(values) if value)
    ordered = sorted(counts.items(), key=lambda item: label_key(item[0]) if chronological else (-item[1], *label_key(item[0])))
    return [{"label": label, "count": count} for label, count in ordered]


class ResearchAnalytics:
    """Read one validated snapshot and retain an index of record memberships."""

    def __init__(self, dataset: dict | None = None):
        self.dataset = dataset if dataset is not None else load_data_js(ROOT / "data.js")
        self.qa = validate_dataset(self.dataset)
        self.works = self.dataset["works"]
        self.roster = set(self.dataset["meta"]["roster"])
        contributions, pairs = defaultdict(list), defaultdict(list)
        for work in self.works:
            names = sorted(set(work["authors"]), key=label_key)
            for name in names:
                contributions[name].append(work["id"])
            for pair in combinations(names, 2):
                pairs[pair].append(work["id"])
        self.index = {
            "nodes": [{"id": name, "roster": name in self.roster, "record_ids": contributions[name]}
                      for name in sorted(contributions, key=label_key)],
            "links": [{"source": pair[0], "target": pair[1], "record_ids": pairs[pair]}
                      for pair in sorted(pairs, key=lambda pair: (*label_key(pair[0]), *label_key(pair[1])))],
        }

    @staticmethod
    def matches(work: dict, filters: dict) -> bool:
        for name, field in (("cls", "cls"), ("type", "types"), ("theme", "themes"), ("author", "authors")):
            if filters[name] and filters[name] not in work[field]:
                return False
        if filters["y0"] and work["year"] < filters["y0"]:
            return False
        if filters["y1"] and work["year"] > filters["y1"]:
            return False
        if filters["pdf"] and not work["pdf"]:
            return False
        text = " ".join([work["title"], work["byline"], work["type"], *work["themes"]]).lower()
        return not filters["q"] or filters["q"].lower() in text

    def graph(self, works: list[dict], roster_only: bool, minimum: int) -> dict:
        selected = {work["id"] for work in works}
        nodes = []
        for node in self.index["nodes"]:
            if roster_only and not node["roster"]:
                continue
            records = [record_id for record_id in node["record_ids"] if record_id in selected]
            if records:
                nodes.append({"id": node["id"], "roster": node["roster"], "count": len(records), "record_ids": records})
        nodes.sort(key=lambda node: (-node["count"], *label_key(node["id"])))
        node_ids = {node["id"] for node in nodes}
        links = []
        for link in self.index["links"]:
            if link["source"] not in node_ids or link["target"] not in node_ids:
                continue
            records = [record_id for record_id in link["record_ids"] if record_id in selected]
            if len(records) >= minimum:
                links.append({"source": link["source"], "target": link["target"], "shared": len(records), "record_ids": records})
        links.sort(key=lambda link: (-link["shared"], *label_key(link["source"]), *label_key(link["target"])))
        connected = {name for link in links for name in (link["source"], link["target"])}
        return {"nodes": nodes, "links": links, "isolated": len(node_ids - connected)}

    def query(self, values: Mapping | None = None) -> dict:
        filters = parse_query(values)
        works = [work for work in self.works if self.matches(work, filters)]
        counts = {name: count_labels(works, field) for name, field in (
            ("classes", "cls"), ("types", "types"), ("themes", "themes"), ("contributors", "authors"))}
        counts["years"] = count_labels(works, "year", chronological=True)
        types = [item["label"] for item in counts["types"]]
        rows = []
        for item in counts["themes"]:
            records = [work for work in works if item["label"] in work["themes"]]
            type_counts = {item["label"]: item["count"] for item in count_labels(records, "types")}
            rows.append({"theme": item["label"], "total": len(records), "cells": [type_counts.get(type_name, 0) for type_name in types]})
        contributors = {name for work in works for name in work["authors"]}
        return {
            "works": works,
            "summary": {"records": len(works), "bylines": sum(bool(work["byline"]) for work in works),
                        "pdfs": sum(bool(work["pdf"]) for work in works), "contributors": len(contributors),
                        "roster_contributors": len(contributors & self.roster)},
            "counts": counts,
            "matrix": {"types": types, "rows": rows},
            "graph": self.graph(works, filters["roster_only"], filters["min_shared"]),
        }

    def bootstrap(self) -> dict:
        return {"meta": self.dataset["meta"], "works": self.works, "index": self.index, "default_view": self.query()}
