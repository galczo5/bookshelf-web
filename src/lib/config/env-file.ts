import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import os from "node:os";

function configFile(): string {
  return process.env.BOOKSHELF_CONFIG_FILE ?? "/data/config.env";
}

const REQUIRED_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "OPENAI_API_KEY",
  "BOOKSHELF_ALLOWED_EMAIL",
] as const;

export type ConfigValues = {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
  BOOKSHELF_ALLOWED_EMAIL: string;
};

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    result[key] = val;
  }
  return result;
}

function serializeEnvFile(entries: Record<string, string>): string {
  return (
    Object.entries(entries)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
}

export function isConfigured(): boolean {
  if (!existsSync(configFile())) return false;
  try {
    const parsed = parseEnvFile(readFileSync(configFile(), "utf8"));
    return REQUIRED_KEYS.every((k) => Boolean(parsed[k]));
  } catch {
    return false;
  }
}

export async function writeConfig(values: ConfigValues): Promise<void> {
  // Preserve any entrypoint-generated keys already in the file
  const existing: Record<string, string> = existsSync(configFile())
    ? parseEnvFile(readFileSync(configFile(), "utf8"))
    : {};

  const merged: Record<string, string> = {
    ...existing,
    GOOGLE_CLIENT_ID: values.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: values.GOOGLE_CLIENT_SECRET,
    OPENAI_API_KEY: values.OPENAI_API_KEY,
    BOOKSHELF_ALLOWED_EMAIL: values.BOOKSHELF_ALLOWED_EMAIL,
  };
  if (values.OPENAI_MODEL) merged.OPENAI_MODEL = values.OPENAI_MODEL;

  const tmp = path.join(os.tmpdir(), `config-${Date.now()}.env`);
  writeFileSync(tmp, serializeEnvFile(merged), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, configFile());
}
