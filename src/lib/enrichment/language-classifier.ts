import "server-only";
import OpenAI from "openai";
import type { EnrichmentInput, LanguageDetectionResult } from "./types";
import { EnrichmentFailedError } from "./client";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new EnrichmentFailedError("network");
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

export async function detectLanguage(input: EnrichmentInput): Promise<LanguageDetectionResult> {
  const prompt = [
    "You are a language detection assistant.",
    "Given the following ebook metadata, identify the primary language of the book.",
    "Respond with ONLY the language name in English (e.g. 'English', 'Polish', 'German', 'French').",
    "Do not include any other text, punctuation, or explanation.",
    "",
    `Filename: ${input.filename}`,
    `Embedded title: ${input.embeddedTitle ?? "(missing)"}`,
    `Embedded author: ${input.embeddedAuthor ?? "(missing)"}`,
  ].join("\n");

  try {
    const client = getClient();
    const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

    const response = await client.responses.create(
      {
        model,
        input: prompt,
        max_output_tokens: 32,
      },
      { signal: AbortSignal.timeout(15000) }
    );

    const language = response.output_text.trim();
    if (!language) throw new EnrichmentFailedError("parse");

    return { language, responseId: response.id };
  } catch (err) {
    if (err instanceof EnrichmentFailedError) throw err;
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new EnrichmentFailedError("timeout");
    }
    console.error("[detectLanguage] unexpected error:", err);
    throw new EnrichmentFailedError("network");
  }
}
