import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHeader,
  resolveHeader,
  resolveHeaders,
  checkConflicts,
} from "./resolve";

test("normalizes Unicode, separators and known aliases", () => {
  assert.equal(normalizeHeader("  ＳＥＲＩＡＬ_number  "), "serial number");
  assert.equal(normalizeHeader("Mémoire"), "mémoire");
  assert.equal(resolveHeader("S/N").field, "serial");
  assert.equal(resolveHeader("CPU / RAM / Disk").field, "description");
  assert.equal(resolveHeader("RAM (GB)").field, "ram");
});
test("Fuzzball recovers typos while unrelated labels and short acronyms stay unresolved", () => {
  for (const [header, field] of [
    ["Manufaturer", "manufacturer"],
    ["Memroy", "ram"],
    ["Storag", "storage"],
    ["Proccessor", "cpu"],
  ]) {
    const decision = resolveHeader(header);
    assert.equal(decision.field, field, header);
    assert.equal(decision.method, "fuzzy");
  }
  for (const header of [
    "GPU",
    "ROM",
    "Capacity",
    "",
    "Colour",
    "Warranty expires",
    "Insurance value",
  ]) {
    assert.equal(resolveHeader(header).status, "unresolved", header);
  }
});
test("recognizes administrative columns without requiring manual confirmation", () => {
  for (const header of ["Assigned To", "Cost Centre", "Asset Tag", "Notes"]) {
    assert.equal(resolveHeader(header).status, "ignored");
  }
});
test("conflicting singleton assignments require review; choosing a different field resolves the conflict", () => {
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
  const fixed = checkConflicts(
    decisions.map((d, i) =>
      i === 0
        ? { ...d, status: "accepted", field: "serial", method: "manual" }
        : d,
    ),
  );
  assert.equal(fixed[0].field, "serial");
  assert.equal(fixed[0].method, "manual");
});
