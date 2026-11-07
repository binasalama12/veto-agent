import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VetoAgent — no high-impact action runs without a human yes",
  description:
    "An AI agent whose read-only work runs freely, but whose high-impact actions wait in an approval queue and execute only with a scoped, single-use token issued by a token vault after explicit human approval.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
