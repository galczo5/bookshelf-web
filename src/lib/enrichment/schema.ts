export const enrichmentProposalsSchema = {
  type: "object",
  properties: {
    title: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            provenance: { type: "string" },
            confidence: { type: "string", enum: ["high", "low"] },
            alternatives: {
              type: "array",
              items: { type: "string" },
              maxItems: 3,
            },
          },
          required: ["value", "provenance", "confidence", "alternatives"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    author: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            provenance: { type: "string" },
            confidence: { type: "string", enum: ["high", "low"] },
            alternatives: {
              type: "array",
              items: { type: "string" },
              maxItems: 3,
            },
          },
          required: ["value", "provenance", "confidence", "alternatives"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    isbn: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            provenance: { type: "string" },
            confidence: { type: "string", enum: ["high", "low"] },
            alternatives: {
              type: "array",
              items: { type: "string" },
              maxItems: 3,
            },
          },
          required: ["value", "provenance", "confidence", "alternatives"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    cover: {
      anyOf: [
        {
          type: "object",
          properties: {
            urls: {
              type: "array",
              items: { type: "string" },
              maxItems: 3,
            },
            primary: { type: "string" },
            provenance: { type: "string" },
            confidence: { type: "string", enum: ["high", "low"] },
          },
          required: ["urls", "primary", "provenance", "confidence"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    publisher: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            provenance: { type: "string" },
            confidence: { type: "string", enum: ["high", "low"] },
            alternatives: {
              type: "array",
              items: { type: "string" },
              maxItems: 3,
            },
          },
          required: ["value", "provenance", "confidence", "alternatives"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    language: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            provenance: { type: "string" },
            confidence: { type: "string", enum: ["high", "low"] },
            alternatives: {
              type: "array",
              items: { type: "string" },
              maxItems: 3,
            },
          },
          required: ["value", "provenance", "confidence", "alternatives"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    publishedDate: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            provenance: { type: "string" },
            confidence: { type: "string", enum: ["high", "low"] },
            alternatives: {
              type: "array",
              items: { type: "string" },
              maxItems: 3,
            },
          },
          required: ["value", "provenance", "confidence", "alternatives"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    description: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            provenance: { type: "string" },
            confidence: { type: "string", enum: ["high", "low"] },
            alternatives: {
              type: "array",
              items: { type: "string" },
              maxItems: 3,
            },
          },
          required: ["value", "provenance", "confidence", "alternatives"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    series: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            provenance: { type: "string" },
            confidence: { type: "string", enum: ["high", "low"] },
            alternatives: {
              type: "array",
              items: { type: "string" },
              maxItems: 3,
            },
          },
          required: ["value", "provenance", "confidence", "alternatives"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    part: {
      anyOf: [
        {
          type: "object",
          properties: {
            value: { type: "string" },
            provenance: { type: "string" },
            confidence: { type: "string", enum: ["high", "low"] },
            alternatives: {
              type: "array",
              items: { type: "string" },
              maxItems: 3,
            },
          },
          required: ["value", "provenance", "confidence", "alternatives"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
  },
  required: [
    "title",
    "author",
    "isbn",
    "cover",
    "publisher",
    "language",
    "publishedDate",
    "description",
    "series",
    "part",
  ],
  additionalProperties: false,
};

const textFieldSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        value: { type: "string" },
        provenance: { type: "string" },
        confidence: { type: "string", enum: ["high", "low"] },
        alternatives: {
          type: "array",
          items: { type: "string" },
          maxItems: 3,
        },
      },
      required: ["value", "provenance", "confidence", "alternatives"],
      additionalProperties: false,
    },
    { type: "null" },
  ],
} as const;

const coverFieldSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          maxItems: 3,
        },
        primary: { type: "string" },
        provenance: { type: "string" },
        confidence: { type: "string", enum: ["high", "low"] },
      },
      required: ["urls", "primary", "provenance", "confidence"],
      additionalProperties: false,
    },
    { type: "null" },
  ],
} as const;

import type { EnrichableField } from "./types";

// OpenAI structured output requires type:"object" at the root of the schema.
// Wrap each field's anyOf schema in a single-property envelope; field-agent.ts unwraps it.
function wrapSchema(inner: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "object",
    properties: { proposal: inner },
    required: ["proposal"],
    additionalProperties: false,
  };
}

export const fieldSchemas: Record<EnrichableField, Record<string, unknown>> = {
  title: wrapSchema(textFieldSchema),
  author: wrapSchema(textFieldSchema),
  isbn: wrapSchema(textFieldSchema),
  cover: wrapSchema(coverFieldSchema),
  publisher: wrapSchema(textFieldSchema),
  language: wrapSchema(textFieldSchema),
  publishedDate: wrapSchema(textFieldSchema),
  description: wrapSchema(textFieldSchema),
  series: wrapSchema(textFieldSchema),
  part: wrapSchema(textFieldSchema),
};
