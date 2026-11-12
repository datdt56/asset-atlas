import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readWorkbook, extract, memory, toCSV, mapHeaders } from "./extract";
const read = (f: string) => {
  const b = readFileSync(f);
  return readWorkbook(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
  );
};
test("finds offset headers and extracts both workbook sheets", () => {
  const sheets = read("public/sample_assets_1.xlsx");
  assert.equal(sheets[0].header, 3);
  assert.equal(sheets[1].header, 2);
  const a = extract(sheets);
  assert.equal(a.length, 19);
  assert.equal(a.find((x) => x.serial === "9JZL5N2")?.ram, "32 GB");
  assert.equal(a.find((x) => x.serial === "8RTQ3L2")?.storage, "256 GB");
  assert.equal(
    a.find((x) => x.serial === "GTR4X93")?.storage,
    "4 x 1.92TB SSD (RAID 5)",
  );
});
test("combined CSV descriptions include storage multiplicity and peripherals", () => {
  const a = extract(read("public/sample_assets_2.csv"));
  assert.equal(a.length, 16);
  assert.equal(a[0].ram, "16 GB");
  assert.equal(a[0].screen, "15.6 in");
  assert.equal(
    a.find((x) => x.serial === "HHT8K53")?.storage,
    "6 × 3.84 TB SSD",
  );
  assert.equal(a.find((x) => x.serial === "HHT8K53")?.ram, "512 GB");
  assert.equal(a.find((x) => x.serial === "CN0ABC1234")?.type, "Monitor");
  assert.equal(a.find((x) => x.serial === "H7JK2L9M0N")?.cpu, "M2 Pro");
});
test("unseen aliases, repeated headers, duplicates and missing values", () => {
  const rows = [
    ["Inventory"],
    ["Brand", "Model", "S/N", "Memory size", "Disk"],
    ["Dell", "Latitude X", "ABC", "16384 MB", "1TB"],
    ["Brand", "Model", "S/N", "Memory size", "Disk"],
    ["Dell", "Latitude Y", "abc", "16 gig", "512GB"],
    ["TOTAL", "", "", "", "2"],
  ];
  const a = extract([
    {
      name: "Fleet",
      rows,
      header: 1,
      mapping: mapHeaders(rows[1]),
      enabled: true,
    },
  ]);
  assert.equal(a.length, 2);
  assert.equal(a[0].ram, "16 GB");
  assert(a.every((x) => x.warnings.includes("Duplicate serial number")));
  assert.equal(memory("16 gig"), "16 GB");
  assert(
    toCSV([{ ...a[0], model: '=HYPERLINK("bad")' }]).includes("'=HYPERLINK"),
  );
});
