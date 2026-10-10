import type { Metadata } from "next";
import { Bullets, Email, LegalPage, Ruled, Section } from "../legal";

export const metadata: Metadata = { title: "Privacy · Marginalia" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" other={{ href: "/terms", label: "Terms" }}>
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
          no analytics and no tracking. Your data is never sold. One cookie keeps you signed in.
        </p>
      </Section>

      <Section id="services" title="Who else sees it">
        <p>These services do part of the work, and see only what they need for it:</p>
        <Ruled
          items={[
            { name: "Anthropic", text: "Your Notes and the titles of your Books, when Claude judges how two Books connect and names your Clusters." },
            { name: "Voyage AI", text: "Your Notes and descriptions of your Books, turned into embeddings that help find Books that might connect." },
            { name: "Resend", text: "Your email address, to send your sign-in codes." },
            { name: "Google", text: "Your sign-in, if you choose Continue with Google." },
            { name: "Railway", text: "Everything: it hosts Marginalia and its database." },
            { name: "Cloudflare R2", text: "Everything, in the nightly backups of the database." },
            { name: "Open Library and Google Books", text: "What you search for when adding a Book, with nothing that identifies you." },
          ]}
        />
      </Section>

      <Section id="your-data" title="Exporting and deleting your data">
        <p>
          To export or delete your data, write to <Email /> from the email address you sign in with.
        </p>
      </Section>

      <Section id="backups" title="Backups">
        <p>
          The database is backed up every night, and each backup is kept for 30 days. A deleted account is gone from Marginalia at once,
          but stays in the backups for up to 30 days, until they expire.
        </p>
      </Section>

      <Section id="age" title="Age">
        <p>Marginalia is for people 16 and older. If we learn that someone younger has an account, we’ll delete it.</p>
      </Section>

      <Section id="changes" title="Changes">
        <p>If this page changes, its date above changes too. For a change that affects what happens to your data, we’ll email you first.</p>
      </Section>
    </LegalPage>
  );
}
