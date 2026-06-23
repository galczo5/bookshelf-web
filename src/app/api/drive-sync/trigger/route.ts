export const runtime = "nodejs";

import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { runSyncCheckIfStale } from "@/lib/drive/run-sync-check";
import { DriveAuthError } from "@/lib/drive/errors";

export async function POST(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    const userId = await getUserIdByEmail(session.user.email);
    await runSyncCheckIfStale(userId, session.user.email);
    return Response.json({ ok: true }, { status: 200 });
  } catch (e) {
    if (e instanceof DriveAuthError) {
      return Response.json({ ok: false }, { status: 401 });
    }
    throw e;
  }
}
