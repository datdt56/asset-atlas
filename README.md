# Asset Atlas

A React + TypeScript workbench for messy XLSX/CSV computer inventories. Local parsing runs immediately in the browser. Optional LLM assistance can interpret unfamiliar columns and combined specifications for rows you select.

## Run locally

Requires Node 18.20+; Node 20+ recommended.

```sh
npm install
cp .env.example .env.local
chmod 600 .env.local
npm run dev
```

Local parsing works without any key. To enable AI, put your own key in `.env.local` using your editor and restart the server:

```dotenv
OPENAI_API_KEY=replace-with-your-key
LLM_MODEL=gpt-6-luna
```

The placeholder is deliberately unusable. `gpt-6-luna` is the default small model; `LLM_MODEL` is a server-only override and must support Structured Outputs and reasoning effort `none`. Model availability depends on your account. [Official model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).

```sh
npm test
npm run format:check
npm run build
npm start
```

`npm start` serves the built frontend and API at `http://127.0.0.1:4173`. Both development and production-test adapters bind to loopback. Vite preview or a static-only host will not provide the AI endpoint.

## Local extraction

```text
Read sheets → find headers → exact/fuzzy mapping → parse values → review/export
```

SheetJS reads every sheet and preserves original cells and sheet/row references. Header detection scans the first 50 rows for distinct recognized fields. Exact aliases run first, then Fuzzball.js `ratio()` handles typos using a score of at least 82/100 and a 10-point lead over the runner-up. These are working thresholds, not confidence probabilities. Unknown short acronyms remain unresolved.

Explicit columns take priority. Small description rules recognize common CPU, capacity, drive-media, product-family and screen patterns. Explicit RAM/storage labels outrank positional inference. RAM units normalize to GB; bare numeric RAM remains unchanged unless the header supplies a unit. A lone unlabeled capacity stays ambiguous. Manufacturer/model columns accept arbitrary values; a short dictionary only helps infer brands and types from descriptions.

Review results in the inventory, inspect original cells, edit values, fix mappings, select header rows or exclude sheets. Unknown-column source rows remain visible even when local parsing extracts no core fields, so they can be inspected or selected for AI. Administrative-only rows without asset information are not promoted into assets. Duplicate and missing-value warnings update after edits.

CSV/JSON export uses the current filter. CSV includes the eight fields and source sheet/row and escapes formula prefixes; JSON also includes original cells, inferred-field flags and warnings. Unknown columns require acknowledgement before exporting partial results. Multiple description/storage columns may be joined with `/`; conflicting singleton mappings require review. Refresh clears session data.

## Optional AI workflow

1. Select rows using the table checkboxes (up to 100 per action).
2. Click **AI review**.
3. Choose columns and inspect the exact indexed cell payload. Unknown column names are supported. Known serial/administrative columns are excluded by default; unknown columns are included and may still contain personal or confidential data.
4. Click **Send selected cells to AI**. Nothing is sent before this explicit action.
5. Review proposed values next to current values and quoted source evidence.
6. Choose field changes and click **Apply**. Close to discard them instead.

The client deduplicates identical selected cells within an action, then sends sequential requests of up to 20 unique rows, also bounded by input size. IDs attach results to the correct source rows even if the provider reorders them. All batches are validated before the first paid call. A failure or cancellation keeps completed batches available for review and does not change local results.

Output uses one strict schema for type, manufacturer, model, serial, CPU, RAM, storage and screen size, with `null` for unavailable information. Each proposed field includes an exact source-column key and quoted substring. Both client and server validate schema, complete/unique row IDs and the existence of evidence. Evidence existence **does not prove the proposed interpretation is correct**; human review is required. Spreadsheet text is treated as data, never as instructions. No tools or product lookup are enabled. [Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

Empty or locally inferred fields are initially selected for review. Existing explicit-column values are unselected; you can deliberately select a replacement. Existing session edits (including previously applied suggestions) are protected. Nothing overwrites them automatically. Applying selected changes recomputes inventory warnings. Importing another file or changing mappings closes the review and cancels pending work.

## API keys and production

- Local keys belong only in Git-ignored `.env.local`. Commit `.env.example` placeholders only. Never put keys in source, chat, screenshots, browser storage, `VITE_*` / `NEXT_PUBLIC_*` variables, or `.openai/hosting.json`.
- Production keys belong in the hosting provider's runtime secret store as `OPENAI_API_KEY`; set `LLM_MODEL` as a server runtime variable if needed. Use a dedicated restricted project key, usage monitoring and enforced spend controls. Rotate exposed credentials.
- The frontend calls only `/api/ai-extract`. The official OpenAI SDK runs exclusively on the server. Zod defines request/result validation and generates the strict response schema.
- API calls disable stored Responses (`store: false`), automatic SDK retries, and model reasoning. They have a 45-second timeout and an 8,000-output-token cap. Provider retention policies still apply; `store: false` is not a promise of zero retention or zero cost after cancellation.
- Limits: 20 rows/request, 50 nonempty cells/row, 2,000 characters/cell, 32,000 JSON characters, and a 64 KB body. Oversized inputs are rejected, never silently truncated.
- Hosted calls require the platform-injected `oai-authenticated-user-id`; local loopback mode does not. Preserve the private Site access policy. Do not directly expose the local adapter or trust this header on another host without a trusted authentication gateway.
- Server limits are ten paid requests/minute per identity and two simultaneous requests per instance. These are in-memory limits, not global spend protection. A public scaled deployment needs shared authorization/rate limiting and budget enforcement. Browser selection limits alone are not security controls.

The build produces `dist/server/index.js`, a Cloudflare-compatible Worker with frontend assets embedded for the existing Sites deployment. The Worker reads secrets at runtime; the archive and client bundle contain no key. This project needs a server-capable deployment for AI. Missing keys return an actionable message while local parsing remains usable.

## Files

| File                                           | Responsibility                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `src/asset-fields.ts`                          | Shared canonical fields and labels                                      |
| `src/extract.ts`                               | Workbook reading, row assembly, source tracking, warnings and CSV       |
| `src/parse.ts`                                 | Small local normalization and description helpers                       |
| `src/mapping/`                                 | Header aliases and library-based typo matching                          |
| `src/ai-schema.ts`                             | Zod contracts, batch limits and evidence/ID validation                  |
| `src/ai.ts`                                    | Batching, deduplication, client requests and protected edit application |
| `src/components/AiReview.tsx`                  | Column preview, progress and suggestion review                          |
| `src/main.tsx`                                 | Inventory workflow and selected rows                                    |
| `server/ai.ts`                                 | Authenticated, bounded OpenAI request using the official SDK            |
| `vite.config.ts`, `server/node-adapter.ts`     | Local API integration                                                   |
| `scripts/build-worker.mjs`, `scripts/serve.ts` | Deployment packaging and local production preview                       |

## Validation and limits

Parser tests cover both supplied files and an unseen generated workbook, CPU/model boundary regressions, RAM/storage separation, labeled capacities in either order, unknown manufacturers, leading-zero serials, unknown columns, edits and CSV escaping. AI tests use mocked provider responses to check the actual SDK request, strict output format, arbitrary keys, batch size/deduplication, reordered IDs, evidence rejection, partial failures, cancellation, existing edits, missing credentials, rate limits, incomplete responses, refusal and error redaction.

Mocked tests verify integration, not real-model extraction quality. A live evaluation requires your key and representative held-out spreadsheets. Browser interaction testing is separate from parser/API tests.

Local parsing supports one table layout per sheet, common specification ordering and a limited product vocabulary. Unfamiliar meanings may need manual mapping or optional AI. Headerless/transposed inventories and multiple tables with different schemas need preparation. Files are limited to 15 MB and sheets to 50,000 rows / 500 columns; parsing is on the main thread and row limits run after decompression. Hostile zip archives remain outside this prototype's protection. The npm `xlsx` package has a known high-severity advisory; evaluate the maintained SheetJS distribution before production use.

Fonts are fetched from Google Fonts. Local mode does not send spreadsheet contents to external services. AI mode sends only selected cell names/values and row IDs through the server to OpenAI; the application does not log or persist these cells, but its provider's policies apply.

## AI assistance disclosure

OpenAI Codex assisted with implementation, styling, tests and documentation. The optional runtime LLM uses OpenAI Responses with schema-constrained output. Local parsing remains independent; there is no embedding layer or automatic AI processing on upload.
