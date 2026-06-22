export const runtime = "nodejs";

import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { runBackupIfNeeded } from "@/lib/backup/run-backup";

export async function POST(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const userId = await getUserIdByEmail(session.user.email);
  await runBackupIfNeeded(userId, session.user.email);

  return Response.json({ ok: true }, { status: 200 });
}
