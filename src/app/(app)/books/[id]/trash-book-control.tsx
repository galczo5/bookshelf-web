"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { trashBookAction } from "@/app/actions/books";

export default function TrashBookControl({
  bookId,
  title,
}: {
  bookId: string;
  title: string;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClose() {
    if (isPending) return;
    setIsOpen(false);
    setError(null);
  }

  function handleConfirm() {
    startTransition(async () => {
      setError(null);
      const result = await trashBookAction(bookId);
      if (result.ok) {
        router.push("/");
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setIsOpen(true);
        }}
        className="text-sm text-red-600 hover:text-red-800"
      >
        Move to trash
      </button>

      <Dialog.Root open={isOpen} onOpenChange={(open) => !open && handleClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-200 bg-white p-6 shadow-xl focus:outline-none">
            <Dialog.Title className="mb-2 text-base font-semibold text-zinc-900">
              Move to trash?
            </Dialog.Title>
            <p className="mb-4 text-sm text-zinc-600">
              Move <span className="font-medium">{title}</span> to trash? You
              can restore it later.
            </p>

            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end gap-2">
              <Dialog.Close
                disabled={isPending}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                Cancel
              </Dialog.Close>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isPending ? "Moving…" : "Move to trash"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
