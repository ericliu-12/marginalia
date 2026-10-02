// Add-time description sourcing. Ported from prototype/pipeline-tuning (commit b87d50b, 01-enrich.mjs);
// the rules are recorded on #16.

export type GoogleBooksVolume = {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    categories?: string[];
    language?: string;
    description?: string;
  };
};

// Seam to Google Books and Open Library descriptions; tests supply a fake.
export interface DescriptionGateway {
  // Up to 40 results (two pages of 20) for a plain `title author` query.
  googleBooksVolumes(query: string, signal?: AbortSignal): Promise<GoogleBooksVolume[]>;
  // The Open Library work description, or "" when it has none.
  openLibraryDescription(workKey: string, signal?: AbortSignal): Promise<string>;
}

export type BookDescription = { description: string; googleBooksVolumeId: string | null };

// A Google Books description below this is too thin to ground Enrichment, so Open Library's is
// preferred when it is longer.
export const THIN_DESCRIPTION_CHARS = 500;

const BAD_TITLE =
  /study guide|summary|sparknotes|cliffs|analysis|graphic novel|workbook|companion|box set|four volumes|omnibus|collection|critical|essays|notes on/i;
const BAD_CATEGORY = /study aids|comics|graphic novels|literary criticism|language arts/i;
const ENGLISH = /\b(the|and|of|is|her|his|with|that|was|as|he|she)\b/gi;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
const stripHtml = (s: string) =>
  s.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
const looksEnglish = (t: string) => (t.match(ENGLISH) ?? []).length >= t.split(" ").length / 15;

// Title and primary-author match, English only, no study guides/adaptations/criticism/box sets;
// the longest matching description wins.
export function pickGoogleBooksDescription(
  volumes: GoogleBooksVolume[],
  title: string,
  author: string,
): { id: string; description: string } | null {
  const wantTitle = norm(title);
  const lastName = norm(author).split(" ").at(-1) ?? "";

  const good = volumes
    .map((it) => {
      const v = it.volumeInfo ?? {};
      const gotTitle = norm(v.title ?? "");
      const description = stripHtml(v.description ?? "");
      const titleOk =
        gotTitle.startsWith(wantTitle.slice(0, 18)) ||
        wantTitle.startsWith(gotTitle.slice(0, 18)) ||
        gotTitle.includes(wantTitle);
      const authorOk = !!lastName && (v.authors ?? []).some((a) => norm(a).includes(lastName));
      const bad =
        BAD_TITLE.test(`${v.title ?? ""} ${v.subtitle ?? ""}`) || BAD_CATEGORY.test((v.categories ?? []).join(" "));
      // Both checks: bilingual-titled volumes can carry a Spanish description.
      const english = v.language === "en" && looksEnglish(description);
      return { id: it.id, description, ok: titleOk && authorOk && !bad && english && description.length > 0 };
    })
    .filter((c) => c.ok)
    .sort((a, b) => b.description.length - a.description.length);

  return good[0] ?? null;
}

// Google Books description, with the Open Library one when Google's is missing or thin and
// Open Library's is longer. The Google Books volume id is returned only when Google's description
// is the one used: it backs the link Google requires wherever its description is shown.
export async function findDescription(
  gateway: DescriptionGateway,
  book: { title: string; authors: string[]; workKey: string },
  signal?: AbortSignal,
): Promise<BookDescription> {
  const author = book.authors[0] ?? "";
  // Each source failing independently must not lose what the other found.
  const picked = await gateway
    .googleBooksVolumes(`${book.title} ${author}`.trim(), signal)
    .then((volumes) => pickGoogleBooksDescription(volumes, book.title, author))
    .catch((err) => {
      console.error(err);
      return null;
    });

  let description = picked?.description ?? "";
  if (description.length < THIN_DESCRIPTION_CHARS) {
    const ol = await gateway
      .openLibraryDescription(book.workKey, signal)
      .then((d) => d.trim())
      .catch((err) => {
        console.error(err);
        return "";
      });
    if (ol.length > description.length) return { description: ol, googleBooksVolumeId: null };
  }
  return { description, googleBooksVolumeId: description ? (picked?.id ?? null) : null };
}
