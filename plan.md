# Local parsing with optional batch AI assistance

## Scope

Keep the local parser as the default and add one optional LLM path for unfamiliar
columns and difficult descriptions. No embedding layer or automatic cloud call on
upload. User-selected original cells are the AI input; canonical fields are output.

```text
Upload → local parsing → inventory/review/export
                           ↓ select rows
                Preview selected source columns
                           ↓ explicit send
                  Batch LLM interpretation
                           ↓
                  Review and apply changes
```

## Implemented

- [x] SheetJS + React + TypeScript; local multi-sheet parsing and provenance.
- [x] Header aliases + Fuzzball.js; small normalization/description helpers.
- [x] Separate normalization, description parsing and row assembly.
- [x] Editable inventory, mapping repair, source inspection and CSV/JSON exports.
- [x] Keep unknown-column rows available for manual or AI review.
- [x] Select up to 100 rows and choose which original columns to send.
- [x] Exclude known serial/administrative fields by default; allow unfamiliar keys.
- [x] Preview the exact request and send only after explicit user action.
- [x] Deduplicate identical selected inputs and batch up to 20 unique rows/request.
- [x] Bound total request size; validate all batches before a paid call.
- [x] Official OpenAI SDK + Zod Structured Outputs; nullable values and quoted evidence.
- [x] Validate source evidence and exact/unique IDs on both sides.
- [x] Review before/after values and apply only selected fields.
- [x] Protect existing edits; explicit source values are unselected by default.
- [x] Keep local results and completed suggestions on cancellation/partial failure.
- [x] Keep keys server-side with placeholder-only `.env.example`.
- [x] Hosted identity checks, request limits, timeout, no automatic retries and redacted errors.

## Keep the scope bounded

One model, one endpoint, two user choices: what data to send and what changes to
apply. Do not add vector search, model routing, persistent caches, automatic
escalation or new background services.

Default model: `gpt-6-luna` with reasoning disabled. `LLM_MODEL` is a server-only
configuration setting for a compatible model. No key is needed for local parsing.
Secrets go in ignored `.env.local` locally or runtime secret storage in production.

## Verification before presenting

- [ ] Evaluate real model output on held-out spreadsheets using your key.
- [ ] Test the complete browser flow: select rows, inspect payload, send, cancel,
      review source evidence, apply selected changes, edit again and export.
- [ ] Confirm malformed/missing credentials leave local processing usable.
- [ ] Measure actual latency and token usage before making cost/quality claims.
- [ ] Review dependency advisories and shared rate/budget enforcement before public production use.

Run `npm test`, `npm run format:check`, and `npm run build`. Automated mocked-provider
tests establish request/response handling, not semantic accuracy. Record browser
QA and live-model evaluation separately.
