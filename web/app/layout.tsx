import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Semantic product search",
  description: "Upload a catalog and search with TF–IDF (offline SDK demo)."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
