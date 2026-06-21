"use server";

import { writeConfig, type ConfigValues } from "@/lib/config/env-file";
import { loadDemoData } from "@/lib/seed";
import { writeFileSync } from "node:fs";

export type SetupFormState = {
  ok: boolean;
  errors?: Partial<Record<keyof ConfigValues | "demo", string>>;
};

function validate(
  fd: FormData
):
  | { values: ConfigValues & { demo: boolean }; errors: null }
  | { values: null; errors: SetupFormState["errors"] } {
  const errors: SetupFormState["errors"] = {};

  const googleClientId = (fd.get("GOOGLE_CLIENT_ID") as string | null)?.trim() ?? "";
  const googleClientSecret = (fd.get("GOOGLE_CLIENT_SECRET") as string | null)?.trim() ?? "";
  const openaiApiKey = (fd.get("OPENAI_API_KEY") as string | null)?.trim() ?? "";
  const openaiModel = (fd.get("OPENAI_MODEL") as string | null)?.trim() ?? "";
  const email = (fd.get("BOOKSHELF_ALLOWED_EMAIL") as string | null)?.trim() ?? "";
  const demo = fd.get("demo") === "on";

  if (!googleClientId) errors.GOOGLE_CLIENT_ID = "Required";
  if (!googleClientSecret) errors.GOOGLE_CLIENT_SECRET = "Required";
  if (!openaiApiKey) errors.OPENAI_API_KEY = "Required";
  if (!email) {
    errors.BOOKSHELF_ALLOWED_EMAIL = "Required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.BOOKSHELF_ALLOWED_EMAIL = "Must be a valid email address";
  }

  if (Object.keys(errors).length > 0) return { values: null, errors };

  return {
    values: {
      GOOGLE_CLIENT_ID: googleClientId,
      GOOGLE_CLIENT_SECRET: googleClientSecret,
      OPENAI_API_KEY: openaiApiKey,
      ...(openaiModel ? { OPENAI_MODEL: openaiModel } : {}),
      BOOKSHELF_ALLOWED_EMAIL: email,
      demo,
    },
    errors: null,
  };
}

export async function setupAction(_prev: SetupFormState, fd: FormData): Promise<SetupFormState> {
  const result = validate(fd);
  if (!result.values) return { ok: false, errors: result.errors };

  const { demo, ...configValues } = result.values;

  await writeConfig(configValues);

  if (demo) {
    await loadDemoData(configValues.BOOKSHELF_ALLOWED_EMAIL);
  }

  // Signal the entrypoint supervise loop to restart Node (Phase 3).
  // In dev (no supervise loop), this is a no-op write that has no effect.
  const sentinel = process.env.BOOKSHELF_RELOAD_SENTINEL;
  if (sentinel) {
    try {
      writeFileSync(sentinel, String(Date.now()));
    } catch {
      // Non-fatal: the supervise loop will fall back to polling config mtime.
    }
  }

  return { ok: true };
}
