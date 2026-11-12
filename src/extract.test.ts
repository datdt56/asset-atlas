import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readWorkbook, extract, memory, toCSV, reviewAssets } from "./extract";
import { resolveHeaders } from "./mapping/resolve";
import * as XLSX from "xlsx";
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
      decisions: resolveHeaders(rows[1]),
      headerConfirmed: true,
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

const fromRows = (headers: string[], ...data: string[][]) =>
  extract([
    {
      name: "Unseen",
      rows: [headers, ...data],
      header: 0,
      headerConfirmed: true,
      enabled: true,
      decisions: resolveHeaders(headers),
    },
  ]);

test("CPU parsing does not consume model identifiers, including the second sample sheet", () => {
  const assets = extract(read("public/sample_assets_1.xlsx"));
  const asset = assets.find((a) => a.serial === "PC0X7Y8Z")!;
  assert.equal(asset.cpu, "i5-9500T");
  assert.equal(asset.model, "ThinkCentre M720q");
  const [unknown] = fromRows(
    ["Description"],
    ["Vendor M720q 16GB RAM / 512GB SSD"],
  );
  assert.equal(unknown.cpu, "");
  assert(unknown.model.includes("M720q"));
});

test("normalizes dedicated RAM before comparing it to description capacities", () => {
  const [asset] = fromRows(
    ["Description", "RAM"],
    ["Dell Latitude 5420 / 16GB / 512GB SSD", "16GB"],
  );
  assert.equal(asset.ram, "16 GB");
  assert.equal(asset.storage, "512 GB SSD");
  for (const [input, expected] of [
    ["16384 MB", "16 GB"],
    ["16 gig", "16 GB"],
    ["DDR4 16 GB", "16 GB"],
    ["2x8GB", "16 GB"],
  ])
    assert.equal(memory(input), expected);
});

test("leaves a lone unlabeled capacity ambiguous but handles explicitly labeled RAM", () => {
  const [ambiguous] = fromRows(
    ["Description"],
    ["Dell Latitude 5420 i7 / 512GB"],
  );
  assert.equal(ambiguous.ram, "");
  assert.equal(ambiguous.storage, "");
  assert(ambiguous.warnings.some((w) => w.startsWith("Ambiguous capacity")));
  const [ram] = fromRows(["Description"], ["Laptop / RAM: 16GB"]);
  assert.equal(ram.ram, "16 GB");
  const [disk] = fromRows(["Description"], ["Laptop / 512GB SSD"]);
  assert.equal(disk.storage, "512 GB SSD");
});

test("preserves an unfamiliar brand, leading-zero serial and reordered dedicated fields", () => {
  const [asset] = fromRows(
    [
      "Storage",
      "Serial Number",
      "Brand",
      "Model",
      "Memory",
      "Processor",
      "Device Type",
      "Display",
    ],
    [
      "512 GB SSD",
      "0012345",
      "Framework",
      "Laptop 13",
      "16384 MB",
      "Ryzen 7 7840U",
      "Notebook",
      "13.5 inch",
    ],
  );
  assert.equal(asset.manufacturer, "Framework");
  assert.equal(asset.serial, "0012345");
  assert.equal(asset.model, "Laptop 13");
  assert.equal(asset.ram, "16 GB");
  assert.equal(asset.screen, "13.5 in");
  assert.equal(asset.type, "Laptop");
});

test("unseen workbook has offset/typo headers and independent mappings on each sheet", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Inventory export"],
      [],
      ["Serial No", "Manufaturer", "Memroy", "Model", "Type"],
      ["00077", "Framework", "16 gig", "Laptop 13", "Laptop"],
      ["TOTAL", "", "", "", "1"],
    ]),
    "Devices",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Equipment", "S/N"],
      [
        "HPE ProLiant DL360 / Xeon Silver 4310 / 128GB / 2 x 960GB SSD",
        "DC123",
      ],
    ]),
    "Datacenter",
  );
  const sheets = readWorkbook(
    XLSX.write(wb, { type: "array", bookType: "xlsx" }),
  );
  assert.equal(sheets[0].header, 2);
  const assets = extract(sheets);
  assert.equal(assets.length, 2);
  assert.equal(assets[0].manufacturer, "Framework");
  assert.equal(assets[0].ram, "16 GB");
  assert.equal(assets[1].type, "Server");
  assert.equal(assets[1].storage, "2 × 960 GB SSD");
});

test("warnings follow edits and changes to duplicate serials", () => {
  const assets = fromRows(
    ["Description", "Serial"],
    ["Dell Latitude 5420 i5 / 16GB / 512GB SSD", "ABC"],
    ["Dell Latitude 5420 i5 / 16GB / 512GB SSD", "abc"],
  );
  assert(assets.every((a) => a.warnings.includes("Duplicate serial number")));
  const updated = reviewAssets(
    assets.map((a, i) => (i === 1 ? { ...a, serial: "DEF" } : a)),
  );
  assert(updated.every((a) => !a.warnings.includes("Duplicate serial number")));
  const [missing] = fromRows(["Model"], ["Unknown model"]);
  const [fixed] = reviewAssets([
    { ...missing, serial: "NEW", cpu: "i5", type: "Laptop", inferred: [] },
  ]);
  assert.deepEqual(fixed.warnings, []);
});

test("incomplete assets retain available specifications for review", () => {
  const [asset] = fromRows(["RAM", "Storage"], ["16GB", "512GB SSD"]);
  assert.equal(asset.ram, "16 GB");
  assert.equal(asset.storage, "512GB SSD");
  assert(asset.warnings.includes("Unknown asset type"));
});

test("manufacturer text is treated literally when parsing a combined description", () => {
  const [asset] = fromRows(
    ["Manufacturer", "Description"],
    ["Custom [Co", "Custom [Co Portable X / i5 / 16GB / 256GB SSD"],
  );
  assert.equal(asset.manufacturer, "Custom [Co");
  assert.equal(asset.model, "Portable X");
});
