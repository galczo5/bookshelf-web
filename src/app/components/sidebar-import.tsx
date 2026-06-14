"use client";

import { useRef, useActionState } from "react";
import { Upload } from "lucide-react";
import { importEpubAction, type ImportEpubState } from "@/app/actions/import-epub";
import { SidebarMenuButton } from "@/components/ui/sidebar";

export function SidebarImport() {
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
      <SidebarMenuButton
        type="button"
        tooltip="Import"
        onClick={() => !isPending && inputRef.current?.click()}
        disabled={isPending}
      >
        <Upload />
        <span>{isPending ? "Importing…" : "Import"}</span>
      </SidebarMenuButton>
    </form>
  );
}
