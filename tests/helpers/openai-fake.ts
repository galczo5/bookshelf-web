/**
 * Reusable fake OpenAI client for the test suite — the OpenAI-boundary mock.
 *
 * The enrichment + tag-suggestion clients construct `new OpenAI({ apiKey })` lazily
 * (module-scope `getClient()`) and call `client.responses.create(params, opts?)`,
 * reading only `response.output_text` and `response.id`. This fake records the
 * assembled prompt string (`params.input`) of every call and returns a canned,
 * schema-shaped payload — so the clients run without network or `OPENAI_API_KEY`,
 * and tests can assert on exactly what reached the prompt.
 *
 * Mirrors the ergonomics of `tests/helpers/drive-fake.ts`. Wire-up (in the test):
 *
 *   import { createOpenAIFake } from "../helpers/openai-fake";
 *   const openaiFake = createOpenAIFake();
 *   vi.mock("openai", () => {
 *     const ctor = vi.fn(function () { return openaiFake.client; });
 *     (ctor as unknown as { APIUserAbortError: unknown }).APIUserAbortError =
 *       class APIUserAbortError extends Error {};
 *     return { default: ctor };
 *   });
 *
 * Use a normal function (not an arrow) so `new OpenAI()` can construct it. The
 * factory references `openaiFake` lazily (inside the `vi.fn` body), so it is only
 * evaluated when `new OpenAI()` runs — well after the top-level const is
 * initialized. This is the same hoist-safe pattern the drive-fake tests use.
 */

interface FakeResponse {
  id: string;
  output_text: string;
}

interface FakeResponses {
  create(params: { input?: string }, opts?: unknown): Promise<FakeResponse>;
}

export interface OpenAIFake {
  /** Shaped like the `openai` default export instance the clients consume. */
  client: { responses: FakeResponses };
  /** The assembled `input` string of every `responses.create` call, in order. */
  calls: string[];
  /** The `input` of the most recent `responses.create` call. */
  lastInput(): string;
  /**
   * Set the payload the next (and subsequent) `responses.create` calls return as
   * `output_text`. A string is returned verbatim (e.g. a `detectLanguage` answer);
   * anything else is `JSON.stringify`-ed (e.g. a proposals / tag-suggestions object).
   */
  setNextResponse(value: unknown): void;
  /** Clear recorded calls and revert to the default proposals payload. */
  reset(): void;
}

// A minimal `EnrichmentProposals`-shaped payload that satisfies `isValidProposals`
// in `client.ts` (key presence only). Used as the default when a test does not set
// its own response.
const DEFAULT_PROPOSALS = {
  title: null,
  author: null,
  isbn: null,
  cover: null,
  publisher: null,
  language: null,
  publishedDate: null,
  description: null,
  series: null,
  part: null,
};

export function createOpenAIFake(): OpenAIFake {
  const calls: string[] = [];
  let counter = 0;
  let nextOutputText: string = JSON.stringify(DEFAULT_PROPOSALS);

  const responses: FakeResponses = {
    async create(params) {
      calls.push(params.input ?? "");
      return { id: `resp_fake_${++counter}`, output_text: nextOutputText };
    },
  };

  return {
    client: { responses },
    calls,
    lastInput() {
      if (calls.length === 0) throw new Error("openai-fake: no responses.create call recorded yet");
      return calls[calls.length - 1];
    },
    setNextResponse(value: unknown) {
      nextOutputText = typeof value === "string" ? value : JSON.stringify(value);
    },
    reset() {
      calls.length = 0;
      counter = 0;
      nextOutputText = JSON.stringify(DEFAULT_PROPOSALS);
    },
  };
}
