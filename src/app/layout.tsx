import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Newsreader } from "next/font/google";
import "./globals.css";
import { RefreshAfterSaves } from "./refresh-after-saves";

export const metadata: Metadata = { title: "Marginalia", appleWebApp: { capable: true, title: "Marginalia", statusBarStyle: "default" } };

// `cover` lets the page reach under the notch and home indicator, so env(safe-area-inset-*) has values
// and the phone surfaces' padding clears them. The browser and status bar take the paper's colour.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f3ecdd" };

const serif = Newsreader({ subsets: ["latin"], variable: "--nf-serif", style: ["normal", "italic"], display: "swap" });
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--nf-sans", display: "swap" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body>
        <RefreshAfterSaves />
        {children}
      </body>
    </html>
  );
}
