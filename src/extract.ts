import * as XLSX from "xlsx";
import {
  resolveHeaders,
  normalizeHeader,
  type HeaderDecision,
} from "./mapping/resolve";
import {
  normalizeMemory,
  normalizeScreen,
  classifyAssetType,
  parseDescription,
} from "./parse";
import { fields, type AssetValues, type Field } from "./asset-fields";
export { fields, type Field, type AssetValues } from "./asset-fields";
export interface Sheet {
  name: string;
  rows: string[][];
  header: number;
  enabled: boolean;
  decisions: HeaderDecision[];
  headerConfirmed: boolean;
}
export interface Asset extends AssetValues {
  id: string;
  sheet: string;
  row: number;
  raw: Record<string, string>;
  inferred: Field[];
  warnings: string[];
}
export function readWorkbook(data: ArrayBuffer): Sheet[] {
  const wb = XLSX.read(data, { type: "array", cellText: true });
  return wb.SheetNames.map((name) => {
    const rows = XLSX.utils
      .sheet_to_json<string[]>(wb.Sheets[name], {
        header: 1,
        defval: "",
        raw: false,
        blankrows: true,
      })
      .map((r) => r.map(String));
    if (rows.length > 50000 || rows.some((r) => r.length > 500))
      throw Error(
        "This workbook is too large. Use up to 50,000 rows and 500 columns per sheet.",
      );
    let header = 0,
      best = 0;
    rows.slice(0, 50).forEach((r, i) => {
      const score = new Set(
        resolveHeaders(r)
          .filter((d) => d.status === "accepted")
          .map((d) => d.field),
      ).size;
      if (score > best) {
        best = score;
        header = i;
      }
    });
    return {
      name,
      rows,
      header,
      decisions: resolveHeaders(rows[header] || []),
      headerConfirmed: best > 0,
      enabled: rows.length > 0,
    };
  });
}
const clean = (s: string) =>
  /^(?:n\/?a|null|none|unknown|-|—)$/i.test(s.trim()) ? "" : s.trim();
function extractRow(sheet: Sheet, row: string[], rowNumber: number): Asset {
  const asset: Asset = {
    id: `${sheet.name}:${rowNumber}`,
    sheet: sheet.name,
    row: rowNumber,
    raw: {},
    inferred: [],
    warnings: [],
    type: "",
    manufacturer: "",
    model: "",
    serial: "",
    cpu: "",
    ram: "",
    storage: "",
    screen: "",
  };
  const descriptions: string[] = [];
  const headers = sheet.rows[sheet.header] || [];
  row.forEach((cell, index) => {
    const value = clean(cell);
    const header = headers[index] || `Column ${index + 1}`;
    asset.raw[`${header} [${index + 1}]`] = value;
    const decision = sheet.decisions[index];
    if (decision?.status !== "accepted" || !decision.field || !value) return;
    if (decision.field === "description") {
      descriptions.push(value);
      return;
    }
    const field = decision.field;
    const unit = field === "ram" ? header.match(/\b(MB|GB|TB)\b/i)?.[1] : "";
    const normalized = field === "ram" ? normalizeMemory(value, unit) : value;
    asset[field] = asset[field]
      ? `${asset[field]} / ${normalized}`
      : normalized;
  });

  const text = [...descriptions, asset.model].filter(Boolean).join(" / ");
  const parsed = parseDescription(text, asset);
  for (const field of fields) {
    const value = parsed.values[field];
    if (!asset[field] && value) {
      asset[field] = value;
      asset.inferred.push(field);
    }
  }
  asset.type = classifyAssetType(asset.type) || asset.type;
  asset.screen = normalizeScreen(asset.screen);
  asset.warnings = parsed.warnings;
  return asset;
}

export function extract(sheets: Sheet[]): Asset[] {
  const assets: Asset[] = [];
  for (const sheet of sheets.filter((sheet) => sheet.enabled)) {
    const headers = sheet.rows[sheet.header] || [];
    sheet.rows.slice(sheet.header + 1).forEach((row, offset) => {
      const firstCell = row.find((cell) => clean(cell)) || "";
      if (
        !firstCell ||
        /^(total|subtotal|grand total|notes?)(\b|:)/i.test(firstCell)
      )
        return;
      const repeatedHeaders = row.filter(
        (cell, index) =>
          cell &&
          normalizeHeader(cell) === normalizeHeader(headers[index] || ""),
      ).length;
      if (repeatedHeaders >= 2) return;
      const asset = extractRow(sheet, row, sheet.header + offset + 2);
      const hasUnmappedData = sheet.decisions.some(
        (decision) =>
          decision.status === "unresolved" &&
          clean(row[decision.columnIndex] || ""),
      );
      if (fields.some((field) => asset[field]) || hasUnmappedData)
        assets.push(asset);
    });
  }
  return reviewAssets(assets);
}

// Recompute warnings after extraction or edits, including serial changes.
export function reviewAssets(assets: Asset[]): Asset[] {
  const serialCounts = new Map<string, number>();
  for (const asset of assets) {
    const serial = asset.serial.trim().toUpperCase();
    if (serial) serialCounts.set(serial, (serialCounts.get(serial) || 0) + 1);
  }
  return assets.map((asset) => {
    const warnings = asset.warnings.filter(
      (w) => w.startsWith("Ambiguous capacity") && !asset.ram && !asset.storage,
    );
    if (!asset.serial.trim()) warnings.push("Missing serial number");
    if (!asset.type.trim()) warnings.push("Unknown asset type");
    if (
      !asset.cpu.trim() &&
      !["Monitor", "Peripheral", "NAS"].includes(asset.type)
    )
      warnings.push("CPU not identified");
    if (asset.inferred.length)
      warnings.push("Inferred values · verify against source");
    if (["Monitor", "Peripheral"].includes(asset.type))
      warnings.push("Non-computer asset");
    if ((serialCounts.get(asset.serial.trim().toUpperCase()) || 0) > 1)
      warnings.push("Duplicate serial number");
    return { ...asset, warnings };
  });
}
export function toCSV(assets: Asset[]) {
  const columns = [...fields, "sheet", "row"] as const;
  const escape = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return [
    columns.join(","),
    ...assets.map((a) => columns.map((c) => escape(a[c])).join(",")),
  ].join("\r\n");
}
