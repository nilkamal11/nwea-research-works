# Building the NWEA Research Works explorer

This guide follows the actual source files in this repository. The application turns a saved research-library inventory into a searchable catalogue, summary charts, a theme-by-type matrix, and a contributor network. The complete implementation is in the repository; the examples below explain the important decisions and entry points.

## 1. Define the question and the unit of analysis

The starting question is: **What is represented in this saved NWEA research-library inventory, and which contributors appear together on its records?**

One record is one library entry. A journal article, working paper, technical appendix, and brief about the same underlying study can be separate entries. The current snapshot contains 317 entries. It is not a census of distinct studies or a complete bibliography for every researcher.

The network's unit is a contributor pair appearing on the same entry. Its edge weight is the number of shared entries in the selected scope. That definition must be settled before writing aggregation code, because counting studies instead would require another layer of reviewed record linkage.

## 2. Know the tools and where they run

| Tool | Responsibility in this project |
| --- | --- |
| Python standard library | Read the saved JSON, apply documented corrections, validate records, export browser data and CSV, and optionally collect new source candidates. |
| `json`, `csv`, `pathlib` | Structured data, spreadsheet-compatible export, and portable file paths. |
| `hashlib`, `datetime`, `collections.Counter` | Snapshot fingerprint, calendar validation, and QA counts. |
| `urllib.request`, `urllib.robotparser`, `html.parser` | Optional HTTP retrieval, robots-policy handling, and HTML parsing in the forward collection workflow. |
| HTML and CSS | Page structure, filters, tables, responsive layout, and themes. |
| Plain JavaScript | Filtering, counts, contributor-pair construction, interaction, and visual layout. |
| Canvas 2D | Drawing network nodes, edges, and labels. |
| Node.js | Local static server and JavaScript tests. |
| Git and GitHub Pages | Version control and static website publication. |

There is no SQL database or live application API behind the published dashboard. Python runs during preparation; the browser loads the prepared data. D3, pandas, and BeautifulSoup are not dependencies of this implementation. The force layout is written directly in JavaScript, and Canvas is a browser API.

## 3. Separate the saved snapshot from new collection

`data/snapshot_2026-09-04.json` is the preserved input. Its source description identifies the NWEA WordPress REST API and publication pages, but the original collector, HTTP responses, and collection log were not supplied. Consequently, the offline transformation is reproducible from this input; the original web retrieval cannot be reconstructed exactly from the available files.

`data/provenance.json` records the snapshot date, count, checksum, source description, transformations, and interpretation limits. Its SHA-256 checksum detects a change to the stored file. A checksum establishes file consistency, not the factual correctness or completeness of its contents.

For a fresh collection, use the optional `scripts/collect_sources.py` workflow. It writes candidates for review rather than replacing the published snapshot. Start with a small sample:

```console
python scripts/collect_sources.py --help
python scripts/collect_sources.py --limit 5 --output .work/source-review.json
```

`--limit 0` collects all available pages. The default request delay is 0.5 seconds; `--delay` accepts a minimum of 0.25 seconds. The candidate output is a review artifact, not a replacement for `data/snapshot_2026-09-04.json`. Compare it with the saved records before approving any snapshot change.

The collector separates responsibilities: `request_bytes()` handles retrieval, `read_robots()` reads the site's robots policy, `PageMetadata` parses HTML metadata, and `collect()` assembles the review collection. `main()` supplies the command-line interface. These use Python's standard library, including `HTMLParser`, `urllib`, `argparse`, `json`, `pathlib`, and `time`.

A sound collection sequence is:

1. Discover the publication content type and REST endpoint exposed by the source.
2. Retrieve a page of records, preserving identifiers, links, dates, and source fields.
3. Follow pagination until the requested collection is complete or a reported limit is reached.
4. Retrieve publication pages where additional byline metadata is available.
5. Preserve raw evidence and retrieval details alongside normalized candidates.
6. Review differences, missing fields, and identity mappings before creating a new approved snapshot.

WordPress commonly exposes `page` and `per_page`, with page size limited to 100, and returns `X-WP-Total` and `X-WP-TotalPages` headers. One successful request therefore does not establish full coverage. These are API conventions; the actual collection endpoint must be discovered from the site. [WordPress pagination documentation](https://developer.wordpress.org/rest-api/using-the-rest-api/pagination/)

Python's `urlopen` supports an explicit timeout and yields a response with headers and status. It can be used in a `with` block so the response closes reliably. Keep retrieval errors visible rather than treating an unsuccessful request as an empty publication list. [Python HTTP retrieval documentation](https://docs.python.org/3/library/urllib.request.html)

The public source is the [NWEA research library](https://www.nwea.org/research/publications/). The optional collector is a new forward workflow, not evidence of how the original 317 entries were collected.

## 4. Establish the data contract

`data/schema.json` describes the derived dataset. It contains `meta` and `works`. Metadata includes the saved roster, snapshot date, count, and classification order. Important work fields are:

| Field | Meaning |
| --- | --- |
| `id` | Source record identifier, stored as text. |
| `title`, `url` | Display title and source page. |
| `date`, `year` | Website posted date and its year, not verified original publication date. |
| `type`, `types` | Saved type text and structured type labels. |
| `cls` | Broader display classes derived from the structured types. |
| `themes`, `product`, `center` | Saved descriptive metadata; coverage varies. |
| `byline` | Saved source byline, retained for comparison with normalized names. |
| `authors` | Contributor display names used for counts and graph construction. |
| `nwea` | Contributor names matching the saved roster; not an affiliation finding. |
| `editors` | Whether the entry identifies contributors as editors. |
| `pdf` | Optional linked PDF; an empty value does not establish that no PDF exists elsewhere. |

Do not replace a missing byline with the current roster or infer authors from a title. Missing metadata stays missing and is reported. Keep organizational bylines and editor roles visible when interpreting contributor counts.

## 5. Normalize deliberately

`build_dataset(source, aliases)` in `scripts/build_data.py` begins with a deep copy of the saved input. It applies reviewed, entry-specific display corrections, removes repeated display names within an entry, derives roster matches, and maps work types into publication classes.

`TYPE_CLASSES` in `scripts/validate_data.py` contains the classification rules. For example, research reports and research briefs map to `Report / brief`; technical reports and technical briefs map to `Technical / psychometric`. An entry with multiple types can contribute to multiple categories. Category totals therefore need not sum to the number of entries.

Name normalization is documented in `data/author_aliases.json`. Several display aliases were inherited and remain unverified. One correction restores **Sharon Bi** on three entries to match their saved bylines. The builder checks that the proposed replacement appears in the saved byline before applying it. The correction is limited to the reviewed entry IDs.

This conservative approach avoids merging different people because their names look similar. A future identity-resolution workflow could collect ORCIDs and authoritative author profiles, but that is additional work rather than a capability of the present data.

## 6. Validate before generating the exports

`validate_dataset(dataset)` returns QA metrics or raises `ValidationError`. It checks required fields and types, unique IDs and URLs, valid calendar dates, agreement between date and year, dates no later than the snapshot, recognized work types, consistent classifications, contributor arrays, and derived roster matches. `safe_url()` rejects malformed or unsafe link values.

The validator distinguishes structural failures from incomplete metadata. Duplicate IDs fail. Repeated titles are reported, because separate legitimate records may share a title. Missing PDF links, bylines, or product labels are counted rather than filled in.

Run the preparation from the repository root:

```console
python scripts/build_data.py
python scripts/validate_data.py
python scripts/build_data.py --check
```

The first command writes `data.js`, `nwea_publications_317.csv`, and `data/qa_report.json`. The second validates the generated dataset. The third computes the expected outputs and checks that their bytes match the committed files. It detects manual export changes and stale outputs without rewriting them. `npm run build:data` and `npm run validate:data` are shortcuts for the Python build and validation scripts.

On systems where Python is named `python3`, substitute that command. Inspect the JSON QA report as well as the exit status. The derived inventory contains 228 distinct contributor display names, 24 entries without contributor names, and 16 repeated-title groups. Those conditions affect interpretation even when the structural checks pass. Restoring the three Sharon Bi entries separates them from the remaining Shannon Bi entries; this increases the distinct-name count from the original 227 without adding records or contributor appearances.

## 7. Build shared filters and summaries

`assets/data-model.js` contains functions independent of the page. Its small wrapper exposes the same functions as `window.NWEAModel` in the browser and `module.exports` in Node tests.

`normalizeFilter()` establishes defaults. `matches()` evaluates one record. `filterWorks()` selects the records satisfying the combined conditions. For example:

```javascript
const selected = NWEAModel.filterWorks(NWEA.works, {
  author: 'Megan Kuhfeld',
  cls: ['Journal article'],
  y0: '2022',
  y1: '2026'
});
```

Different filter dimensions combine with AND. Selected publication classes combine with OR within that dimension. The year comparison works lexically because the contract requires four-digit years. Text search checks the saved title, byline, type, and themes.

`tally()` uses a `Map` for counts and a `Set` to avoid counting a repeated label twice within one entry. `themeMatrix()` aggregates types for each theme. `drilldownFilter()` preserves an existing scope while applying the clicked category. This is what makes a chart-to-records transition interpretable: the records displayed should match the selection the user just made.

## 8. Turn contributor lists into a graph

`buildContributorGraph()` constructs the network from the already-filtered works. For each entry, it deduplicates the selected contributor list, increments each contributor's record count, and enumerates every unordered pair once.

For an entry with `k` contributors, the number of pairs is:

```text
C(k, 2) = k × (k − 1) / 2
```

Thus one three-contributor entry produces three pair occurrences. It still represents one library entry. Two entries containing Alex and Jordan produce one Alex–Jordan edge with weight two.

The implementation sorts each two-name pair and serializes it with `JSON.stringify(pair)` before using it as a `Map` key. This makes Alex–Jordan equivalent to Jordan–Alex without risking ambiguous delimiter concatenation. It does not merge different spellings of a person's name.

The result has `nodes`, `links`, and an isolated-node count. Node `count` is the number of selected records containing that contributor. Link `shared` is the number containing both contributors. `minShared` filters links after counting. Nodes without a remaining link stay in the result, so the threshold does not silently remove people from the scope.

`rosterOnly` restricts each entry to names matching the saved roster before creating pairs. It does not establish employment dates. Co-contribution is not evidence of the nature of a working relationship, contribution size, research quality, or causation.

## 9. Render and connect the interface

`index.html` loads `data.js`, then `assets/data-model.js`, then `assets/app.js`. The order matters: the application expects both globals to exist. CSS is separate in `assets/styles.css`.

The application functions create DOM elements for record cards, charts, tables, and controls. `element()` assigns text through `textContent`; `externalLink()` accepts HTTP(S) links. `showView()` manages the four tabs and URL fragment. `renderWorks()`, `renderCounts()`, and `renderMatrix()` call the shared model and update the corresponding views.

For the network, `buildNetwork()` obtains the graph and initializes positions on a spiral. `tick()` applies pairwise repulsion, attraction along edges, a weak pull toward the center, and velocity damping. Repulsion is softened at short distances, edge attraction is divided by the square root of the larger endpoint degree, and velocity is capped at 12 layout units per tick. These controls keep densely connected hubs and nearly overlapping nodes from destabilizing a step. `animate()` schedules frames and reduces the movement over time. Coordinates are layout choices, not measured research dimensions.

`drawNetwork()` paints edges and circles with Canvas 2D. Node radius is `4.5 + 2.4 * sqrt(count)`, so larger counts produce larger circles without linear radius growth. Edge width reflects shared-record weight. `hitTest()` connects pointer coordinates to nodes; clicking reveals the underlying records. `renderNetworkTables()` supplies the same contributor and edge data as ordinary tables. [Canvas documentation](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial)

The custom layout compares node pairs each tick, making that part approximately O(n²). It is suitable for this small inventory, not a claim of scalability to millions of contributors. At much larger scale, preaggregation, spatial approximations, and browser workers would deserve consideration.

## 10. Run, test, and inspect

```console
npm start
```

`npm start` runs `node serve.js`. Open the local address printed by the server. The server only serves files; it does not execute Python, access a research database, or refresh the snapshot. Use Ctrl+C to stop it.

```console
python -m unittest discover -s tests -p "test_*.py"
npm test
```

The Python tests exercise failures that could distort the data: duplicate IDs, invalid dates, inconsistent classifications, unsupported name corrections, and unsafe links. `npm test` runs `node --test tests/*.test.js`; these JavaScript tests exercise the shared filtering and graph logic. Follow them with a browser check of all four tabs, combined filters, a zero-result selection, graph thresholds, contributor selection, keyboard access, narrow-screen layout, and CSV download.

| Symptom | First investigation |
| --- | --- |
| Blank page | Browser console and network panel: confirm the three scripts loaded in order and all paths resolve. |
| Contributor count looks too high | Check the selected scope, display aliases, duplicate record IDs, and whether the number means unique names or contributor appearances. |
| Category totals exceed records | Check multi-valued types/themes before treating the totals as duplication. |
| A large 2020 spike | Inspect posted dates: 91 saved entries are dated March 2020. This is not proof of a publication-output surge. |
| An expected contributor is absent | Check missing bylines, spelling, roster-only mode, and active filters. |
| Network loses links at a higher threshold | Confirm that link weights fall below the threshold and that isolated contributors remain listed. |
| An edited export disappears | Correct the input or transformation and rebuild; generated files are not the source of truth. |

## 11. Publish a reviewed revision

Review the changed source and regenerated exports, run the checks, commit them, and publish the static application through the repository's GitHub Pages configuration. Relative asset paths allow the application to run under a project URL. GitHub Pages serves an HTML entry point; it does not provide a Python backend for this application. [GitHub Pages setup](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

After deployment, repeat the short browser check on the published URL. A successful upload establishes deployment, while opening the tabs, filtering, and downloading the data checks actual behavior.

## Code reading map

| File | Read first |
| --- | --- |
| `scripts/build_data.py` | `build_dataset()`, `csv_text()`, `main()` |
| `scripts/validate_data.py` | `TYPE_CLASSES`, `safe_url()`, `validate_dataset()`, `load_data_js()` |
| `scripts/collect_sources.py` | `PageMetadata`, `request_bytes()`, `read_robots()`, `collect()`, `main()` |
| `assets/data-model.js` | `matches()`, `tally()`, `buildContributorGraph()` |
| `assets/app.js` | `showView()`, `createScope()`, `renderCounts()`, `buildNetwork()`, `tick()`, `drawNetwork()` |
| `index.html`, `assets/styles.css` | Structure, control IDs, script order, layout, and visual variables |
| `tests/` | Small examples that define expected counting and failure behavior |
| `serve.js` | Static HTTP file delivery for local development |

The useful engineering pattern is a preserved input, explicit transformations, repeatable validation, shared aggregation logic, and a visible path from every summary back to its source records.
