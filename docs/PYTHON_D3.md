# Building the Python and D3 version

[Open the published dashboard](https://nilkamal11.github.io/nwea-research-works/python-d3/)

This version puts the analytical logic in Python and uses D3 to draw an interactive contributor network. It keeps the original dashboard alongside it. Both start with the same validated September 4, 2026 snapshot: 317 library records, 228 distinct contributor display names, and a saved roster of 22 names.

## What runs where

| Layer | Code | Responsibility |
| --- | --- | --- |
| Data preparation | [`scripts/build_data.py`](../scripts/build_data.py), [`scripts/validate_data.py`](../scripts/validate_data.py) | Apply documented corrections and validate the saved records. |
| Python analysis | [`python_d3/analytics.py`](../python_d3/analytics.py) | Filter records; calculate summaries, category counts, the matrix, and contributor relationships. |
| Local API | [`python_d3/app.py`](../python_d3/app.py) | Use Flask to receive filter requests and return Python-computed JSON. |
| Static export | [`python_d3/export.py`](../python_d3/export.py) | Generate the checked-in browser dataset with record memberships for every node and pair. |
| Browser adapter | [`python-d3/static-model.js`](../python-d3/static-model.js) | Apply filters to the exported dataset when running on GitHub Pages. |
| Visualization | [`python-d3/app.js`](../python-d3/app.js) | Load results, render charts and tables, and draw the network using D3. |
| Presentation | [`python-d3/index.html`](../python-d3/index.html), [`python-d3/styles.css`](../python-d3/styles.css) | Structure, controls, accessibility, and styling. |

**D3 is a JavaScript library.** Python supplies the analytical data; D3 runs in the browser. Flask is needed for the local API, while the analysis and export use Python's standard library. The repository contains a pinned copy of D3 7.9.0.

There are two execution paths:

```text
Local:        browser filters → Flask request → Python analysis → JSON → D3
GitHub Pages: Python export → saved JSON → browser filter adapter → D3
```

**GitHub Pages does not run Flask.** Its public demonstration loads the Python-generated snapshot and reproduces filtered views in the browser. The local version calculates each requested view in Python. The two paths use the same response structure and D3 interface.

## Run it yourself

From the repository root, create an isolated Python environment and install Flask. On Windows:

```console
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r python_d3/requirements.txt
.venv\Scripts\python.exe -m python_d3.app --port 8788
```

Open [the local Python application](http://127.0.0.1:8788/python-d3/). Stop it with Ctrl+C. On macOS or Linux, use `.venv/bin/python` in place of `.venv\Scripts\python.exe`.

To rebuild or check the static export, use:

```console
python -m python_d3.export
python -m python_d3.export --check
```

The export does not require Flask. It writes `python-d3/data.json` deterministically, so `--check` can detect a stale committed file. Run `npm start` to preview the static site and open `/python-d3/` on the local server. This variant loads JSON over HTTP; use a server instead of opening its HTML file directly.

## Follow a request through Python

`ResearchAnalytics` loads `data.js` and calls the existing validator before accepting the dataset. Its constructor creates contributor and pair indexes once. Each index entry retains the IDs of the source records that support it.

Flask exposes two read-only endpoints:

- `GET /python-d3/api/bootstrap` supplies metadata, records, indexes, and the default view.
- `GET /python-d3/api/view` supplies a filtered view.

For example:

```text
/python-d3/api/view?theme=Growth&cls=Journal%20article&roster_only=false&min_shared=2
```

The route passes `request.args` to `ResearchAnalytics.query()` and returns the result with `jsonify()`. Query parameters are text at the HTTP boundary, so `parse_query()` validates and converts them before analysis. It rejects unknown or repeated parameters, invalid booleans, malformed years, reversed year ranges, and invalid edge thresholds. Invalid requests return HTTP 400 with a JSON error. Flask documents [routing, requests, and JSON responses](https://flask.palletsprojects.com/en/stable/quickstart/).

Available record filters are `q`, `cls`, `type`, `theme`, `author`, `y0`, `y1`, and `pdf`. Two graph settings are `roster_only` and `min_shared`. **Roster-only changes which contributors appear in the graph; it does not remove publications from the selected record list.**

`matches()` evaluates the record filters. `count_labels()` uses `collections.Counter`, with a `set` to count each label at most once per record. The matrix calculates each row's unique-record total separately from its cells because a record can have multiple types.

## Build the contributor network

The constructor deduplicates each record's contributor list and uses `itertools.combinations(names, 2)` to generate unordered pairs. A record containing three contributors generates three pairs. A record containing one contributor creates a node with no pair.

`defaultdict(list)` accumulates the supporting record IDs for each contributor and pair. To answer a filtered request, `graph()` intersects those memberships with the selected record IDs. Node counts are credited records; edge weights are shared records. Applying a minimum edge count does not discard isolated contributors.

This is closely related to SQL: create a distinct record-contributor bridge, self-join it on record ID, retain one ordering of each pair, and group by the two contributor names. Keeping the contributing record IDs makes an aggregate auditable. For this small snapshot, Python collections are sufficient; a database becomes useful when scale, concurrent updates, or access control justify one.

## Turn relationships into a D3 graphic

`renderNetwork()` binds nodes and edges to SVG elements using D3 data joins. `scaleSqrt()` maps counts to circle radii and line widths. `forceSimulation()` combines `forceLink()`, `forceManyBody()`, `forceCollide()`, and centering forces. Dragging moves an individual node; zooming changes the view. These are the responsibilities of D3's [force](https://d3js.org/d3-force), [selection](https://d3js.org/d3-selection/joining), [drag](https://d3js.org/d3-drag), and [zoom](https://d3js.org/d3-zoom) APIs.

The renderer copies the graph before handing it to D3 because the simulation adds coordinates and replaces link IDs with node objects. This keeps the analytical response intact. `renderBarChart()` uses a linear scale for bar lengths; `renderMatrix()` uses a sequential color scale for cells.

`load()` chooses the API bootstrap or saved JSON. `updateView()` then chooses the Python endpoint or `deriveView()` in the static adapter. An `AbortController` cancels an obsolete request, and a sequence check prevents a slow earlier response from replacing a newer selection.

Python determines which relationships exist and how many records support them. D3 determines where to draw them. A node's position is a layout result, not a measured research characteristic. The tables and underlying records help readers inspect results without relying on the picture alone.

## Check the result and explain the limits

Run the Python checks in the environment containing Flask, then run the browser-model checks:

```console
.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
npm test
python -m python_d3.export --check
```

Preserve the distinction between a library record and a distinct study: an article, appendix, and brief may represent the same research. Contributor names include editor roles and an organizational byline. Roster matches establish membership in the saved list, not employment or affiliation when an item appeared. Posted dates are website dates. Missing bylines and unresolved legacy name aliases limit the network. The [provenance record](../data/provenance.json) and [original build guide](BUILD_GUIDE.md) document these decisions and the separate workflow for reviewing new source data.

A useful interview explanation is: “I built a Python analysis layer that validates publication metadata and turns contributor lists into traceable relationships. Flask exposes filtered results as JSON, and D3 renders them in the browser. I also export the same data for a static demonstration. Each count can be traced to its supporting records, and I distinguish shared library entries from distinct research studies.”
