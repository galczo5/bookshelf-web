import "server-only";
import OpenAI from "openai";
import type { EnrichmentInput, EnrichmentProposals } from "./types";
import { enrichmentProposalsSchema } from "./schema";
import { buildEnrichmentPrompt } from "./prompt";

export class EnrichmentFailedError extends Error {
  code = "ENRICHMENT_FAILED" as const;
  constructor(public reason: "network" | "timeout" | "parse" | "schema") {
    super(`Enrichment failed: ${reason}`);
  }
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

function isValidProposals(v: unknown): v is EnrichmentProposals {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return "title" in obj && "author" in obj && "isbn" in obj && "cover" in obj;
}

export async function enrichBook(input: EnrichmentInput): Promise<EnrichmentProposals> {
  const safeInput: EnrichmentInput = {
    ...input,
    frontMatterStrings: input.frontMatterStrings
      .slice(0, 10)
      .map((s) => s.slice(0, 200)),
  };

  const prompt = buildEnrichmentPrompt(safeInput);

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
            name: "enrichment_proposals",
            strict: true,
            schema: enrichmentProposalsSchema,
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
      throw new EnrichmentFailedError("parse");
    }

    if (!isValidProposals(parsed)) {
      throw new EnrichmentFailedError("schema");
    }

    return parsed;
  } catch (err) {
    if (err instanceof EnrichmentFailedError) throw err;
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    ) {
      throw new EnrichmentFailedError("timeout");
    }
    throw new EnrichmentFailedError("network");
  }
}
