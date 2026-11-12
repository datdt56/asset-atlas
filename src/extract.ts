import * as XLSX from "xlsx";
export const fields = [
  "type",
  "manufacturer",
  "model",
  "serial",
  "cpu",
  "ram",
  "storage",
  "screen",
] as const;
export type Field = (typeof fields)[number];
export interface Sheet {
  name: string;
  rows: string[][];
  header: number;
  enabled: boolean;
  decisions: HeaderDecision[];
  headerConfirmed: boolean;
}
export interface Asset extends Record<Field, string> {
  id: string;
  sheet: string;
  row: number;
  raw: Record<string, string>;
  inferred: Field[];
  warnings: string[];
}
import { resolveHeaders, normalizeHeader } from "./mapping/resolve";
import type { HeaderDecision } from "./mapping/resolve";
const key = normalizeHeader;
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
export function memory(s: string) {
  // Prefer a capacity with units, so DDR4 does not become 4 GB.
  const match =
    s.match(
      /(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(TB|GB|MB|gigs?|gigabytes?)\b/i,
    ) || s.trim().match(/^(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)$/);
  if (!match) return s;
  const unit = match[3]?.toUpperCase();
  const gb =
    Number(match[2]) *
    Number(match[1] || 1) *
    (unit === "MB" ? 1 / 1024 : unit === "TB" ? 1024 : 1);
  return `${Number(gb.toFixed(3))} GB`;
}
function classify(s: string) {
  if (/monitor|display|keyboard|mouse|printer|dock\b/i.test(s))
    return /monitor|display/i.test(s) ? "Monitor" : "Peripheral";
  if (/server|poweredge|proliant|thinksystem/i.test(s)) return "Server";
  if (/\bNAS\b|synology/i.test(s)) return "NAS";
  if (/workstation|precision|thinkstation|\bZ2\b/i.test(s))
    return "Workstation";
  if (
    /laptop|notebook|macbook|latitude|thinkpad|elitebook|expertbook|surface|\bXPS\b/i.test(
      s,
    )
  )
    return "Laptop";
  if (
    /desktop|optiplex|prodesk|thinkcentre|veriton|mini pc|mac mini|imac|\bNUC\b|tower/i.test(
      s,
    )
  )
    return "Desktop";
  return "";
}
export function extract(sheets: Sheet[]): Asset[] {
  const out: Asset[] = [];
  for (const sheet of sheets.filter((s) => s.enabled)) {
    const headers = sheet.rows[sheet.header] || [];
    sheet.rows.slice(sheet.header + 1).forEach((row, offset) => {
      if (
        !row.some((v) => clean(v)) ||
        /^(total|subtotal|grand total|notes?)(\b|:)/i.test(
          row.find((v) => v.trim()) || "",
        )
      )
        return;
      if (
        row.filter((v, i) => v && key(v) === key(headers[i] || "")).length >= 2
      )
        return;
      const a: Asset = {
        id: `${sheet.name}:${offset + sheet.header + 2}`,
        sheet: sheet.name,
        row: offset + sheet.header + 2,
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
      const desc: string[] = [];
      row.forEach((v, i) => {
        v = clean(v);
        a.raw[`${headers[i] || "Column " + (i + 1)} [${i + 1}]`] = v;
        const decision = sheet.decisions[i];
        const field = decision?.status === "accepted" ? decision.field : null;
        if (field === "description") desc.push(v);
        else if (field && v) a[field] = a[field] ? `${a[field]} / ${v}` : v;
      });
      // Normalize explicit RAM before comparing it with capacities in descriptions.
      if (a.ram) a.ram = memory(a.ram);
      const text = [...desc, a.model].join(" ");
      const put = (f: Field, v: string) => {
        if (!a[f] && v) {
          a[f] = v.trim();
          a.inferred.push(f);
        }
      };
      put(
        "manufacturer",
        text.match(
          /\b(HPE|HP|Dell|Lenovo|Apple|ASUS|Acer|Microsoft|Synology|Intel|Samsung|Fujitsu|Toshiba)\b/i,
        )?.[1] || "",
      );
      put("type", classify(text));
      if (a.type) a.type = classify(a.type) || a.type;
      const cpu = text.match(
        /\b(?:(?:\d+)\s*x\s*)?(?:(?:Intel|AMD|Apple)\s+)?(?:Core\s+)?(?:i[3579](?:[- ]\d+[A-Z0-9]*)?(?:\s+\d+th gen)?|Xeon\s+(?:(?:Gold|Silver|Bronze|Platinum)\s+)?[A-Z]?[- ]?\d+[A-Z0-9]*|Ryzen\s+(?:[3579]\s+)?[A-Z]?\d+[A-Z0-9]*|M[1-9](?:\s+(?:Pro|Max|Ultra))?)\b/i,
      );
      put("cpu", cpu?.[0] || "");
      const capacities = [
        ...text.matchAll(
          /(?:(\d+)\s*x\s*)?(\d+(?:\.\d+)?)\s*(TB|GB|MB|gig(?:abytes?)?|gigs?)\b(?:\s*(SSD|NVMe|HDD|SAS|RAM))?/gi,
        ),
      ];
      const ramToken = capacities.find(
        (m) =>
          !m[1] &&
          !/SSD|NVMe|HDD|SAS/i.test(m[4] || "") &&
          m[3].toUpperCase() !== "TB" &&
          (/RAM/i.test(m[4] || "") ||
            capacities.length > 1 ||
            /(?:ram|memory)\s*[:=]?\s*$/i.test(text.slice(0, m.index))),
      );
      if (!a.ram && ramToken) put("ram", memory(ramToken[0]));
      if (!a.storage) {
        const disks = capacities.filter((m) => {
          const labeledDisk =
            m[1] ||
            /SSD|NVMe|HDD|SAS/i.test(m[4] || "") ||
            m[3].toUpperCase() === "TB";
          const isRam =
            /RAM/i.test(m[4] || "") ||
            m === ramToken ||
            (!labeledDisk && a.ram && memory(m[0]) === a.ram);
          return !isRam && (labeledDisk || capacities.length > 1);
        });
        put(
          "storage",
          disks
            .map((m) =>
              m[0]
                .replace(/\s*x\s*/i, " × ")
                .replace(/(\d)(TB|GB|MB)/i, "$1 $2"),
            )
            .join(" + "),
        );
      }
      if (capacities.length && !a.ram && !a.storage) {
        a.warnings.push(
          "Ambiguous capacity · verify RAM or storage against source",
        );
      }
      put(
        "screen",
        text.match(/\b(\d{1,2}(?:\.\d+)?)\s*(?:-?inch(?:es)?|in\b|")/i)?.[1] ||
          "",
      );
      if (a.screen)
        a.screen =
          a.screen.replace(/(?:-?inch(?:es)?|in\b|")/gi, "").trim() + " in";
      if (!a.model) {
        let model = desc[0] || "";
        if (
          a.manufacturer &&
          model.toLowerCase().startsWith(a.manufacturer.toLowerCase())
        ) {
          model = model.slice(a.manufacturer.length).trim();
        }
        model = model.split(/\s*[/|,]\s*/)[0];
        if (cpu) model = model.split(cpu[0])[0];
        model = model
          .replace(/\b\d+(?:\.\d+)?\s*(?:GB|TB|MB)\b.*$/i, "")
          .replace(/\b(laptop|server|desktop)\b/gi, "")
          .trim()
          .replace(/[-(\s]+$/, "");
        put("model", model);
      }
      if (!fields.some((field) => a[field])) return;
      out.push(a);
    });
  }
  return reviewAssets(out);
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
