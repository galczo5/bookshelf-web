import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { query } from "@/lib/db";

function getKey(): Buffer {
  const keyEnv = process.env.AUTH_TOKENS_ENCRYPTION_KEY;
  if (!keyEnv) throw new Error("AUTH_TOKENS_ENCRYPTION_KEY is not set");
  return Buffer.from(keyEnv, "base64");
}

function encrypt(plain: string): Buffer {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function decrypt(blob: Buffer): string {
  const key = getKey();
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// Lazy singleton — created on first use, not at module load, so build-time imports don't fail.
let tableReady: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = query(`
      CREATE TABLE IF NOT EXISTS auth_tokens (
        email TEXT PRIMARY KEY,
        refresh_token_ciphertext BYTEA NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => undefined);
  }
  return tableReady;
}

export async function getRefreshToken(email: string): Promise<string | null> {
  await ensureTable();
  const result = await query(
    "SELECT refresh_token_ciphertext FROM auth_tokens WHERE email = $1",
    [email]
  );
  if (result.rows.length === 0) return null;
  const blob: Buffer = result.rows[0].refresh_token_ciphertext;
  return decrypt(blob);
}

export async function saveRefreshToken(email: string, plaintext: string): Promise<void> {
  await ensureTable();
  const ciphertext = encrypt(plaintext);
  await query(
    `INSERT INTO auth_tokens (email, refresh_token_ciphertext, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (email) DO UPDATE
       SET refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
           updated_at = NOW()`,
    [email, ciphertext]
  );
}

export async function clearRefreshToken(email: string): Promise<void> {
  await ensureTable();
  await query("DELETE FROM auth_tokens WHERE email = $1", [email]);
}
