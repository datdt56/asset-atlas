# Asset Atlas

A TypeScript + React workbench for turning inconsistent CSV/XLSX inventories into reviewable asset data. Spreadsheet parsing and asset rows stay in the browser. An optional server endpoint sends unresolved header text to OpenAI's `text-embedding-3-small` model.

## Run

Requires Node 18.20+; Node 20+ recommended.

```sh
npm install
cp .env.example .env.local
chmod 600 .env.local
npm run dev
```

Fill in `OPENAI_API_KEY` in `.env.local` using your editor, then restart the server. The placeholder is intentionally unusable. Without a key, exact/fuzzy matching and manual mapping still work; the UI explains that cloud matching is not configured.

```dotenv
OPENAI_API_KEY=replace-with-your-key
EMBEDDING_AUTO_ACCEPT=false
```

For a local production smoke test:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:4173`. Both development and local production servers bind to loopback. `vite preview` alone does not provide the API. Use the printed development URL with `npm run dev`.

## Key storage and deployment

- **Local:** keep the key only in `.env.local`, which is ignored by Git. `.env.example` contains names and placeholders only. Do not paste real keys into chat, source, terminal commands, screenshots, or logs.
- **Production:** configure `OPENAI_API_KEY` as a runtime secret in your hosting provider's secret manager. Set `EMBEDDING_AUTO_ACCEPT` as a server runtime variable if needed. Never place secrets in `.openai/hosting.json` or build arguments.
- **Never use `VITE_OPENAI_API_KEY` or `NEXT_PUBLIC_OPENAI_API_KEY`.** Those prefixes expose values to browser code. The frontend calls only the same-origin `/api/header-mapping` endpoint; the server calls OpenAI.
- Use a dedicated project key with the minimum permissions needed for embeddings, monitor usage, configure project spend controls, and rotate the key if exposed. See [OpenAI's production guidance](https://developers.openai.com/api/docs/guides/production-best-practices).

The build emits a Cloudflare-compatible Worker at `dist/server/index.js` that serves the built frontend, sample files, and API route. Assets are embedded into the Worker during packaging. `.openai/hosting.json` preserves the existing Site ID and declares a server deployment rather than a static deployment. The build never reads a key into the Worker output; keys are read from runtime bindings.

On Sites, preserve owner-private access. The hosted endpoint also requires the platform-injected `oai-authenticated-user-id`; no identity is required in loopback-only local mode. Do not directly expose the local adapter or deploy the Worker on another platform without implementing trusted authentication. Same-origin checks are an additional request restriction, not authentication. The endpoint enforces 1–100 headers, 160 characters per header, a 32 KB body limit, a 15-second provider timeout, up to four concurrent provider calls per instance, and ten calls per minute per identity. In-memory limits reset with the instance and are not global spend protection: a public multi-instance deployment needs shared rate limiting and authorization.

## Layered mapping

1. **Normalize + exact aliases:** Unicode compatibility normalization, lowercase, token-preserving punctuation cleanup, and a shared alias dictionary. Explicit aliases cover `S/N`, `RAM (GB)`, and combined description headers.
2. **Fuzzy matching:** normalized optimal string alignment distance handles adjacent transpositions. Rank by canonical field, accept only with similarity at least `0.88` and a margin of `0.10`. Unknown acronyms of three characters or fewer stay manual-only.
3. **Cloud embeddings:** only unresolved eligible headers are sent to the server and embedded by OpenAI, together with canonical descriptions when those vectors are not cached. The server fixes the model to `text-embedding-3-small`, requests 512 dimensions and float vectors, and ranks fields with cosine similarity. No spreadsheet cell values or source rows are included. [API reference](https://developers.openai.com/api/reference/resources/embeddings/methods/create).
4. **Manual resolution:** inspect the method, alternatives, similarity scores, and source examples; select a field or explicitly ignore a column. Manual decisions take priority over late API responses. New imports/header rows invalidate pending requests.

**Embedding matches are suggestions by default.** This prevents uncalibrated semantic scores from silently changing data. Setting `EMBEDDING_AUTO_ACCEPT=true` enables experimental acceptance with cosine similarity at least `0.65` and a margin of `0.08`. These values are starting points, not validated confidence estimates. Evaluate held-out real headers before enabling automatic acceptance. Fuzzy scores and cosine similarities are different measures, not probabilities.

Canonical embedding vectors are cached in server memory; repeated complete header batches are cached in bounded browser session memory. Uploaded headers are not retained in a server cache or application logs. The application does not control the provider's data retention policy. Offline/API failures keep manual mapping available. Ignoring a column prevents it from being sent in subsequent matching requests.

## Review workflow

Upload `.xlsx` or `.csv` up to 15 MB. Each sheet's first 50 rows are ranked using distinct exact/fuzzy matches; a zero-evidence choice requires confirmation in the mapping panel. Users can change header rows and exclude sheets. Headerless or transposed inventories still need preparation.

The mapping panel distinguishes unresolved columns from deliberate Ignore choices. Unresolved columns are omitted from the preview, with an explicit acknowledgement required before exporting partial results. Duplicate assignments to singleton fields, such as serial number, become unresolved. Multiple description/storage columns are joined with `/`. Changing mappings clears asset edits after confirmation when edits exist.

Combined descriptions are parsed for manufacturers, product families, CPU, RAM, disk configurations, and screen dimensions. Explicit columns take precedence. RAM normalizes to GB and disk multiplicity is preserved rather than claiming usable RAID capacity. Empty rows, repeated headers and totals are skipped. Missing serials, unknown types, inferred values, peripherals and duplicate serials receive review warnings. Duplicates are retained for inspection.

Search and filter the inventory, click a row to compare fields with original cells, edit values, and export the filtered view. CSV contains core fields plus sheet/row provenance and escapes formula prefixes. JSON also includes original cells and extraction warnings. Header matching metadata is visible in the mapping panel; asset-level `inferred` flags describe value extraction separately.

## Architecture and validation

- `src/mapping/fields.ts`: canonical fields, aliases and semantic descriptions.
- `src/mapping/resolve.ts`: normalization, exact/fuzzy decisions, conflicts and manual precedence.
- `src/mapping/cloud.ts`: same-origin API client and bounded session cache.
- `src/extract.ts`: workbook reading and asset-value extraction.
- `src/main.tsx`: import, mapping review, async lifecycle, editing and exports.
- `server/embeddings.ts`: validated, authenticated embedding route with an injectable fetch provider.
- `vite.config.ts` / `server/node-adapter.ts`: local server integration; secrets stay server-side.
- `scripts/build-worker.mjs`: packages frontend assets and the server as a Worker.

```sh
npm run format:check
npm test
npm run build
```

Tests cover both supplied samples, unseen aliases/typos, normalization, abstention, conflicts, manual precedence, request validation, identity/origin checks, missing credentials, provider errors, vector ordering, caching and rate limits. Embedding tests use deterministic mocked vectors; they verify integration and decision rules, **not real-model semantic accuracy**. A live provider check requires your own key. Browser interaction testing is separate from these checks.

## Remaining limits

No universal parser handles every spreadsheet. Headers outside the first 50 rows, multiple tables with differing schemas in one sheet, and unfamiliar language/product terminology need user correction. Combined RAM/storage inference assumes the first bare non-TB capacity is RAM. Screen size is extracted only when explicit; serials only from mapped columns. Refresh clears files, edits and client caches. Extraction warnings describe original data and remain after editing.

A per-sheet 50,000-row / 500-column limit is checked after decompression, so hostile zip archives remain outside this prototype's protection. Large-file parsing should move to a worker with decompression bounds. The npm `xlsx` release is used for prototype interoperability; production should evaluate the maintained SheetJS distribution and audit dependencies. Fonts are fetched from Google Fonts; spreadsheet contents are never sent there.

## AI assistance

OpenAI Codex assisted with design, TypeScript implementation, heuristics, styling, tests and documentation. The application optionally calls OpenAI's embedding API for header similarity; no generative chat model processes files or follows instructions from spreadsheet text.
