# Asset Atlas

A Next.js + React + TypeScript workbench for messy XLSX/CSV computer inventories. Local parsing runs immediately in the browser. Optional LLM assistance can interpret unfamiliar columns and combined specifications for rows you select.

## Run locally

Requires Node 20.9+; `.nvmrc` selects Node 22. With nvm, run `nvm install` and `nvm use` first.

```sh
npm install
cp -n .env.example .env.local
chmod 600 .env.local
npm run dev
```

Run these commands from the `asset-atlas` directory. `cp -n` preserves an existing `.env.local`.

Local parsing works without any key. To enable AI, put your own key in `.env.local` using your editor and restart the server:

```dotenv
OPENAI_API_KEY=replace-with-your-key
LLM_MODEL=gpt-6-luna
```

The placeholder is deliberately unusable. `gpt-6-luna` is the default small model; `LLM_MODEL` is a server-only override and must support Structured Outputs and reasoning effort `none`. Model availability depends on your account. [Official model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).

```sh
npm test
npm run typecheck
npm run format:check
npm run build
npm start
```

`npm run dev` and `npm start` serve the page and API together at `http://127.0.0.1:3000`. Next.js loads `.env.local` automatically. The local scripts bind to loopback. No separate API server or build adapter is needed. Run `npm run typecheck` for a standalone TypeScript check.

## Local extraction

```text
Read sheets → find headers → exact/fuzzy mapping → parse values → review/export
```

SheetJS reads every sheet and retains formatted cell text and sheet/row references. Source values are trimmed, and placeholders such as `N/A`, `none` and `unknown` become empty strings; the retained cells are not a byte-for-byte copy of the workbook. Header detection scans the first 50 rows for distinct recognized fields. Exact aliases run first, then Fuzzball.js `ratio()` handles typos using a score of at least 82/100 and a 10-point lead over the runner-up. These are working thresholds, not confidence probabilities. Unknown short acronyms remain unresolved.

Explicit columns take priority. Small description rules recognize common CPU, capacity, drive-media, product-family and screen patterns. Explicit RAM/storage labels outrank positional inference. RAM units normalize to GB; bare numeric RAM remains unchanged unless the header supplies a unit. A lone unlabeled capacity stays ambiguous. Manufacturer/model columns accept arbitrary values; a short dictionary only helps infer brands and types from descriptions.

Review results in the inventory, inspect original cells, edit values, fix mappings, select header rows or exclude sheets. Unknown-column source rows remain visible even when local parsing extracts no core fields, so they can be inspected or selected for AI. Rows containing only recognized administrative columns are omitted. Unresolved columns can retain rows that still need review. Duplicate and missing-value warnings update after edits.

CSV/JSON export uses the current filter. CSV includes the eight fields and source sheet/row and escapes formula prefixes; JSON also includes original cells, inferred-field flags and warnings. Unknown columns require acknowledgement before exporting partial results. Multiple description/storage columns may be joined with `/`; conflicting singleton mappings require review. Changing mappings, header rows or enabled sheets resets session edits after confirmation. Refresh clears session data.

## Optional AI workflow

1. Select rows using the table checkboxes (up to 100 per action).
2. Click **AI review**.
3. Choose columns and preview the selected rows and indexed cell values. Unknown column names are supported. Known serial/administrative columns are excluded by default; unknown columns are included and may still contain personal or confidential data.
4. Click **Send selected cells to AI**. Nothing is sent before this explicit action.
5. Review proposed values next to current values and quoted source evidence.
6. Choose field changes and click **Apply**. Close to discard them instead.

The client deduplicates identical selected cells within an action, then sends sequential requests of up to 20 unique rows, also bounded by input size. IDs attach results to the correct source rows even if the provider reorders them. All batches pass client-side schema and character-size checks before the first paid call. The server also enforces a 64 KiB UTF-8 body limit; a request with multibyte text may exceed it even when the character-size check passes. A failure or cancellation keeps completed batches available for review and does not change local results.

Output uses one strict schema for type, manufacturer, model, serial, CPU, RAM, storage and screen size, with `null` for unavailable information. AI type values are constrained to `Laptop`, `Desktop`, `Server`, `Workstation`, `NAS`, `Monitor`, `Peripheral` and `Other`. Unknown types remain `null`; `Other` is reserved for an identified asset outside those categories. The prompt and Zod enum share the list in `src/asset-fields.ts`; other field values remain free-form strings. The enum constrains AI suggestions only; manual and explicit-column type values can remain outside it. Explicit-column values are not replaced automatically, but the user can select a replacement during review. Each proposed field includes an exact source-column key and quoted substring. Both client and server validate schema, complete/unique row IDs and the existence of evidence. Evidence existence **does not prove the proposed interpretation is correct**; human review is required. Spreadsheet text is treated as data, never as instructions. No tools or product lookup are enabled. [Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

Empty or locally inferred fields are initially selected for review. Existing explicit-column values are unselected; you can deliberately select a replacement. Existing session edits (including previously applied suggestions) are protected. Nothing overwrites them automatically. Applying selected changes recomputes inventory warnings. Importing another file or changing mappings closes the review and cancels pending work.

## API keys and production

- Local keys belong only in Git-ignored `.env.local`. Commit `.env.example` placeholders only. Never put keys in source, chat, screenshots, browser storage, `VITE_*` / `NEXT_PUBLIC_*` variables, or `.openai/hosting.json`.
- Production keys belong in the hosting provider's runtime secret store as `OPENAI_API_KEY`; set `LLM_MODEL` as a server runtime variable if needed. Use a dedicated restricted project key, usage monitoring and enforced spend controls. Rotate exposed credentials.
- The frontend calls only `/api/ai-extract`. The official OpenAI SDK runs exclusively on the server. Zod defines request/result validation and generates the strict response schema.
- API calls disable stored Responses (`store: false`), automatic SDK retries, and model reasoning. They have a 45-second timeout and an 8,000-output-token cap. Provider retention policies still apply; `store: false` is not a promise of zero retention or zero cost after cancellation.
- Limits: 20 rows/request, 50 nonempty cells/row, 2,000 characters/cell, 32,000 JSON characters, and a 64 KiB body. Oversized inputs are rejected, never silently truncated.
- Development works without a login on localhost. In production, set a long random `APP_PASSWORD` in the host’s runtime secrets. The browser prompts for username `atlas` and that password; Next.js verifies it again at the API boundary. Use HTTPS. Without this setting, local parsing remains available but production AI returns 503. This simple shared-password gate suits a private demonstration; a multi-user product should use a proper identity provider. Caller-supplied hosting identity headers are not trusted.
- Server limits are ten paid requests/minute per identity and two simultaneous requests per instance. The shared-password production gate uses one identity for all signed-in users, so they share that ten-request allowance on each instance. These are in-memory limits, not global spend protection. A public scaled deployment needs shared authorization/rate limiting and budget enforcement. Browser selection limits alone are not security controls.

Deploy to a Next.js-compatible host (for example Vercel), with `asset-atlas` as the project root, or run `npm run build` followed by `npm start` behind your HTTPS reverse proxy. For a container, override the loopback bind with `next start --hostname 0.0.0.0`. Configure secrets on the host; do not upload `.env.local`. Static export cannot run the AI endpoint.

The former Sites Worker packaging and custom Node server have been removed. `.openai/hosting.json` retains the historical project identity, not a Next.js deployment configuration. The existing Sites demo has not been redeployed with this migration because that runtime expects a Worker bundle. Use a Next.js host for this version.

## Files

| File                                             | Responsibility                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `src/app/layout.tsx`, `src/app/page.tsx`         | Next.js document, metadata and page entry                          |
| `src/components/AssetAtlas.tsx`                  | Client-side inventory workflow and selected rows                   |
| `src/extract.ts`, `src/parse.ts`, `src/mapping/` | Local workbook extraction, normalization and fuzzy header matching |
| `src/asset-fields.ts`                            | Shared canonical fields and labels                                 |
| `src/ai-schema.ts`                               | Zod contracts, batch limits and evidence/ID validation             |
| `src/ai.ts`, `src/components/AiReview.tsx`       | Client batching, payload preview and suggestion review             |
| `src/app/api/ai-extract/route.ts`                | Server-only Next.js POST endpoint                                  |
| `src/server/ai.ts`                               | Bounded OpenAI request using the official SDK                      |
| `src/server/auth.ts`, `src/proxy.ts`             | Private demonstration authentication                               |

The page renders a Client Component so files, parsing and inventory edits stay in the browser. Only an explicit AI action posts selected cells to the Route Handler, which validates the request, calls the provider and returns validated suggestions. Next.js owns both routes in a single application.

## Validation and limits

Parser tests cover both supplied files and an unseen generated workbook, CPU/model boundary regressions, RAM/storage separation, labeled capacities in either order, unknown manufacturers, leading-zero serials, unknown columns, edits and CSV escaping. AI tests use mocked provider responses to check the actual SDK request, strict output format, arbitrary keys, batch size/deduplication, reordered IDs, evidence rejection, partial failures, cancellation, existing edits, missing credentials, rate limits, incomplete responses, refusal and error redaction.

Verification completed during implementation: 40 automated tests, TypeScript and Prettier checks pass. A Next.js production build and development/production HTTP smoke checks passed during the migration. After the prompt/enum update, one live synthetic request succeeded: it returned `Laptop`, normalized `16384 MB` to `16 GB`, and preserved a leading-zero serial. That small check does not establish accuracy on unseen files. Full browser interaction QA and live evaluation on held-out spreadsheets remain pending.

Local parsing supports one table layout per sheet, common specification ordering and a limited product vocabulary. Unfamiliar meanings may need manual mapping or optional AI. Headerless/transposed inventories and multiple tables with different schemas need preparation. Files are limited to 15 MB and sheets to 50,000 rows / 500 columns; parsing is on the main thread and row limits run after decompression. Hostile zip archives remain outside this prototype's protection. The npm `xlsx` package has a known high-severity advisory; evaluate the maintained SheetJS distribution before production use.

Fonts are fetched from Google Fonts. Local mode does not send spreadsheet contents to external services. AI mode sends only selected cell names/values and row IDs through the server to OpenAI; the application does not log or persist these cells, but its provider's policies apply.

## AI assistance disclosure

OpenAI Codex assisted with implementation, styling, tests and documentation. The optional runtime LLM uses OpenAI Responses with schema-constrained output. Local parsing remains independent; there is no embedding layer or automatic AI processing on upload.
