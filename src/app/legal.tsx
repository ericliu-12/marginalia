import Link from "next/link";

// The shell of /privacy and /terms (#62): public pages read by Google's consent screen and by anyone
// deciding whether to sign in. One serif column; every section has an id, so a part can be linked to.

const CONTACT = "hello@inkmarginalia.com";

// A link inside prose, in the accent (DESIGN.md's links on the account and legal pages).
export const proseLink =
  "text-accent underline decoration-accent/35 underline-offset-4 transition-colors duration-150 hover:text-accent-deep hover:decoration-accent-deep";

// "Back to Marginalia" and the footer's links: small caps, as the nav is set, 44px tall on touch.
export const smallCapsLink =
  "caps inline-flex min-h-11 items-center text-ink-2 underline decoration-transparent underline-offset-[6px] transition-colors duration-150 hover:text-ink hover:decoration-rule";

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
    <div className="flex min-h-dvh justify-center px-5 pt-[max(10vh,calc(env(safe-area-inset-top)+2rem))] pb-[max(4rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="w-full max-w-[36rem] text-[17px] leading-[1.6] text-pretty">
        <header className="flex items-center justify-between gap-4">
          <p className="text-[24px] leading-none italic lg:text-[30px]">Marginalia</p>
          <Link href="/" className={`${smallCapsLink} shrink-0 text-[15px] tracking-[1.2px] whitespace-nowrap lg:text-[16px] lg:tracking-[1.4px]`}>
            Back to Marginalia
          </Link>
        </header>
        <main>
          <h1 className="mt-12 text-[32px] leading-[1.1] font-medium tracking-[-0.01em] text-balance lg:mt-16 lg:text-[38px]">{title}</h1>
          <p className="caps mt-2.5 text-[14px] tracking-[1px] text-ink-3">{subtitle}</p>
          {children}
        </main>
        <footer className="mt-16 flex flex-wrap items-center gap-x-6 border-t border-rule pt-2">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={`${smallCapsLink} text-[14px] tracking-[1px]`}>
              {link.label}
            </Link>
          ))}
          <Email className="inline-flex min-h-11 items-center text-[15px] text-ink-2 italic underline decoration-transparent underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-rule" />
        </footer>
      </div>
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="group mt-12 scroll-mt-8 [&>p]:mt-3">
      <h2 id={`${id}-heading`} className="text-[22px] leading-[1.2] font-medium text-balance">
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

// A hairline-ruled list: a name in small caps, then what it means in a sentence.
export function Ruled({ items }: { items: { name: string; text: React.ReactNode }[] }) {
  return (
    <dl className="mt-5 border-b border-rule-2">
      {items.map((item) => (
        <div key={item.name} className="border-t border-rule-2 py-3 sm:grid sm:grid-cols-[10rem_1fr] sm:items-baseline sm:gap-5">
          <dt className="caps text-[15px] leading-snug font-medium tracking-[1.5px] text-ink">{item.name}</dt>
          <dd className="mt-0.5 text-ink-2 sm:mt-0">{item.text}</dd>
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
