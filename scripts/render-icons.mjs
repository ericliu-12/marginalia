// Renders the app's icons: the wordmark's italic M (Newsreader 500) in ink on paper, through a real
// browser so the PNGs carry the typeface. Needs the network for Google Fonts. Run: node scripts/render-icons.mjs
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

// `glyph` is the M's size as a share of the square: smaller for the maskable icon, whose outer ring a
// launcher may crop. The line box holds room for descenders, so the M is moved down to sit centred.
const page = (size, glyph) => `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@1,6..72,500&display=block" rel="stylesheet">
<style>html,body{margin:0}body{width:${size}px;height:${size}px;background:#f3ecdd;display:grid;place-items:center}
span{font-family:Newsreader;font-style:italic;font-weight:500;font-size:${Math.round(size * glyph)}px;line-height:1;color:#231d17;letter-spacing:-0.01em;transform:translate(-2%,12%)}</style>
</head><body><span>M</span></body></html>`;

const ICONS = [
  ["src/app/apple-icon.png", 180, 0.66],
  ["src/app/icon.png", 64, 0.72],
  ["public/icons/192.png", 192, 0.66],
  ["public/icons/512.png", 512, 0.66],
  ["public/icons/maskable-512.png", 512, 0.5],
  // Static in public/, for browsers that ask for /favicon.ico: Next would decode it in src/app/, and its
  // decoder refuses the RGB PNG a screenshot gives.
  ["public/favicon.ico", 32, 0.78],
];

const browser = await chromium.launch();
for (const [file, size, glyph] of ICONS) {
  const p = await browser.newPage({ viewport: { width: size, height: size } });
  await p.setContent(page(size, glyph), { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  if (!(await p.evaluate(() => document.fonts.check("italic 500 20px Newsreader")))) throw new Error("Newsreader did not load");
  const png = await p.screenshot();
  // An .ico holding one PNG, which every current browser reads.
  const ico = () => {
    const head = Buffer.alloc(22);
    head.writeUInt16LE(1, 2);
    head.writeUInt16LE(1, 4);
    head.writeUInt8(size, 6);
    head.writeUInt8(size, 7);
    head.writeUInt16LE(1, 10);
    head.writeUInt16LE(32, 12);
    head.writeUInt32LE(png.length, 14);
    head.writeUInt32LE(22, 18);
    return Buffer.concat([head, png]);
  };
  writeFileSync(file, file.endsWith(".ico") ? ico() : png);
  await p.close();
}
await browser.close();
