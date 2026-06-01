"use client";

import React, { useImperativeHandle } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

export interface NoteEditorHandle {
  getMarkdown(): string;
}

export const NoteEditor = React.forwardRef<
  NoteEditorHandle,
  { initialContent: string; placeholder?: string }
>(function NoteEditor({ initialContent }, ref): React.JSX.Element {
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: initialContent,
    immediatelyRender: false,
  });

  useImperativeHandle(
    ref,
    () => ({
      getMarkdown: () => editor?.storage.markdown.getMarkdown() ?? "",
    }),
    [editor]
  );

  return (
    <div className="min-h-[120px] rounded-lg border border-zinc-300 px-3 py-2 text-sm focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400 [&_.ProseMirror]:outline-none [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5">
      <EditorContent editor={editor} />
    </div>
  );
});
