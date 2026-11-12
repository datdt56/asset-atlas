import type { AssetValues } from "./extract";

// These are inference hints for descriptions, not a whitelist for explicit columns.
const BRAND =
  /^\s*(HPE|HP|Dell|Lenovo|Apple|ASUS|Acer|Microsoft|Synology|Intel|Samsung|Fujitsu|Toshiba)\b/i;
const TYPE_RULES: [RegExp, string][] = [
  [/\b(monitor|display)\b/i, "Monitor"],
  [/\b(keyboard|mouse|printer|dock)\b/i, "Peripheral"],
  [/\b(server|poweredge|proliant|thinksystem)\b/i, "Server"],
  [/\b(NAS|synology)\b/i, "NAS"],
  [/\b(workstation|precision|thinkstation|Z2)\b/i, "Workstation"],
  [
    /\b(laptop|notebook|macbook|latitude|thinkpad|elitebook|expertbook|surface|XPS)\b/i,
    "Laptop",
  ],
  [
    /\b(desktop|optiplex|prodesk|thinkcentre|veriton|mini pc|mac mini|imac|NUC|tower)\b/i,
    "Desktop",
  ],
];
const CPU = new RegExp(
  [
    /\b(?:Intel\s+)?(?:Core\s+)?i[3579](?:[- ]\d+[A-Z0-9]*)?(?:\s+\d+th gen)?\b/
      .source,
    /\b(?:\d+\s*x\s*)?(?:Intel\s+)?Xeon\s+(?:(?:Gold|Silver|Bronze|Platinum)\s+)?[A-Z]?[- ]?\d+[A-Z0-9]*\b/
      .source,
    /\b(?:AMD\s+)?Ryzen\s+(?:[3579]\s+)?[A-Z]?\d+[A-Z0-9]*\b/.source,
    /\b(?:Apple\s+)?M[1-9](?:\s+(?:Pro|Max|Ultra))?\b/.source,
  ].join("|"),
  "i",
);
const MEMORY =
  /(?:(?<count>\d+)\s*[x×]\s*)?(?<amount>\d+(?:\.\d+)?)\s*(?<unit>TB|GB|MB|gigs?|gigabytes?)\b/i;
const CAPACITY =
  /(?:(?<prefix>RAM|memory|SSD|NVMe|HDD|SAS)\s*[:=]?\s*)?(?:(?<count>\d+)\s*[x×]\s*)?(?<amount>\d+(?:\.\d+)?)\s*(?<unit>TB|GB|MB|gigs?|gigabytes?)\b(?:\s*(?<suffix>RAM|SSD|NVMe|HDD|SAS))?/gi;

// Conversion only: deciding whether a number represents RAM belongs to parsing.
export function normalizeMemory(value: string, headerUnit = ""): string {
  const input =
    /^\d+(?:\.\d+)?$/.test(value.trim()) && headerUnit
      ? `${value} ${headerUnit}`
      : value;
  const match = input.match(MEMORY)?.groups;
  if (!match) return value;
  const factor =
    { MB: 1 / 1024, GB: 1, TB: 1024 }[match.unit.toUpperCase()] ?? 1;
  const gb = Number(match.amount) * Number(match.count || 1) * factor;
  return `${Number(gb.toFixed(3))} GB`;
}

export function normalizeScreen(value: string): string {
  const size = value
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(?:-?inch(?:es)?|in|")?$/i);
  return size ? `${size[1]} in` : value;
}

export function classifyAssetType(text: string): string {
  return TYPE_RULES.find(([pattern]) => pattern.test(text))?.[1] || "";
}

function parseCapacities(text: string, explicitRam: string) {
  const capacities = [...text.matchAll(CAPACITY)].map((match) => {
    const { prefix = "", suffix = "", unit, count } = match.groups!;
    const label = suffix || prefix;
    let kind: "ram" | "storage" | "unknown" = "unknown";
    if (/^(RAM|memory)$/i.test(label)) kind = "ram";
    else if (/^(SSD|NVMe|HDD|SAS)$/i.test(label) || unit.toUpperCase() === "TB")
      kind = "storage";
    return { text: match[0], value: normalizeMemory(match[0]), kind, count };
  });

  // Explicit labels take priority, regardless of their order in the description.
  let ram = capacities.find((capacity) => capacity.kind === "ram");
  if (!ram && !explicitRam && capacities.length > 1) {
    // Conventional "16GB / 512GB SSD" ordering; keep this inference reviewable.
    ram = capacities.find(
      (capacity) => capacity.kind === "unknown" && !capacity.count,
    );
  }
  const ramValue = MEMORY.test(explicitRam)
    ? normalizeMemory(explicitRam)
    : ram?.value || "";
  const disks = capacities.filter(
    (capacity) =>
      capacity.kind === "storage" ||
      (capacity.kind === "unknown" && ramValue && capacity.value !== ramValue),
  );
  const storage = disks
    .map((capacity) =>
      capacity.text
        .trim()
        .replace(/\s*[x×]\s*/i, " × ")
        .replace(/(\d)(TB|GB|MB)/i, "$1 $2"),
    )
    .join(" + ");
  const warnings =
    capacities.length && !ramValue && !storage
      ? ["Ambiguous capacity · verify RAM or storage against source"]
      : [];
  return { ram: ram?.value || "", storage, warnings };
}

export function parseDescription(
  text: string,
  explicit: Partial<AssetValues> = {},
) {
  const manufacturer = explicit.manufacturer || text.match(BRAND)?.[1] || "";
  const cpu = text.match(CPU)?.[0] || "";
  const capacity = parseCapacities(text, explicit.ram || "");
  const screen =
    text.match(/\b(\d{1,2}(?:\.\d+)?)\s*(?:-?inch(?:es)?|in\b|")/i)?.[1] || "";

  // Model is the leading description segment before CPU or capacities.
  let model = text.split(/\s*[/|,]\s*/)[0];
  if (
    manufacturer &&
    model.toLowerCase().startsWith(manufacturer.toLowerCase())
  ) {
    model = model.slice(manufacturer.length).trim();
  }
  if (cpu) model = model.split(cpu)[0];
  model = model
    .replace(/\b\d+(?:\.\d+)?\s*(?:GB|TB|MB)\b.*$/i, "")
    .replace(/\b(laptop|server|desktop)\b/gi, "")
    .trim()
    .replace(/[-(\s]+$/, "");

  const values: Partial<AssetValues> = {
    manufacturer,
    model,
    cpu,
    type: classifyAssetType(text),
    ram: capacity.ram,
    storage: capacity.storage,
    screen: normalizeScreen(screen),
  };
  return { values, warnings: capacity.warnings };
}
