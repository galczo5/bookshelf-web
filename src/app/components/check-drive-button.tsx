"use client";

import { useActionState } from "react";
import { checkDriveAction, type CheckDriveState } from "@/app/actions/check-drive";

export function CheckDriveButton() {
  const [state, formAction, isPending] = useActionState<CheckDriveState, FormData>(
    checkDriveAction,
    null
  );

  return (
    <div>
      <form action={formAction}>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "Checking…" : "Check Drive connection"}
        </button>
      </form>

      {state?.ok === true && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm">
          <p className="font-medium text-green-800">{state.result.email}</p>
          {state.result.displayName && <p className="text-green-700">{state.result.displayName}</p>}
          {state.result.storageQuotaGB !== undefined && (
            <p className="text-green-600">Storage quota: {state.result.storageQuotaGB} GB</p>
          )}
        </div>
      )}

      {state?.ok === false && <p className="mt-3 text-sm text-red-600">{state.message}</p>}
    </div>
  );
}
