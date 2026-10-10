import { appDb } from "@/db/client";
import { exportReaderData } from "@/domain/export";
import { requireReader } from "@/lib/signed-in";

export const dynamic = "force-dynamic";

// The account page's Download export (#67): the signed-in Reader's data, and only theirs, as a file.
export async function GET() {
  const userId = await requireReader().catch(() => null);
  if (!userId) return new Response(null, { status: 401 });
  const data = await exportReaderData(appDb(), userId);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="marginalia-export-${data.exportedAt.slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
