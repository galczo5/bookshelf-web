import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { db } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.email) {
    return new Response(null, { status: 401 });
  }

  const { id } = await params;
  const userId = await getUserIdByEmail(session.user.email);

  const row = await db
    .selectFrom("books")
    .select(["cover_bytes", "cover_mime"])
    .where("id", "=", id)
    .where("user_id", "=", userId)
    .executeTakeFirst();

  if (!row?.cover_bytes) {
    return new Response(null, { status: 404 });
  }

  return new Response(new Uint8Array(row.cover_bytes), {
    headers: {
      "Content-Type": row.cover_mime ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
