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

- [x] Next.js App Router + React + TypeScript + SheetJS; local multi-sheet parsing and provenance.
- [x] Header aliases + Fuzzball.js; small normalization/description helpers.
- [x] Separate normalization, description parsing and row assembly.
- [x] Editable inventory, mapping repair, source inspection and CSV/JSON exports.
- [x] Keep unknown-column rows available for manual or AI review.
- [x] Select up to 100 rows and choose which original columns to send.
- [x] Exclude known serial/administrative fields by default; allow unfamiliar keys.
- [x] Preview selected row/cell data and send only after explicit user action; requests are deduplicated and split into batches.
- [x] Deduplicate identical selected inputs and batch up to 20 unique rows/request.
- [x] Validate all batches against client schema/character limits before a paid call; enforce the UTF-8 byte limit on the server.
- [x] Official OpenAI SDK + Zod Structured Outputs; eight required fields, nullable values and quoted evidence.
- [x] Prompt and schema share the canonical AI type enum: Laptop, Desktop, Server, Workstation, NAS, Monitor, Peripheral and Other. Unknown type is null; other values remain free-form strings.
- [x] Validate source evidence and exact/unique IDs on both sides.
- [x] Review before/after values and apply only selected fields.
- [x] Protect existing edits; explicit source values are unselected by default.
- [x] Keep local results and completed suggestions on cancellation/partial failure.
- [x] Keep keys server-side with placeholder-only `.env.example`.
- [x] Next.js Route Handler replaces the custom Node server and Vite middleware.
- [x] Production shared-password gate, request limits, timeout, no automatic retries and redacted errors.
- [x] Standard Next.js dev/build/start scripts; Node 22 via `.nvmrc`.

## Keep the scope bounded

One model, one endpoint, two user choices: what data to send and what changes to
apply. Do not add vector search, model routing, persistent caches, automatic
escalation or new background services.

Default model: `gpt-6-luna` with reasoning disabled. `LLM_MODEL` is a server-only
configuration setting for a compatible model. No key is needed for local parsing.
Secrets go in ignored `.env.local` locally or runtime secret storage in production.

## Deployment

Use a Next.js-compatible host and server-only `OPENAI_API_KEY`, `LLM_MODEL` and
`APP_PASSWORD` runtime settings. Local development loads ignored `.env.local`.
Production AI is disabled without `APP_PASSWORD`; use HTTPS and username `atlas`.
All users of this shared password use one rate-limit identity per server instance.
The previous Sites Worker deployment is not updated by this migration. No custom
Worker adapter or separate server is part of the new architecture.

## Verification completed

- [x] 40 automated tests pass, including schema/enum validation and mocked SDK requests.
- [x] TypeScript and Prettier checks pass.
- [x] Next.js production build and development/production HTTP smoke checks passed during migration.
- [x] One live synthetic extraction passed after the prompt/enum update, including RAM normalization and a leading-zero serial.
- [x] Missing-key and authentication fallbacks checked through unit and HTTP tests.

These checks do not establish real-model accuracy on unseen files.

## Verification before presenting

- [ ] Evaluate real model output on held-out spreadsheets using your key.
- [ ] Test the complete browser flow: select rows, inspect payload, send, cancel,
      review source evidence, apply selected changes, edit again and export.
- [ ] Confirm missing/invalid credentials and local parsing together in the complete browser flow.
- [ ] Measure actual latency and token usage before making cost/quality claims.
- [ ] Review dependency advisories and shared rate/budget enforcement before public production use.

Run `npm test`, `npm run typecheck`, `npm run format:check`, and `npm run build`. Automated mocked-provider
tests establish request/response handling, not semantic accuracy. Record browser
QA and live-model evaluation separately.
