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

export const fieldSchemas: Record<EnrichableField, Record<string, unknown>> = {
  title: textFieldSchema,
  author: textFieldSchema,
  isbn: textFieldSchema,
  cover: coverFieldSchema,
  publisher: textFieldSchema,
  language: textFieldSchema,
  publishedDate: textFieldSchema,
  description: textFieldSchema,
  series: textFieldSchema,
  part: textFieldSchema,
};
