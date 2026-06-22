"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getUserIdByEmail } from "@/lib/users";
import { runBackup } from "@/lib/backup/run-backup";

export async function runBackupNowAction(): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  const userId = await getUserIdByEmail(session.user.email);
  await runBackup(userId, session.user.email);
  revalidatePath("/settings");
}
