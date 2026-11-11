# Asset Atlas

A TypeScript + React workbench for turning inconsistent CSV/XLSX inventories into reviewable asset data. All parsing happens in the browser; no API key or backend is needed.

## Run

Requires Node 18.20+ (Node 20+ recommended).

```sh
npm install
npm run dev
npm test
npm run build
```

Open the local URL printed by Vite. Upload either supplied sample, drag in another file, or click **Try a sample spreadsheet**. The sample files are included as public demonstration data.

## Workflow

1. Upload an XLSX or CSV (up to 15 MB).
2. Each sheet's first 50 rows are scored by the number of distinct recognized field names. Highest score becomes the header. Empty rows, repeated headers and total rows are skipped.
3. Aliases identify explicit columns. Combined descriptions are parsed for manufacturers, product families, CPU, memory, disk configurations and screen dimensions. Explicit fields take priority. Memory units normalize to GB; disk multiplicity is retained rather than incorrectly claiming usable RAID capacity.
4. Inspect the inventory, search or filter, and click a row to compare editable fields with original source values. Derived values are identified as inferred, not assigned misleading statistical confidence scores.
5. **Column mapping** lets you change each sheet's header row, include/exclude sheets, and remap every column. Mapping changes regenerate results and reset manual edits.
6. Export the currently filtered view to CSV or JSON. JSON includes provenance, original cells and extraction warnings; CSV contains core fields and sheet/row references. CSV values with formula prefixes are escaped.

## Design decisions

A deterministic parser is fast, explainable and private. It works offline after loading the app, has no model cost and never interprets document text as instructions. Unknown data is left blank instead of fabricated. Missing serials, unrecognized types, inferred values, peripherals and duplicate serials are flagged for review. Duplicate assets remain separate because two rows may represent conflicting records. Every sheet is enabled initially, including old lists; the user decides which to include.

`src/extract.ts` owns parsing and domain types; `src/main.tsx` owns the review interface; `src/style.css` owns responsive styling. `src/extract.test.ts` tests both supplied samples plus an unseen synthetic layout, duplicate detection and export formula escaping.

## Limits and next steps

No universal parser can reliably understand every spreadsheet. Headers outside the first 50 rows, transposed inventories, multiple tables with differing schemas in one sheet, unfamiliar languages and product families need mapping or future parser work. Headerless files require preparation. Combined RAM/storage inference assumes the first bare non-TB capacity is RAM; review inferred values. Manufacturer and type recognition use an extensible product dictionary. Screen sizes are extracted only when explicit; they are never looked up from model names. Serial numbers are taken only from mapped columns. Dedicated storage values preserve original unit formatting. No persistence: refresh clears files and edits. Warnings describe original extraction and stay visible after editing.

A 15 MB file limit and per-sheet 50,000-row / 500-column limits provide basic bounds, but decompression happens before these row limits; this is a challenge prototype, not hardened against hostile zip archives. Large-file parsing should move to a worker with decompression limits. The npm `xlsx` release is used for prototype interoperability; production should evaluate the maintained SheetJS distribution and audit dependencies. Fonts are fetched from Google Fonts; spreadsheet contents are never sent there.

## AI assistance

OpenAI Codex assisted with application design, TypeScript implementation, parsing heuristics, UI styling, tests and this README. No LLM runs inside the application. The tradeoff is transparent heuristics with user correction rather than unpredictable extraction or sending inventory data to a third party.
