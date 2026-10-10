import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { appDb } from "@/db/client";
import { user } from "@/db/schema";
import { appAuth, FRESH_SESSION_S } from "@/lib/auth";
import { signInPath } from "@/lib/signed-out";
import { PaperColumn, proseLink, Ruled, Section } from "../legal";
import { DeleteAccount } from "./delete-account";
import { DownloadExport } from "./download-export";
import { SignOut } from "./sign-out";

export const dynamic = "force-dynamic";

export const metadata = { title: "Account · Marginalia" };

// The Reader's account (#67): their data to take away, Sign out, and last, Delete your account (#68).
export default async function AccountPage() {
  const signedIn = await appAuth().api.getSession({ headers: await headers() });
  if (!signedIn) redirect(signInPath("/account"));
  const [reader] = await appDb().select({ email: user.email }).from(user).where(eq(user.id, signedIn.user.id));
  // As Better Auth judges it on deleting: signed in within the day.
  const fresh = Date.now() - new Date(signedIn.session.createdAt).getTime() < FRESH_SESSION_S * 1000;
  return (
    <PaperColumn
      title="Account"
      subtitle={
        <>
          Signed in as <span className="wrap-anywhere text-ink-2">{reader.email}</span>
        </>
      }
      links={[
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ]}
    >
      <Section id="your-data" title="Your data">
        <p className="text-ink-2">Everything you’ve written or chosen here, in one file to keep:</p>
        <Ruled
          items={[
            { name: "Library", text: "Each Book, its Status, when you read it, and any title or author you changed." },
            { name: "Notes", text: "Every Note, with its quoted passage and page." },
            { name: "Books added by hand", text: "The Books you made yourself, with what you wrote about them." },
            { name: "Connections", text: "The Connections between your Books and why they connect, dismissed ones included." },
          ]}
        />
        <p className="font-sans text-[0.8rem] text-ink-3">Covers, descriptions and summaries come from elsewhere, so they aren’t in it.</p>
        <DownloadExport />
      </Section>

      <Section id="sign-out" title="Sign out">
        <p className="text-ink-2">Sign out of Marginalia on this device. Your library stays as it is.</p>
        <SignOut />
      </Section>

      <div className="mt-14 border-t border-rule">
        <Section id="delete-account" title="Delete your account">
          <p className="text-ink-2">
            Deleting your account removes your library, Notes, the Books you added by hand, your Connections and Clusters, and signs you
            out on every device. It can’t be undone, so{" "}
            <a href="#your-data" className={proseLink}>
              download your export
            </a>{" "}
            first if you want to keep any of it. If you come back later, you’ll start with an empty library.
          </p>
          <DeleteAccount fresh={fresh} />
        </Section>
      </div>
    </PaperColumn>
  );
}
