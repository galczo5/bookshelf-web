"use client";

import { useRef, useActionState } from "react";
import { importEpubAction, type ImportEpubState } from "@/app/actions/import-epub";

export function ImportButton() {
  const [, formAction, isPending] = useActionState<ImportEpubState, FormData>(
    importEpubAction,
    null
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={formAction}>
      <input
        ref={inputRef}
        type="file"
        name="file"
        accept=".epub,application/epub+zip"
        className="hidden"
        onChange={() => formRef.current?.requestSubmit()}
        disabled={isPending}
      />
      <button
        type="button"
        onClick={() => !isPending && inputRef.current?.click()}
        disabled={isPending}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
      >
        {isPending ? "Importing…" : "Import"}
      </button>
    </form>
  );
}
