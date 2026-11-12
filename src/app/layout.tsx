import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../style.css";
export const metadata: Metadata = {
  title: "Asset Atlas · Inventory, untangled",
  description:
    "Turn messy computer-asset spreadsheets into a structured inventory. Local parsing with optional AI review.",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
