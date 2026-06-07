import "server-only";
import OpenAI from "openai";
import type { TagSuggestionInput, TagSuggestionsResponse } from "./types";
import { tagSuggestionsSchema } from "./schema";
import { buildTagSuggestionPrompt } from "./prompt";

export class TagSuggestionFailedError extends Error {
  code = "TAG_SUGGESTION_FAILED" as const;
  constructor(public reason: "network" | "timeout" | "parse" | "schema") {
    super(`Tag suggestion failed: ${reason}`);
  }
}

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new TagSuggestionFailedError("network");
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

function isValidResponse(v: unknown): v is TagSuggestionsResponse {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return Array.isArray(obj.tags);
}

export async function suggestTags(input: TagSuggestionInput): Promise<TagSuggestionsResponse> {
  const prompt = buildTagSuggestionPrompt(input);

  try {
    const client = getClient();
    const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

    const response = await client.responses.create(
      {
        model,
        tools: [{ type: "web_search" }],
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "tag_suggestions",
            strict: true,
            schema: tagSuggestionsSchema,
          },
        },
        max_output_tokens: 2048,
      },
      { signal: AbortSignal.timeout(28000) }
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.output_text);
    } catch {
      throw new TagSuggestionFailedError("parse");
    }

    if (!isValidResponse(parsed)) {
      throw new TagSuggestionFailedError("schema");
    }

    return parsed;
  } catch (err) {
    if (err instanceof TagSuggestionFailedError) throw err;
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new TagSuggestionFailedError("timeout");
    }
    throw new TagSuggestionFailedError("network");
  }
}
