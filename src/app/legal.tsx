import Link from "next/link";
import { quietLink } from "./quiet-link";

// The shell of /privacy and /terms (#62): public pages read by Google's consent screen and by anyone
// deciding whether to sign in. One serif column; every section has an id, so a part can be linked to.

const CONTACT = "hello@inkmarginalia.com";

export const proseLink = "text-ink underline decoration-rule underline-offset-4 transition-colors duration-150 hover:decoration-ink";

export function Email({ className = proseLink }: { className?: string }) {
  return (
    <a href={`mailto:${CONTACT}`} className={`${className} wrap-anywhere`}>
      {CONTACT}
    </a>
  );
}

export function LegalPage({
  title,
  updated,
  other,
  children,
}: {
  title: string;
  updated: string;
  other: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <PaperColumn title={title} subtitle={`Updated ${updated}`} links={[other]}>
      {children}
    </PaperColumn>
  );
}

// The column /privacy, /terms and /account share: the wordmark with Back to Marginalia, a serif title over
// a line of small print, and a hairline footer of links and the email.
export function PaperColumn({ title, subtitle, links, children }: { title: string; subtitle: React.ReactNode; links: { href: string; label: string }[]; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh justify-center px-6 pt-[max(10vh,calc(env(safe-area-inset-top)+2.5rem))] pb-[max(4rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-[36rem] text-[1.0625rem] leading-[1.6] text-pretty">
        <header className="flex items-baseline justify-between gap-4">
          <p className="text-[1.75rem] leading-none font-medium tracking-[-0.01em] italic">Marginalia</p>
          <Link href="/" className={`${quietLink} inline-flex shrink-0 items-center whitespace-nowrap`}>
            Back to Marginalia
          </Link>
        </header>
        <main>
          <h1 className="mt-12 text-[2rem] leading-tight font-medium text-balance">{title}</h1>
          <p className="mt-1 font-sans text-[0.8rem] text-ink-3">{subtitle}</p>
          {children}
        </main>
        <footer className="mt-16 flex flex-wrap items-center gap-x-4 border-t border-rule pt-4 font-sans text-[0.8rem] text-ink-3">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={`${quietLink} inline-flex items-center`}>
              {link.label}
            </Link>
          ))}
          <Email className={`${quietLink} inline-flex items-center`} />
        </footer>
      </div>
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="group mt-10 scroll-mt-8 [&>p]:mt-3">
      <h2 id={`${id}-heading`} className="text-[1.35rem] leading-[1.2] font-medium text-balance">
        <a
          href={`#${id}`}
          className="underline decoration-transparent underline-offset-4 transition-colors duration-150 group-target:decoration-rule hover:decoration-rule"
        >
          {title}
        </a>
      </h2>
      {children}
    </section>
  );
}

// A hairline-ruled list: a name in sans, then what it means in a sentence.
export function Ruled({ items }: { items: { name: string; text: React.ReactNode }[] }) {
  return (
    <dl className="mt-4 border-b border-rule">
      {items.map((item) => (
        <div key={item.name} className="border-t border-rule py-3 sm:grid sm:grid-cols-[9rem_1fr] sm:items-baseline sm:gap-4">
          <dt className="font-sans text-[0.8rem] font-medium text-ink">{item.name}</dt>
          <dd>{item.text}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mt-3 space-y-1.5 pl-5 [&>li]:list-[circle] [&>li]:marker:text-ink-3">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
