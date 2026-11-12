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
export const assetTypes = [
  "Laptop",
  "Desktop",
  "Server",
  "Workstation",
  "NAS",
  "Monitor",
  "Peripheral",
  "Other",
] as const;
export type AssetValues = Record<Field, string>;
export const fieldLabels: Record<Field, string> = {
  type: "Asset type",
  manufacturer: "Manufacturer",
  model: "Model",
  serial: "Serial number",
  cpu: "CPU",
  ram: "RAM",
  storage: "Storage",
  screen: "Screen size",
};
