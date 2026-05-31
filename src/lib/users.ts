import "server-only";
import { db } from "@/lib/db";

export async function upsertUserByEmail(email: string): Promise<void> {
  await db
    .insertInto("users")
    .values({ email })
    .onConflict((oc) => oc.column("email").doNothing())
    .execute();
}

export async function getUserIdByEmail(email: string): Promise<string> {
  const row = await db
    .selectFrom("users")
    .select("id")
    .where("email", "=", email)
    .executeTakeFirstOrThrow();
  return row.id;
}
