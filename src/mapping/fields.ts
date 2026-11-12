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

export const descriptions: Record<TargetField, string> = {
  type: "Device category or asset type: laptop, desktop, server, monitor",
  manufacturer: "Manufacturer, make, vendor or brand of equipment",
  model: "Product model name or model number of the device",
  serial:
    "Unique manufacturer serial number, S/N or service tag; not an internal asset tag",
  cpu: "CPU, processor model, Intel Core, AMD Ryzen or Apple silicon",
  ram: "Installed system RAM or physical memory capacity in GB; not disk space",
  storage: "Disk storage or drive capacity: SSD, HDD, NVMe; not system RAM",
  screen: "Screen or display diagonal size in inches",
  description:
    "Combined equipment description or specifications containing model, CPU, RAM and disk",
};
