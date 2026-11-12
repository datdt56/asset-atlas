import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHeader,
  resolveHeader,
  resolveHeaders,
  similarity,
  clearsThreshold,
  decisionsToMapping,
  applyEmbeddingResults,
  type HeaderDecision,
} from "./resolve";
test("normalization preserves Unicode and token boundaries", () => {
  assert.equal(normalizeHeader("  ＳＥＲＩＡＬ_number  "), "serial number");
  assert.equal(normalizeHeader("RAM (GB)"), "ram gb");
  assert.equal(normalizeHeader("Mémoire"), "mémoire");
  assert.equal(resolveHeader("S/N").field, "serial");
  assert.equal(resolveHeader("CPU / RAM / Disk").field, "description");
  assert.equal(resolveHeader("RAM (GB)").field, "ram");
});
test("fuzzy detects typos and transpositions but abstains on short and unknown labels", () => {
  assert.equal(resolveHeader("Manufaturer").field, "manufacturer");
  assert.equal(resolveHeader("Manufaturer").method, "fuzzy");
  assert(similarity("memory", "memroy") > 0.8);
  for (const h of ["GPU", "ROM", "Capacity", "", "Cost centre"])
    assert.equal(resolveHeader(h).status, "unresolved", h);
  assert.equal(
    clearsThreshold(
      [
        { field: "ram", score: 0.9, method: "fuzzy" },
        { field: "storage", score: 0.87, method: "fuzzy" },
      ],
      0.88,
      0.1,
    ),
    false,
  );
});
test("duplicate singleton assignments require resolution; combined descriptions are allowed", () => {
  const decisions = resolveHeaders([
    "Serial",
    "S/N",
    "Description",
    "Details",
    "Disk",
    "Storage",
  ]);
  assert.equal(decisions[0].status, "unresolved");
  assert.equal(decisions[1].status, "unresolved");
  assert.equal(decisions[2].field, "description");
  assert.equal(decisions[3].field, "description");
  assert.equal(decisionsToMapping(decisions)[0], "ignore");
});
test("late embedding results cannot replace manual mappings or ignored columns", () => {
  const initial = resolveHeader("Physical memory installed", 0);
  const result: HeaderDecision = {
    ...initial,
    status: "accepted",
    field: "ram",
    method: "embedding",
  };
  assert.equal(
    applyEmbeddingResults(
      [{ ...initial, status: "accepted", field: "storage", method: "manual" }],
      [result],
    )[0].field,
    "storage",
  );
  assert.equal(
    applyEmbeddingResults(
      [{ ...initial, status: "ignored", method: "manual" }],
      [result],
    )[0].status,
    "ignored",
  );
  assert.equal(
    applyEmbeddingResults(
      [initial],
      [{ ...result, original: "Different header" }],
    )[0].status,
    "unresolved",
  );
  assert.equal(applyEmbeddingResults([initial], [result])[0].field, "ram");
});
