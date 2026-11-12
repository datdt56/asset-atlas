# Layered header mapping plan

> Implemented with server-side OpenAI embeddings. Live semantic calibration and
> browser interaction QA remain outstanding; automated integration tests use mocks.

## Goal

Replace the current exact-alias mapper with a progressive pipeline:

```text
Original header
  → normalize + exact alias lookup
  → fuzzy matching for unresolved headers
  → embedding similarity for unresolved headers
  → user resolution for ambiguous or unknown headers
```

Stop at the first reliable match. Keep the original header, matching method,
alternatives, and reason available for review. Users can override any automatic
mapping, including an exact match.

This plan covers **header-to-field mapping**. Keep combined-value parsing, RAM
normalization, duplicate detection, and asset extraction as separate stages.

## Starting point

- `src/extract.ts`: `key()` normalizes headers; `detect()` performs exact alias
  lookup; `mapHeaders()` creates the mapping used by `extract()`.
- `readWorkbook()` also uses `detect()` to choose a header row from the first 50
  rows of each sheet.
- `src/main.tsx`: already provides header-row selection, column mapping, sheet
  selection, source inspection, and asset editing.
- Unknown headers currently become `ignore`, so the app cannot distinguish an
  unresolved column from one deliberately ignored by the user.

## Proposed structure

```text
src/
  mapping/
    fields.ts             # Canonical fields, aliases, semantic descriptions
    resolve.ts            # Decision types, normalization, exact/fuzzy matching,
                          # conflict checks, and manual override precedence
    cloud.ts              # Same-origin API client and bounded session cache
  extract.ts              # Workbook reading and asset-value extraction
  main.tsx                # Import, mapping review, and inventory UI
server/
  embeddings.ts           # Validated OpenAI endpoint and cosine ranking
  node-adapter.ts         # Local HTTP request adapter
scripts/
  build-worker.mjs        # Package frontend and API as a Worker
  serve.ts                # Loopback-only local production server
vite.config.ts            # Development API middleware
```

Keep modules small and independently testable. Do not move unrelated extraction
logic as part of the initial implementation.

## Mapping contract

Use a richer decision type alongside the existing `Mapping` type:

```ts
type TargetField = Field | "description";
type MatchMethod = "exact" | "fuzzy" | "embedding" | "manual";

interface Candidate {
  field: TargetField;
  score: number;
  method: MatchMethod;
}

interface HeaderDecision {
  columnIndex: number;
  original: string;
  normalized: string;
  status: "accepted" | "unresolved" | "ignored";
  field: TargetField | null;
  method: MatchMethod | null;
  candidates: Candidate[];
  reason: string;
}
```

Identify columns by sheet and index, because header labels may be duplicated or
blank. `ignored` represents a deliberate user choice; `unresolved` represents an
incomplete decision. Adapt accepted decisions into the existing `Mapping` for
extraction, while keeping unresolved columns visibly pending in the UI.

Scores belong to their matching method. A fuzzy score and an embedding cosine
similarity are not interchangeable and are not probabilities of correctness.

## Layer 1: normalization and exact matching

Implement a pure `normalizeHeader(raw: string)` function:

- Normalize Unicode compatibility characters and lowercase the result.
- Trim leading/trailing whitespace and collapse repeated spaces.
- Normalize separators such as underscores and hyphens to spaces.
- Handle punctuation consistently, retaining token boundaries.
- Preserve meaningful words and units; do not globally strip words such as
  `size`, `number`, or `memory`.

Normalize the alias dictionary with the same function and build a lookup once.
Explicitly support abbreviations such as `S/N`, `SN`, and `Serial No.` through
aliases. Do not assume removing punctuation alone establishes equivalence.

Examples: ` SERIAL_number` → `serial number`; `RAM (GB)` → `ram gb`, with an
explicit alias for the latter. `CPU / RAM / Disk` remains a combined description
column rather than being assigned to whichever token matches first.

Accept only unique exact matches. Empty headers stay unresolved. Detect alias
collisions in the dictionary rather than resolving them by iteration order.

**Deliverable:** existing supported files behave as before, with decision metadata
and consistent normalization.

## Layer 2: fuzzy matching

Run only for headers unresolved by layer 1.

- Compare normalized headers against normalized aliases using a deterministic
  edit-distance measure that handles transpositions, such as normalized
  Damerau–Levenshtein similarity.
- Aggregate alias scores by canonical field before selecting the best two fields.
  Two similar aliases for RAM should not count as competing field choices.
- Accept only when both the best score and its margin over the runner-up clear
  configured thresholds.
- Start with conservative experimental thresholds, such as a minimum score of
  `0.88` and a margin of `0.10`; tune them against labeled validation cases.
- Keep short acronyms exact-only, since a one-character error can change meaning.
  Do not fuzzy-match `CPU` to `GPU`, or `RAM` to `ROM`.
- Keep alternatives for review when no candidate qualifies.

Example: `Manufaturer` should resolve to manufacturer. `Capacity` should remain
ambiguous between memory and storage instead of receiving a forced assignment.

**Deliverable:** recover ordinary typos without increasing silent incorrect matches
on negative and ambiguous cases.

## Layer 3: cloud embedding similarity

Run only for headers still unresolved after fuzzy matching. Short unknown
acronyms and oversized headers stay manual-only.

- Use OpenAI `text-embedding-3-small` through the same-origin server endpoint
  `/api/header-mapping`. The key is read from `OPENAI_API_KEY` at runtime.
- Keep the placeholder in `.env.example`; put the real key in ignored `.env.local`
  locally or the hosting provider's runtime secret store in production. Never use
  a public frontend environment-variable prefix.
- Send only unresolved header text to OpenAI; source cell values stay local.
- Embed canonical field descriptions and unresolved headers in a batch, request
  512 dimensions, then rank canonical fields using cosine similarity.
- Cache canonical vectors in server memory and repeated header batches in bounded
  browser session memory. No uploaded-header server cache or application logging.
- Return semantic suggestions by default. Experimental automatic acceptance is
  opt-in via `EMBEDDING_AUTO_ACCEPT=true`, requiring similarity at least `0.65`
  and a best-versus-runner-up margin of `0.08`. Calibrate before enabling it.
- Require trusted hosted identity, validate bounded JSON inputs, enforce an
  upstream timeout and per-instance rate/concurrency limits, and redact errors.
- Keep import processing asynchronous with progress and retry messaging. Abort
  obsolete requests and preserve manual mapping when the API fails or is absent.
- Test the provider through injected mocked fetch responses. A live semantic
  evaluation requires a real key and a separate held-out header set.

**Deliverable:** optional cloud suggestions without exposing credentials or
blocking the local extraction and manual review workflow.

## Layer 4: manual resolution

Extend the existing mapping panel instead of creating a separate workflow.

- Surface unresolved columns first, with original headers and a few source cells.
- Show the proposed field, matching method, alternatives, and reason.
- Let users choose a canonical field, combined description, or ignore.
- Keep manual decisions authoritative; late embedding results must never replace
  them. Scope asynchronous results to the active file, sheet, and header row.
- Detect multiple columns assigned to a single-value field such as serial number.
  Ask the user to choose or explicitly confirm how to combine them. Permit
  multiple description or storage columns only with a defined combination rule.
- Keep pending columns visibly unresolved. Show a partial preview and require acknowledgement before exporting unresolved
  columns as omitted.
- Preserve the existing behavior of resetting asset edits when mappings change,
  but explain that consequence before applying a change if edits exist.

Saving reusable mapping templates is a later enhancement, not required for the
first implementation.

## Header-row detection and integration

Separate header-row detection from column resolution so a model is not run over
every cell in the first 50 rows.

1. Use exact matches, conservative fuzzy evidence, and row structure to rank
   candidate header rows. Do not silently accept the first row when all scores
   are zero.
2. Ask the user to select the header row when evidence is insufficient.
3. Run the full mapping pipeline only on the selected row.
4. Render exact/fuzzy results immediately; apply embedding results incrementally
   while marking unresolved fields as pending.
5. Validate cross-column conflicts before considering the mapping resolved.
6. Pass accepted fields to the existing asset extractor. Keep header-match method
   separate from `Asset.inferred`, which describes extraction of asset values.

Changing a file or header row invalidates pending inference. Cancel work where
supported and discard stale results using an import-generation identifier.

## Implementation order

- [x] Extract the field dictionary and decision types; retain a compatibility
      adapter for the current `Mapping` consumer.
- [x] Implement normalization and exact matching with regression tests.
- [x] Add fuzzy matching, field-level ranking, thresholds, and abstention tests.
- [x] Update mapping review to distinguish pending, accepted, and ignored columns;
      support manual overrides and conflict resolution.
- [x] Add the server embedding endpoint, request lifecycle, and mocked tests.
- [ ] Evaluate the cloud model and calibrate acceptance thresholds on
      labeled cases that were not used to write aliases.
- [x] Integrate asynchronous mapping with header-row detection and extraction.
- [x] Update the README with the pipeline, model details, privacy behavior,
      calibration results, and remaining limits.

## Validation and acceptance

- Preserve extraction results for both supplied samples.
- Test whitespace, Unicode, punctuation, aliases, typos, transpositions, blank and
  duplicate headers, short acronyms, competing fields, and unrelated columns.
- Verify that lower layers do not run after an accepted match and that no embedding API
  request is made when exact/fuzzy matching resolves every column.
- Test manual override precedence, stale async results, header-row changes,
  API failures, and conflicting column assignments.
- Keep separate labeled development and held-out evaluation sets. Report mapping
  precision, coverage, abstention rate, and incorrect automatic mappings per layer.
- Prefer manual review over a wrong automatic assignment; enable embedding
  auto-acceptance only when held-out results justify its thresholds.
- Run formatting checks, the production build, and extraction/mapping tests.

The first useful milestone is **normalization + fuzzy matching + manual fallback**.
Add embeddings through the same decision contract once the baseline is measured.
