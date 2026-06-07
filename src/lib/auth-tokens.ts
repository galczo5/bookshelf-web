import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { query } from "@/lib/db";

function getKey(): Buffer {
  const keyEnv = process.env.AUTH_TOKENS_ENCRYPTION_KEY;
  if (!keyEnv) throw new Error("AUTH_TOKENS_ENCRYPTION_KEY is not set");
  const key = Buffer.from(keyEnv, "base64");
  if (key.length !== 32) {
    throw new Error(
      "AUTH_TOKENS_ENCRYPTION_KEY must decode to 32 bytes (use `openssl rand -base64 32`)"
    );
  }
  return key;
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

export async function getRefreshToken(email: string): Promise<string | null> {
  const result = await query("SELECT refresh_token_ciphertext FROM auth_tokens WHERE email = $1", [
    email,
  ]);
  if (result.rows.length === 0) return null;
  const blob: Buffer = result.rows[0].refresh_token_ciphertext;
  return decrypt(blob);
}

export async function saveRefreshToken(email: string, plaintext: string): Promise<void> {
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
  await query("DELETE FROM auth_tokens WHERE email = $1", [email]);
}
