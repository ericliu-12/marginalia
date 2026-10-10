import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, Email, LegalPage, proseLink, Section } from "../legal";

export const metadata: Metadata = { title: "Terms · Marginalia" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="9 October 2026" other={{ href: "/privacy", label: "Privacy" }}>
      <p className="mt-8 text-ink-2">The agreement between you and Marginalia, in plain words. By using Marginalia, you agree to it.</p>

      <Section id="who" title="Who runs Marginalia">
        <p>
          Marginalia is run by one person in New York (“we” on this page). Write to <Email /> with any question.
        </p>
      </Section>

      <Section id="age" title="Age">
        <p>You must be 16 or older to use Marginalia.</p>
      </Section>

      <Section id="account" title="Your account">
        <p>
          One account per person. Keep your email account safe, since it’s how you sign in; you’re responsible for what happens in your
          Marginalia account.
        </p>
      </Section>

      <Section id="your-content" title="Your Notes are yours">
        <p>
          You own what you write in Marginalia. You let us store it and process it only to run Marginalia for you, including sending it to
          the services listed on the{" "}
          <Link href="/privacy#services" className={proseLink}>
            Privacy
          </Link>{" "}
          page.
        </p>
      </Section>

      <Section id="connections" title="Connections are suggestions">
        <p>
          Connections and their explanations are written by AI. They can be wrong, or quote your Notes in ways you didn’t intend. Take them
          as suggestions, not facts.
        </p>
      </Section>

      <Section id="use" title="Acceptable use">
        <p>Please don’t:</p>
        <Bullets
          items={[
            "use Marginalia to break the law;",
            "try to reach another Reader’s library or data;",
            "overload, scrape or attack the service.",
          ]}
        />
        <p>We may suspend an account that does.</p>
      </Section>

      <Section id="availability" title="The service as it is">
        <p>
          Marginalia is offered as it is, without warranties. It may change, pause or stop. If it’s going to shut down, we’ll tell you
          at least 30 days ahead, so you have time to take your data with you.
        </p>
        <p>
          As far as the law allows, we aren’t liable for indirect or consequential losses, or for losing data, from your use of Marginalia, and
          our total liability is limited to what you’ve paid us, if anything, in the past 12 months.
        </p>
      </Section>

      <Section id="ending" title="Leaving">
        <p>
          You can stop using Marginalia at any time. To delete your account and data, write to <Email />; we’ll do it within 30 days.
        </p>
      </Section>

      <Section id="law" title="Governing law">
        <p>These terms are governed by the laws of the State of New York, and any dispute is settled in the state or federal courts in New York County.</p>
      </Section>

      <Section id="changes" title="Changes">
        <p>If these terms change, the date above changes too. For a change that matters, we’ll email you at least 30 days before it takes effect.</p>
      </Section>
    </LegalPage>
  );
}
