"""Collect current source metadata for review; never replace the published snapshot."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

BASE = "https://www.nwea.org"
API = BASE + "/wp-json/wp/v2/publications"
USER_AGENT = "NWEAResearchWorks/1.0 (public research metadata)"
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input",
             "link", "meta", "param", "source", "track", "wbr"}


class PageMetadata(HTMLParser):
    """Read the first main byline; keep PDF links as unverified candidates."""

    def __init__(self, source_url=BASE):
        super().__init__(convert_charrefs=True)
        self.source_url = source_url
        self.byline_depth = 0
        self.found_byline = False
        self.byline_parts = []
        self.contributor_labels = []
        self.pdf_candidates = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "p" and "authors" in attrs.get("class", "").split() and not self.found_byline:
            self.found_byline = True
            self.byline_depth = 1
        elif self.byline_depth and tag not in VOID_TAGS:
            self.byline_depth += 1
        if self.byline_depth and tag in {"a", "span"} and attrs.get("title"):
            self.contributor_labels.append(attrs["title"].strip())
        if tag == "a" and ".pdf" in attrs.get("href", "").lower():
            link = urljoin(self.source_url, attrs["href"])
            if urlparse(link).scheme in {"http", "https"}:
                self.pdf_candidates.append(link)

    def handle_endtag(self, tag):
        if self.byline_depth and tag not in VOID_TAGS:
            self.byline_depth -= 1

    def handle_data(self, value):
        if self.byline_depth:
            self.byline_parts.append(value)

    def result(self):
        return {
            "source_byline": " ".join("".join(self.byline_parts).split()),
            "contributor_labels": list(dict.fromkeys(self.contributor_labels)),
            "pdf_candidates": list(dict.fromkeys(self.pdf_candidates)),
        }


def request_bytes(url):
    """Retry temporary failures; surface permanent HTTP errors to the caller."""
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(request, timeout=25) as response:
                return response.read(), dict(response.headers)
        except HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504} or attempt == 2:
                raise
        except (URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(2 ** attempt)


def read_robots():
    """Require a readable robots policy before fetching the catalogue."""
    content, _ = request_bytes(BASE + "/robots.txt")
    policy = RobotFileParser()
    policy.parse(content.decode("utf-8", errors="replace").splitlines())
    return policy


def collect(limit=5, delay=0.5):
    policy = read_robots()
    records = []
    expected_total = None
    page = 1
    total_pages = 1
    per_page = min(limit, 100) if limit else 100
    while page <= total_pages:
        url = API + "?" + urlencode({
            "per_page": per_page, "page": page, "orderby": "id", "order": "asc",
            "_embed": "wp:term",
        })
        if not policy.can_fetch(USER_AGENT, url):
            raise RuntimeError("robots.txt does not allow the catalogue request.")
        content, headers = request_bytes(url)
        headers = {key.lower(): value for key, value in headers.items()}
        expected_total = int(headers["x-wp-total"])
        total_pages = int(headers["x-wp-totalpages"])
        for row in json.loads(content):
            source_url = row["link"]
            parsed_url = urlparse(source_url)
            if parsed_url.scheme != "https" or parsed_url.hostname != "www.nwea.org":
                raise ValueError(f"Unexpected source URL for entry {row['id']}.")
            if not policy.can_fetch(USER_AGENT, source_url):
                raise RuntimeError(f"robots.txt does not allow entry {row['id']}.")
            time.sleep(delay)
            page_content, _ = request_bytes(source_url)
            metadata = PageMetadata(source_url)
            metadata.feed(page_content.decode("utf-8", errors="replace"))
            terms = {}
            for group in row.get("_embedded", {}).get("wp:term", []):
                for term in group:
                    if "taxonomy" in term and "name" in term:
                        terms.setdefault(term["taxonomy"], []).append(term["name"])
            records.append({
                "id": str(row["id"]), "url": source_url,
                "title_html": row["title"]["rendered"],
                "posted_date": row["date"], "modified_date": row["modified"],
                "taxonomy_terms": terms, **metadata.result(), "review_required": True,
            })
            print(f"Collected entry {row['id']} ({len(records)} records)")
            if limit and len(records) >= limit:
                break
        if limit and len(records) >= limit:
            break
        page += 1
        time.sleep(delay)
    if len({row["id"] for row in records}) != len(records):
        raise ValueError("Duplicate entry IDs returned across catalogue pages.")
    return {
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": API, "expected_api_total": expected_total,
        "collected_count": len(records),
        "complete_api_count_match": len(records) == expected_total,
        "notes": [
            "Review source bylines and contributor identities before normalization.",
            "PDF candidates may include links from related content; verify record ownership.",
            "Posted dates do not establish original publication years.",
            "This collection does not replace the saved dashboard snapshot.",
        ],
        "records": records,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=5, help="Records to collect; 0 requests all pages.")
    parser.add_argument("--delay", type=float, default=0.5, help="Seconds between requests; minimum 0.25.")
    parser.add_argument("--output", type=Path, default=Path(".work/source-review.json"))
    args = parser.parse_args()
    if args.limit < 0 or args.delay < 0.25:
        parser.error("--limit must be nonnegative and --delay must be at least 0.25.")
    result = collect(args.limit, args.delay)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote review file: {args.output}")


if __name__ == "__main__":
    main()
