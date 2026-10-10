import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, Email, LegalPage, proseLink, Ruled, Section } from "../legal";

export const metadata: Metadata = { title: "Privacy · Marginalia" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="10 October 2026" other={{ href: "/terms", label: "Terms" }}>
      <p className="mt-8 text-ink-2">
        Marginalia is a private place for your reading. This page says what it keeps, who else sees any of it, and how to take it back.
      </p>

      <Section id="who" title="Who runs Marginalia">
        <p>
          Marginalia is run by one person in New York. Write to <Email /> about anything on this page.
        </p>
      </Section>

      <Section id="what-we-keep" title="What we keep">
        <Bullets
          items={[
            "Your email address, to sign you in.",
            "If you continue with Google: the name and profile picture Google shares with us.",
            "Your library: the Books you add, their Status, when you read them, and any titles or authors you change.",
            "Your Notes, with any quoted passages and page numbers.",
            "The Connections and Clusters Marginalia finds among your Books.",
            "For each signed-in device: the IP address and browser it signed in from.",
          ]}
        />
        <p>Sign-in codes are stored scrambled and expire after 5 minutes.</p>
      </Section>

      <Section id="use" title="How it’s used">
        <p>
          Only to run Marginalia for you: to show your library, find Connections between your Books, and sign you in. There are no ads,
          no analytics and no tracking. Your data is never sold. The only cookies are the ones that keep you signed in.
        </p>
      </Section>

      <Section id="services" title="Who else sees it">
        <p>These services do part of the work, and see only what they need for it:</p>
        <Ruled
          items={[
            {
              name: "Anthropic",
              text: "Your Notes, when Claude judges how two Books connect. Your Books’ titles, authors and descriptions, when it summarises a Book and names your Clusters.",
            },
            {
              name: "Voyage AI",
              text: "Your Notes and the quoted passages in them, and summaries of your Books, turned into embeddings that help find Books that might connect.",
            },
            { name: "Resend", text: "Your email address, to send your sign-in codes." },
            {
              name: "Google",
              text: "Your sign-in, if you choose Continue with Google. The name, email and picture Google shares are used only to sign you in, under Google’s API Services User Data Policy, including its Limited Use requirements.",
            },
            { name: "Railway", text: "Everything: it hosts Marginalia and its database." },
            { name: "Cloudflare R2", text: "Everything, in the nightly backups of the database." },
            {
              name: "Open Library and Google Books",
              text: "Open Library gets what you search for when adding a Book, and Google Books the title and author of a Book you add, to find its description. Both are sent from our server with nothing that identifies you. Book covers load from Open Library straight to your browser, so it sees your IP address when one is shown.",
            },
          ]}
        />
      </Section>

      <Section id="your-data" title="Exporting and deleting your data">
        <p>
          To export your data, choose Download export on{" "}
          <Link href="/account#your-data" className={proseLink}>
            your account page
          </Link>
          : one file with your library, your Notes, the Books you added by hand, and your Connections. To delete your data, write to <Email /> from the email address you sign in
          with. We’ll do it within 30 days.
        </p>
      </Section>

      <Section id="backups" title="Backups">
        <p>
          The database is backed up every night, and each backup is kept for 30 days. Once your account is deleted it’s gone from Marginalia,
          but it stays in the backups for up to 30 days, until they expire.
        </p>
      </Section>

      <Section id="age" title="Age">
        <p>Marginalia is for people 16 and older. If we learn that someone younger has an account, we’ll delete it.</p>
      </Section>

      <Section id="changes" title="Changes">
        <p>If this page changes, its date above changes too. For a change that affects what happens to your data, we’ll email you at least 30 days before it takes effect.</p>
      </Section>
    </LegalPage>
  );
}
