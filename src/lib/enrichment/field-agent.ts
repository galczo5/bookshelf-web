import "server-only";
import OpenAI from "openai";
import type { EnrichmentInput, EnrichableField, FieldAgentResult } from "./types";
import { EnrichmentFailedError } from "./client";
import { fieldSchemas } from "./schema";

function isAbortLike(err: unknown): boolean {
  if (err instanceof OpenAI.APIUserAbortError) return true;
  if (err instanceof Error) {
    return err.name === "AbortError" || err.name === "TimeoutError";
  }
  return false;
}

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new EnrichmentFailedError("network");
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

const FIELD_INSTRUCTIONS: Record<EnrichableField, string> = {
  title: "Find the correct book title. Return null if the embedded title is already accurate.",
  author:
    "Find the correct author name(s). Return null if the embedded author is already accurate.",
  isbn: "Find a valid ISBN-13 (preferred) or ISBN-10. Return null if the embedded ISBN is already present.",
  cover:
    "Find up to 3 direct image URLs (jpg/png/webp) for the book cover. Return null if no reliable cover URL is found. Do NOT return page URLs.",
  publisher: "Find the original publisher name (e.g. 'Penguin Books').",
  language:
    "Identify the primary language as a short name or tag (e.g. 'English', 'Polish', 'en').",
  publishedDate:
    "Find the original publication date. Prefer ISO format (e.g. '2004', '2004-03-01').",
  description:
    "Write a short plain-text synopsis (no HTML). Return null if none is reliably known.",
  series:
    "Find the series name this book belongs to (e.g. 'Dune', 'The Lord of the Rings'). Return ONLY the series name — do NOT include part numbers or ordinals. Return null if the book is not part of a series.",
  part: "Find the part number or ordinal of this book within its series (e.g. '1', '2', 'I'). Return ONLY the number or ordinal — do NOT include the series name. Return null if the book is not part of a series.",
};

function buildFieldPrompt(
  input: EnrichmentInput,
  field: EnrichableField,
  language: string,
  userMessage?: string
): string {
  const lines = [
    `You are a book metadata expert specialising in the field: ${field}.`,
    `The book is written in ${language}. Use ${language}-language sources when searching.`,
    "",
    "## Ebook details",
    `Filename: ${input.filename}`,
    `Embedded title: ${input.embeddedTitle ?? "(missing)"}`,
    `Embedded author: ${input.embeddedAuthor ?? "(missing)"}`,
    `Embedded ISBN: ${input.embeddedIsbn ?? "(missing)"}`,
  ];

  if (input.frontMatterStrings.length > 0) {
    lines.push("Front matter snippets:", ...input.frontMatterStrings.map((s) => `  - ${s}`));
  }

  lines.push(
    "",
    "## Your task",
    FIELD_INSTRUCTIONS[field],
    "",
    "Return a JSON object matching the provided schema.",
    "- 'provenance' must be a short phrase describing where the value came from.",
    "- 'confidence' is 'high' when corroborated by multiple sources, 'low' when inferred or speculative.",
    "- 'alternatives' lists up to 3 other plausible values (not the primary). Empty array if none.",
    "Do NOT include any content from the book body. Only metadata-shaped strings may be used."
  );

  if (userMessage) {
    lines.push("", "## User guidance", userMessage);
  }

  return lines.join("\n");
}

export async function enrichField(
  input: EnrichmentInput,
  field: EnrichableField,
  language: string,
  prevResponseId?: string,
  userMessage?: string
): Promise<FieldAgentResult> {
  const safeInput: EnrichmentInput = {
    ...input,
    frontMatterStrings: input.frontMatterStrings.slice(0, 10).map((s) => s.slice(0, 200)),
  };

  const prompt = buildFieldPrompt(safeInput, field, language, userMessage);

  try {
    const client = getClient();
    const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

    const sharedParams = {
      model,
      tools: [{ type: "web_search" as const }],
      input: prompt,
      text: {
        format: {
          type: "json_schema" as const,
          name: `${field}_proposal`,
          strict: true,
          schema: fieldSchemas[field],
        },
      },
      max_output_tokens: 512,
    };

    const response = await (prevResponseId
      ? client.responses.create(
          { ...sharedParams, previous_response_id: prevResponseId },
          { signal: AbortSignal.timeout(30000) }
        )
      : client.responses.create(sharedParams, { signal: AbortSignal.timeout(30000) }));

    let parsed: { proposal: unknown };
    try {
      parsed = JSON.parse(response.output_text) as { proposal: unknown };
    } catch {
      throw new EnrichmentFailedError("parse");
    }

    return { proposal: parsed.proposal as FieldAgentResult["proposal"], responseId: response.id };
  } catch (err) {
    if (err instanceof EnrichmentFailedError) throw err;
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new EnrichmentFailedError("timeout");
    }
    if (isAbortLike(err)) throw new EnrichmentFailedError("timeout");
    console.error(`[enrichField:${field}] unexpected error:`, err);
    throw new EnrichmentFailedError("network");
  }
}
