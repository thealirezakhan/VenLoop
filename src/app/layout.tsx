import type { Metadata } from "next";
import "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: "VenLoop — Care Coordination Platform",
  description: "Medication check-in with caregiver oversight — simulated demo",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
