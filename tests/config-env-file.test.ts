import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { isConfigured, writeConfig } from "../src/lib/config/env-file";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "bookshelf-config-test-"));
  process.env.BOOKSHELF_CONFIG_FILE = path.join(tmpDir, "config.env");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.BOOKSHELF_CONFIG_FILE;
});

const VALID_VALUES = {
  GOOGLE_CLIENT_ID: "gci",
  GOOGLE_CLIENT_SECRET: "gcs",
  OPENAI_API_KEY: "oai",
  BOOKSHELF_ALLOWED_EMAIL: "owner@example.com",
} as const;

describe("isConfigured", () => {
  it("returns false when config file does not exist", () => {
    expect(isConfigured()).toBe(false);
  });

  it("returns false when config file is empty", () => {
    writeFileSync(process.env.BOOKSHELF_CONFIG_FILE!, "");
    expect(isConfigured()).toBe(false);
  });

  it("returns false when a required key is missing", () => {
    writeFileSync(
      process.env.BOOKSHELF_CONFIG_FILE!,
      "GOOGLE_CLIENT_ID=gci\nGOOGLE_CLIENT_SECRET=gcs\nOPENAI_API_KEY=oai\n"
    );
    expect(isConfigured()).toBe(false);
  });

  it("returns true when all required keys are present", async () => {
    await writeConfig(VALID_VALUES);
    expect(isConfigured()).toBe(true);
  });
});

describe("writeConfig", () => {
  it("writes required keys to the config file", async () => {
    await writeConfig(VALID_VALUES);

    const configPath = process.env.BOOKSHELF_CONFIG_FILE!;
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf8");
    expect(content).toContain("GOOGLE_CLIENT_ID=gci");
    expect(content).toContain("GOOGLE_CLIENT_SECRET=gcs");
    expect(content).toContain("OPENAI_API_KEY=oai");
    expect(content).toContain("BOOKSHELF_ALLOWED_EMAIL=owner@example.com");
  });

  it("writes optional OPENAI_MODEL when provided", async () => {
    await writeConfig({ ...VALID_VALUES, OPENAI_MODEL: "gpt-4o" });
    const content = readFileSync(process.env.BOOKSHELF_CONFIG_FILE!, "utf8");
    expect(content).toContain("OPENAI_MODEL=gpt-4o");
  });

  it("preserves pre-existing generated secrets on re-write", async () => {
    const configPath = process.env.BOOKSHELF_CONFIG_FILE!;
    writeFileSync(
      configPath,
      "AUTH_SECRET=generated-secret\nAUTH_TOKENS_ENCRYPTION_KEY=generated-enc-key\nDATABASE_URL=postgres://localhost/bookshelf\n"
    );

    await writeConfig(VALID_VALUES);

    const content = readFileSync(configPath, "utf8");
    expect(content).toContain("AUTH_SECRET=generated-secret");
    expect(content).toContain("AUTH_TOKENS_ENCRYPTION_KEY=generated-enc-key");
    expect(content).toContain("DATABASE_URL=postgres://localhost/bookshelf");
    expect(content).toContain("GOOGLE_CLIENT_ID=gci");
  });

  it("round-trip: write then isConfigured returns true", async () => {
    await writeConfig(VALID_VALUES);
    expect(isConfigured()).toBe(true);
  });
});
