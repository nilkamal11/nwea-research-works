# Explaining the research-library project

## A concise project explanation

“The question behind this project is how to make a research-library inventory easier to explore: what topics and publication types it contains, which contributors appear on the records, and where those contributors overlap.

“The application uses a saved snapshot of 317 NWEA library entries. I would describe those as library records, because a journal article, working paper, brief, and appendix can refer to the same study. The dates are the website's posted dates, so I also avoid treating the year chart as a definitive publication-history analysis.

“The preparation code is Python. It reads a preserved JSON snapshot, applies documented display corrections, derives publication classes and saved-roster matches, and runs validation before writing the browser dataset and CSV. The checks cover unique IDs and URLs, dates, required fields, category mappings, and contributor lists. Missing metadata is reported rather than invented.

“The browser code is plain JavaScript and Canvas. Shared functions handle filtering and aggregation. For the network, I take each record's distinct contributors and create all the unique pairs. If three people appear on an entry, that produces three pair occurrences. The weight of an edge is the number of selected entries the two contributors share. Clicking a contributor takes the user back to the records, so the visual can be checked against its evidence.

“The important design decision is to keep the analytical meaning visible. A roster match is a name match, not employment history. A shared record indicates co-contribution, not the strength or quality of a professional relationship. The graph supports exploration, and the underlying records support interpretation.”

## Questions to rehearse

**Why Python for this?** The preparation involves JSON files, normalization rules, validation, and multiple exports. Python's standard library handles that small batch workflow directly. There is no database in this project. SQL could implement the relational counting if the source lived in a database; it is not necessary for this particular inventory.

**Is it D3?** This implementation uses plain JavaScript and Canvas 2D. The layout applies repulsion and attraction forces directly, with controls for strong forces around hubs and overlapping nodes. D3 is another possible implementation, but it is not loaded here. Node.js runs the local server and tests; Python does not run in the visitor's browser.

**How do you know the counts are right?** Define the record first, enforce unique source IDs, test the pair-counting logic on small examples, and reconcile the filtered list against summary counts. A multi-author record legitimately contributes several pairs, and a multi-type record can count under several categories. Those are different denominators.

**What data problem did the review surface?** Three displayed contributor lists contained “Shannon Bi” where the saved byline said “Sharon Bi.” The correction restores the byline spelling only on those reviewed entry IDs. Separating the names increases the distinct display-name count from 227 to 228 without adding records or contributor appearances. Other inherited aliases remain documented as unverified. This is a concrete example of preserving evidence while correcting a transformation.

**Can the source collection be reproduced?** The offline build can be reproduced from the committed snapshot. The original scraper and raw HTTP responses were not supplied. A separate collector now supports a forward workflow that retrieves candidate API and publication-page records for review. It does not automatically replace the published inventory.

**What would improve it next?** Verified author identifiers, original publication dates, and reviewed links between versions of the same study would improve the analysis more than adding another chart. Each would need source evidence and additional validation.

## Demo sequence

1. Open Works; explain the snapshot and select a contributor.
2. Show source links and the distinction between types and broader classes.
3. Show Counts; explain multi-valued categories and posted years.
4. Open Collaborations; explain nodes, shared-record edges, and the threshold.
5. Select a contributor and inspect the source records or accessible tables.
6. Show the QA report and one relevant test or function if technical detail is requested.

Rehearsal cues: **question → record definition → preparation → checks → pairs → visual → limitations.**

For the complete code path, commands, and source references, see [BUILD_GUIDE.md](BUILD_GUIDE.md).
