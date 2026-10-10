import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { appDb } from "@/db/client";
import { user } from "@/db/schema";
import { signedInReader } from "@/lib/signed-in";
import { PaperColumn, Ruled, Section } from "../legal";
import { DownloadExport } from "./download-export";
import { SignOut } from "./sign-out";

export const dynamic = "force-dynamic";

export const metadata = { title: "Account · Marginalia" };

// The Reader's account (#67): their data to take away, and Sign out. #68's Delete your account goes last.
export default async function AccountPage() {
  const userId = await signedInReader();
  if (!userId) redirect("/sign-in?next=%2Faccount");
  const [reader] = await appDb().select({ email: user.email }).from(user).where(eq(user.id, userId));
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
    </PaperColumn>
  );
}
