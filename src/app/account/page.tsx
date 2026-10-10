import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { appDb } from "@/db/client";
import { user } from "@/db/schema";
import { signedInReader } from "@/lib/signed-in";
import { PaperColumn, Section } from "../legal";
import { quietButton } from "./quiet-button";
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
        <p className="text-ink-2">
          Everything you’ve written or chosen here, in one JSON file: your library, with each Book’s Status, when you read it and any title
          or author you changed; your Notes; the Books you added by hand; and the Connections between your Books, dismissed ones included.
        </p>
        <a href="/api/export" download className={`${quietButton} mt-4`}>
          Download export
        </a>
      </Section>

      <Section id="sign-out" title="Sign out">
        <p className="text-ink-2">Sign out of Marginalia on this device. Your library stays as it is.</p>
        <SignOut />
      </Section>
    </PaperColumn>
  );
}
