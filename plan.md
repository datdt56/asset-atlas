# Simple local-first implementation

## Scope

Build a complete, explainable coding-challenge submission using React, TypeScript
and two libraries: SheetJS for spreadsheet reading, Fuzzball.js for header typos.
Keep a single processing path and manual correction for uncertain cases.

```text
Upload → read every sheet → find header row → map columns
       → parse/normalize specifications → review → export
```

There is no embedding layer, LLM integration, server API, database or API key.
The build is a static site. No custom string-distance algorithm is needed.

## Implemented

- [x] Read XLSX/CSV with SheetJS; preserve source cells and sheet/row references.
- [x] Detect headers within the first 50 rows independently for each sheet.
- [x] Normalize headers and try a small alias dictionary, then Fuzzball.js `ratio`.
- [x] Accept fuzzy matches at 82/100 only when they lead the next field by 10 points.
      Unknown acronyms and ambiguous matches remain available for correction.
- [x] Keep column decisions as the single source of truth; remove parallel mapping state.
- [x] Automatically ignore common administrative columns while retaining source values.
- [x] Extract the eight requested fields from explicit columns and common combined specs.
- [x] Preserve unfamiliar brands and leading-zero serials in explicit columns.
- [x] Fix CPU token boundaries, RAM/storage duplication, and lone-capacity guessing.
- [x] Support common memory units and preserve disk counts and media.
- [x] Keep incomplete assets visible and recompute review warnings after edits.
- [x] Retain mapping repair, sheet selection, search, source inspection and CSV/JSON export.
- [x] Remove the cloud client, API handler, secret placeholder and Worker build plumbing.
- [x] Test both supplied files and unseen synthetic variations, including field-level regressions.

## Keep it simple

Use the existing small modules: `extract.ts`, `parse.ts`, `mapping/fields.ts`,
`mapping/resolve.ts`, `main.tsx` and `style.css`. Prefer straightforward matching
and a few documented domain rules over additional detection layers or services.

A field alias dictionary is expected domain knowledge, not a complete list of
possible headers. Fuzzy matching handles spelling differences; manual mapping
handles unfamiliar meanings. Brand dictionaries are only hints for descriptions,
never a whitelist for explicit manufacturer values.

## Simple function responsibilities

- [x] `normalizeMemory`: only converts explicit units; bare numbers need a unit from the header.
- [x] `normalizeScreen`: normalizes inches without relabeling centimetres.
- [x] `classifyAssetType`: a small rule lookup rather than nested conditionals.
- [x] `parseDescription`: parses combined specifications and returns values/warnings.
- [x] `extractRow`: preserves explicit values and merges only missing parsed fields.
- [x] `extract`: coordinates sheets and rows without embedding specification parsing.
- [x] Prefer explicit RAM/storage labels before conventional positional inference.

## Before presenting

- [ ] Manually test drag/drop, XLSX and CSV uploads, source inspection, edits,
      mapping repair, excluded sheets, search and both export formats.
- [ ] Demonstrate a file with renamed/reordered columns and headers below title rows.
- [ ] Explain limited synonym/product coverage and one-table-per-sheet support.
- [ ] Review spreadsheet dependency advisories before production use.

Run `npm test`, `npm run format:check` and `npm run build`. Browser QA should be
reported separately; passing parser tests does not prove every UI interaction.
