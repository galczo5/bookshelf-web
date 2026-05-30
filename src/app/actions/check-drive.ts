"use server";

import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import {
  checkDriveConnection,
  type ConnectionCheckResult,
} from "@/lib/drive/connection-check";
import { DriveAuthError } from "@/lib/drive/errors";

export type CheckDriveState =
  | null
  | { ok: true; result: ConnectionCheckResult }
  | { ok: false; message: string };

export async function checkDriveAction(
  _prev: CheckDriveState,
  _formData: FormData
): Promise<CheckDriveState> {
  let authError = false;
  let result: ConnectionCheckResult | undefined;
  let errorMessage: string | undefined;

  try {
    result = await checkDriveConnection();
  } catch (e) {
    if (e instanceof DriveAuthError) {
      authError = true;
    } else {
      errorMessage = e instanceof Error ? e.message : "Unknown error";
    }
  }

  if (authError) {
    await signOut({ redirect: false });
    redirect("/signin?expired=1");
  }

  if (result) return { ok: true, result };
  return { ok: false, message: errorMessage ?? "Drive check failed" };
}
