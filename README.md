# NWEA Research Works

A research-library explorer built around a saved **September 4, 2026** snapshot of **317 NWEA library entries**. Search the records, compare topics and publication types, and explore contributors who appear on shared records.

**[Open the dashboard](https://nilkamal11.github.io/nwea-research-works/)** · **[Complete build guide](docs/BUILD_GUIDE.md)** · **[Project walkthrough](docs/INTERVIEW_WALKTHROUGH.md)**

## What the dashboard does

- **Works:** search and filter records by contributor, posted year, theme, product, type, and broader publication class; follow links to the source pages and available PDFs.
- **Counts:** compare categories within a selected scope and open the matching records from a chart.
- **Themes × types:** see how topics intersect publication types, with unique-record row totals.
- **Collaborations:** explore a contributor network, inspect shared-record counts, and use contributor and pair tables alongside the graph.

The contributor network includes credited authors, an editor byline, and an organizational byline. A node counts selected records containing that contributor; an edge counts records shared by a pair. Records can be different versions or summaries of the same study. A saved-roster match is a name match, not verified employment history.

## Run locally

Open `index.html` directly in a browser, or use Node.js 20 or later:

```console
git clone https://github.com/nilkamal11/nwea-research-works.git
cd nwea-research-works
npm start
```

Open `http://127.0.0.1:8787/`. No package installation is necessary. Windows users can also run `serve.cmd` if Node.js is installed.

## Tools

The interface uses HTML, CSS, plain JavaScript, and Canvas 2D. The network has a custom force layout. Python's standard library handles the offline data build, validation, CSV export, and optional forward collection. Node.js supplies a local static server and JavaScript tests. GitHub Pages hosts the static files.

There are no third-party runtime dependencies. The browser does not run Python or query a database. D3, pandas, and BeautifulSoup are not part of this implementation.

## Rebuild and validate

With Python 3.10 or later installed, run from the repository root:

```console
python scripts/build_data.py
python scripts/validate_data.py
python scripts/build_data.py --check
python -m unittest discover -s tests -p "test_*.py"
npm test
```

The builder reads the preserved snapshot, applies documented transformations, validates the result, and writes `data.js`, `nwea_publications_317.csv`, and `data/qa_report.json`. `--check` verifies that committed exports match the deterministic build without changing them. The GitHub checks workflow runs these validations for pushes and pull requests.

## Collect a new sample for review

```console
python scripts/collect_sources.py --limit 5 --output .work/source-review.json
```

The collector reads NWEA's public WordPress publication endpoint and source pages, checks robots policy, follows pagination, and preserves source bylines and taxonomy labels. Use `--limit 0` to request all API pages. It writes a separate review file; it does not refresh the published dashboard. PDF links are candidates that require record-level review.

The original collector and raw HTTP responses were not included with the saved inventory. The committed offline build is reproducible from its snapshot; the new collector supports future reviewed updates. See [provenance](data/provenance.json) for the boundary between preserved source material and derived fields.

## Source files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and controls |
| `assets/styles.css` | Visual design and responsive layout |
| `assets/data-model.js` | Shared filters, counts, theme matrix, contributor pairs |
| `assets/app.js` | Interface behavior, charts, Canvas layout, interactions |
| `data/snapshot_2026-09-04.json` | Preserved source input |
| `data/author_aliases.json` | Documented name handling |
| `data/provenance.json`, `data/schema.json` | Source history and derived data contract |
| `scripts/build_data.py` | Deterministic data and CSV generation |
| `scripts/validate_data.py` | Structural and analytical checks |
| `scripts/collect_sources.py` | New source candidates for review |
| `tests/` | Data, aggregation, collection-parser, and server tests |
| `serve.js` | Optional local preview server |

For the full implementation sequence, function map, graph mathematics, and debugging examples, read the [build guide](docs/BUILD_GUIDE.md).

## Reading the data

- The inventory has 317 unique record IDs and URLs, with 228 contributor display names after an entry-specific name correction. Twenty-four entries lack bylines.
- Six inherited display-name aliases remain documented as unverified. Three entries now preserve “Sharon Bi” from their saved bylines instead of the previous unsupported substitution.
- Website posted dates are not verified original publication dates.
- A journal-article label follows the saved publication type; it does not independently establish peer review.
- Multi-type and multi-theme records can count in multiple categories. Repeated titles are retained because they can represent legitimate separate entries.
- Node positions support visual exploration; distances do not measure research similarity. Roster nonmatches do not establish outside affiliation.

This is an independent portfolio project using public metadata from the [NWEA research library](https://www.nwea.org/research/publications/). Source pages remain the reference for the publications. The project is not an official NWEA product.
