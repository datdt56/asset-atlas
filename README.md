# Asset Atlas

A small React + TypeScript application that turns messy XLSX/CSV computer inventories into editable, searchable asset records. Files are processed in the browser. There is no backend, AI API, API key, or database.

## Run

Requires Node 18.20+ (Node 20+ recommended).

```sh
npm install
npm run dev
```

Upload a spreadsheet, drop one onto the upload area, or choose **Try a sample spreadsheet**. Both supplied samples are included as demonstration data.

```sh
npm test
npm run format:check
npm run build
npm start
```

`npm start` serves the production build using Vite preview. Build output is a static `dist/` folder; deploy it to a static host. `.openai/hosting.json` points the existing private Site at this folder. No environment variables are required. Old local `.env.local` files, if present, are ignored and unused by application code; never use `VITE_*` variables for secrets.

## One extraction pipeline

```text
Read sheets → find headers → exact/fuzzy column mapping → parse values → review/export
```

1. **Read:** SheetJS reads every sheet and preserves the original cell text, sheet name and row number. Column order does not matter.
2. **Find headers:** scan the first 50 rows and choose the row with the most distinct recognized fields. Titles, empty rows, repeated headers and totals are handled separately. When there is no evidence, ask the user to choose a header row.
3. **Map columns:** normalize Unicode, case, punctuation and spacing. Try the small alias dictionary first (`Make` → manufacturer, `S/N` → serial). Then use **Fuzzball.js** `ratio()` for typos such as `Manufaturer` and `Memroy`. Rank by canonical field, requiring a score of at least 82/100 and a lead of 10 points over the next field. These are conservative working thresholds tested on fixtures, not statistical confidence estimates. Unknown short acronyms stay unresolved.
4. **Parse values:** take explicit columns first, then use regular expressions for common combined specifications. Recognize CPU patterns, RAM, drive counts/media and explicit screen dimensions. Normalize RAM to GB; `16384 MB`, `16 gig`, and `16GB` become `16 GB`. A lone unlabeled capacity is flagged instead of automatically becoming RAM.
5. **Review:** inspect source cells, edit extracted values, fix column mappings, choose header rows or exclude sheets. Unknown manufacturers in explicit columns are preserved verbatim; a short brand/product dictionary is used only to infer information from combined descriptions.
6. **Export:** download the filtered inventory as CSV or JSON. CSV includes the eight core fields and source sheet/row; JSON also contains original cells, inferred-field flags and warnings. CSV formula prefixes are escaped.

Common administrative headers (location, notes, assignee, cost centre, asset tag) are ignored automatically but remain in source details. Unknown columns remain visibly unresolved. Exporting with unresolved columns asks for acknowledgement that those columns will be omitted.

Multiple columns assigned to a singleton field such as serial number require correction. Description/storage columns may be combined using `/`. Mapping changes reset asset edits after confirmation. Direct asset edits recompute missing-value and duplicate warnings; manually edited fields stop being marked as inferred. Refreshing the page clears session data.

## Structure

| File                     | Responsibility                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `src/extract.ts`         | Workbook reading, asset types, value parsing, normalization, warnings and CSV output |
| `src/mapping/fields.ts`  | Small field-alias dictionary and administrative headers                              |
| `src/mapping/resolve.ts` | Header normalization, library-based fuzzy matching and duplicate-mapping checks      |
| `src/main.tsx`           | Upload, mapping repair, inventory, source inspection and editing                     |
| `src/style.css`          | Responsive styling                                                                   |

SheetJS handles spreadsheet formats. Fuzzball.js handles spelling similarity. The application adds the domain rules needed to interpret computer specifications; it does not implement its own string-distance algorithm.

## Validation

Tests cover both supplied files and a generated unseen multi-sheet workbook with moved, reordered and misspelled headers. They also cover combined server specifications, leading-zero serials, unfamiliar manufacturers, ambiguous capacities, duplicate serials, edits, peripheral detection, and CSV formula escaping.

Regression cases explicitly check that `ThinkCentre M720q` is not parsed as CPU `M7`, that dedicated RAM does not leak into storage, and that an unlabeled `512GB` is not asserted to be RAM. The tests verify field values as well as row counts. Browser interaction testing is separate from these automated checks.

## Tradeoffs and limits

The goal is a reliable, explainable challenge submission rather than universal spreadsheet understanding. The app handles common inventory variations and provides correction when evidence is insufficient.

- Fuzzy matching recognizes spelling differences, not arbitrary synonyms or meaning. Unfamiliar column terminology may need manual mapping.
- Product/brand inference from a combined description has limited vocabulary. Explicit manufacturer/model columns accept arbitrary values.
- Combined-value parsing assumes common specification ordering when capacities are unlabeled. More unusual arrangements can need correction. Values are never looked up from a product catalogue.
- One table layout per sheet is supported. Headers beyond the initial detection region, transposed inventories and headerless files require preparation or manual selection. The header-row dropdown includes all rows for manual recovery.
- Blank cells stay blank; incomplete records remain visible when at least one mapped specification is available. Totals and repeated headers are skipped.
- Files are limited to 15 MB and sheets to 50,000 rows / 500 columns. Parsing runs on the main thread. Decompression happens before row limits are checked, so hostile zip archives are outside this prototype's protection.
- The npm `xlsx` package has a known high-severity advisory. Review the maintained SheetJS distribution before production use. Static deployment does not remove spreadsheet-parser risks.
- Fonts are requested from Google Fonts; spreadsheet contents are not sent there. No application request sends file data or headers to an external service.

## AI assistance

OpenAI Codex assisted with implementation, UI styling, tests and documentation. No AI model runs inside the application. An earlier cloud-embedding experiment was removed to keep deployment and the extraction workflow small and predictable.
