import type { Field } from "../extract";
export type TargetField = Field | "description";
export const aliases: Record<TargetField, string[]> = {
  type: ["type", "device type", "asset type", "category", "equipment type"],
  manufacturer: ["manufacturer", "make", "brand", "vendor", "oem"],
  model: ["model", "model name", "product model"],
  serial: ["serial", "serial number", "serial no", "s/n", "sn", "service tag"],
  cpu: ["cpu", "processor", "proc"],
  ram: ["ram", "memory", "memory size", "system memory", "ram gb", "memory gb"],
  storage: [
    "storage",
    "disk",
    "hdd/ssd",
    "hard drive",
    "drive",
    "disk capacity",
  ],
  screen: ["screen", "screen size", "display", "display size"],
  description: [
    "description",
    "item description",
    "equipment",
    "device",
    "specifications",
    "cpu / ram / disk",
    "details",
    "product",
  ],
};

// These columns are retained in the source details, but aren't asset specifications.
export const ignoredHeaders = [
  "asset tag",
  "cost centre",
  "cost center",
  "purchased",
  "purchase date",
  "notes",
  "assigned to",
  "location",
  "owner",
  "department",
];
