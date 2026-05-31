"use client";

import { useRef, useActionState } from "react";
import { importEpubAction, type ImportEpubState } from "@/app/actions/import-epub";

export function ImportDropzone() {
  const [state, formAction, isPending] = useActionState<ImportEpubState, FormData>(
    importEpubAction,
    null
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (isPending) return;
    const file = e.dataTransfer.files[0];
    if (!file || !formRef.current || !inputRef.current) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    inputRef.current.files = dt.files;
    formRef.current.requestSubmit();
  }

  return (
    <div>
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
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => !isPending && inputRef.current?.click()}
          className={`flex h-32 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
            isPending
              ? "cursor-not-allowed border-zinc-200 bg-zinc-50 text-zinc-400"
              : "border-zinc-300 hover:border-blue-400 hover:bg-blue-50"
          }`}
        >
          <p className="text-sm text-zinc-500">
            {isPending ? "Importing…" : "Drop an epub here, or click to pick"}
          </p>
        </div>
      </form>

      {state?.ok === true && (
        <p className="mt-3 text-sm text-green-700">
          Imported: {state.title} by {state.author ?? "Unknown"}
        </p>
      )}

      {state?.ok === false && (
        <p className="mt-3 text-sm text-red-600">{state.message}</p>
      )}
    </div>
  );
}
