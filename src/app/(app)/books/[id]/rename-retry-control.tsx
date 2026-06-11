"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryRenameAction } from "@/app/actions/books";

export default function RenameRetryControl({ bookId }: { bookId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRetry() {
    setError(null);
    startTransition(async () => {
      const result = await retryRenameAction(bookId);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleRetry}
        disabled={isPending}
        className="rounded-md bg-yellow-700 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-yellow-800 disabled:opacity-50"
      >
        {isPending ? "Retrying…" : "Retry rename"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
