import { test } from "node:test";
import assert from "node:assert/strict";
import { assetTypes, fields } from "./asset-fields";
import {
  AiRequest,
  validateAiResult,
  type InputRow,
  type Suggestion,
} from "./ai-schema";
import { analyzeRows, buildAiEdits, defaultAiColumns } from "./ai";
import { extract } from "./extract";
import { resolveHeaders } from "./mapping/resolve";

const input: InputRow = {
  id: "row-1",
  cells: { "Config [1]": "16GB RAM / 512GB SSD" },
};
const suggestion = (id = input.id): Suggestion => ({
  id,
  fields: {
    type: null,
    manufacturer: null,
    model: null,
    serial: null,
    cpu: null,
    ram: { value: "16 GB", sourceColumn: "Config [1]", quote: "16GB RAM" },
    storage: null,
    screen: null,
  },
});
const fetcher = (calls: InputRow[][]) =>
  (async (_url, options) => {
    const request = JSON.parse(options!.body as string);
    calls.push(request.rows);
    return Response.json({
      result: {
        rows: request.rows
          .map((row: InputRow) => ({
            id: row.id,
            fields: Object.fromEntries(fields.map((field) => [field, null])),
          }))
          .reverse(),
      },
      model: "test-model",
    });
  }) as typeof fetch;

test("AI input accepts unfamiliar column names and rejects duplicate IDs or excess rows", () => {
  assert(AiRequest.safeParse({ rows: [input] }).success);
  assert(!AiRequest.safeParse({ rows: [input, input] }).success);
  assert(
    !AiRequest.safeParse({
      rows: Array.from({ length: 21 }, (_, i) => ({ ...input, id: String(i) })),
    }).success,
  );
  assert(
    !AiRequest.safeParse({
      rows: [{ ...input, cells: { Long: "x".repeat(2001) } }],
    }).success,
  );
});

test("validates original evidence and all IDs, independent of output ordering", () => {
  assert.equal(
    validateAiResult({ rows: [suggestion()] }, [input]).rows[0].fields.ram
      ?.value,
    "16 GB",
  );
  assert.throws(() =>
    validateAiResult({ rows: [suggestion("wrong")] }, [input]),
  );
  assert.throws(() => validateAiResult({ rows: [] }, [input]));
  assert.throws(() =>
    validateAiResult(
      {
        rows: [
          {
            ...suggestion(),
            fields: {
              ...suggestion().fields,
              ram: { value: "64 GB", sourceColumn: "Missing", quote: "64GB" },
            },
          },
        ],
      },
      [input],
    ),
  );
  assert.throws(() =>
    validateAiResult({ rows: [suggestion(), suggestion()] }, [input]),
  );
});

test("AI type values use the canonical enum while unknown types remain null", () => {
  const original = {
    id: "typed-row",
    cells: { Device: "a supplied device description" },
  };
  const result = (value: string | null) => ({
    rows: [
      {
        ...suggestion(original.id),
        fields: {
          ...Object.fromEntries(fields.map((field) => [field, null])),
          type:
            value === null
              ? null
              : { value, sourceColumn: "Device", quote: "device" },
        },
      },
    ],
  });
  for (const value of [...assetTypes, null]) {
    assert.equal(
      validateAiResult(result(value), [original]).rows[0].fields.type?.value ??
        null,
      value,
    );
  }
  for (const value of ["laptop", "Notebook", "Unknown", ""]) {
    assert.throws(() => validateAiResult(result(value), [original]));
  }
  assert.throws(() =>
    validateAiResult({ rows: [{ id: original.id, fields: { type: null } }] }, [
      original,
    ]),
  );
});

test("serial and administrative columns are excluded by default; unknown columns are kept", () => {
  assert.deepEqual(
    defaultAiColumns([
      "Config [1]",
      "S/N [2]",
      "Assigned To [3]",
      "Custom details [4]",
      "Notes [5]",
    ]),
    ["Config [1]", "Custom details [4]"],
  );
});

test("deduplicates identical cells and restores suggestions to each original ID", async () => {
  const calls: InputRow[][] = [];
  let ids: string[] = [];
  await analyzeRows(
    [input, { ...input, id: "row-2" }],
    new AbortController().signal,
    (batch) => {
      ids = batch.map((row) => row.id);
    },
    fetcher(calls),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 1);
  assert.deepEqual(ids, ["row-1", "row-2"]);
});

test("batches more than 20 distinct rows and preserves correct IDs with reordered output", async () => {
  const calls: InputRow[][] = [];
  const ids: string[] = [];
  const rows = Array.from({ length: 23 }, (_, i) => ({
    id: `row-${i}`,
    cells: { Custom: `Device ${i}` },
  }));
  await analyzeRows(
    rows,
    new AbortController().signal,
    (batch) => {
      ids.push(...batch.map((row) => row.id));
    },
    fetcher(calls),
  );
  assert.deepEqual(
    calls.map((batch) => batch.length),
    [20, 3],
  );
  assert.deepEqual([...ids].sort(), rows.map((row) => row.id).sort());
});

test("splits large valid cells across requests and validates all inputs before a paid call", async () => {
  const calls: InputRow[][] = [];
  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: `row-${i}`,
    cells: { Custom: `${i}` + "x".repeat(1900) },
  }));
  await analyzeRows(
    rows,
    new AbortController().signal,
    () => {},
    fetcher(calls),
  );
  assert.equal(calls.length, 2);
  const before = calls.length;
  await assert.rejects(() =>
    analyzeRows(
      [...rows, { id: "bad", cells: { Custom: "x".repeat(2001) } }],
      new AbortController().signal,
      () => {},
      fetcher(calls),
    ),
  );
  assert.equal(calls.length, before);
});

test("a failed later batch keeps earlier suggestions and does not retry", async () => {
  let calls = 0,
    completed = 0;
  const mock = (async (_url, options) => {
    calls++;
    if (calls === 2)
      return Response.json({ error: "Provider unavailable" }, { status: 502 });
    return fetcher([])(_url, options);
  }) as typeof fetch;
  const rows = Array.from({ length: 21 }, (_, i) => ({
    id: `row-${i}`,
    cells: { Custom: `Device ${i}` },
  }));
  await assert.rejects(
    () =>
      analyzeRows(
        rows,
        new AbortController().signal,
        (batch) => {
          completed += batch.length;
        },
        mock,
      ),
    /Provider unavailable/,
  );
  assert.equal(completed, 20);
  assert.equal(calls, 2);
});

test("cancellation prevents applying late results", async () => {
  const controller = new AbortController();
  let completed = 0;
  const mock = (async (_url, options) => {
    controller.abort();
    return fetcher([])(_url, options);
  }) as typeof fetch;
  await assert.rejects(
    () =>
      analyzeRows(
        [input],
        controller.signal,
        () => {
          completed++;
        },
        mock,
      ),
    { name: "AbortError" },
  );
  assert.equal(completed, 0);
});

test("only chosen suggestions are applied; existing edits are protected", () => {
  const [asset] = extract([
    {
      name: "Raw",
      header: 0,
      headerConfirmed: true,
      enabled: true,
      rows: [["Config"], [input.cells["Config [1]"]]],
      decisions: resolveHeaders(["Config"]),
    },
  ]);
  const proposal = { ...suggestion(), id: asset.id };
  assert.deepEqual(buildAiEdits(asset, {}, proposal, []), {});
  assert.equal(
    buildAiEdits(asset, { ram: "32 GB" }, proposal, ["ram"]).ram,
    "32 GB",
  );
  assert.equal(buildAiEdits(asset, {}, proposal, ["ram"]).ram, "16 GB");
  assert.throws(() =>
    buildAiEdits(asset, {}, suggestion("another row"), ["ram"]),
  );
});
