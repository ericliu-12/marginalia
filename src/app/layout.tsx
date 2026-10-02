import type { Metadata } from "next";
import { Hanken_Grotesk, Newsreader } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = { title: "Marginalia" };

const serif = Newsreader({ subsets: ["latin"], variable: "--nf-serif", style: ["normal", "italic"], display: "swap" });
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--nf-sans", display: "swap" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
