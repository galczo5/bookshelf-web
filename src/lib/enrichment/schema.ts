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
  ],
  additionalProperties: false,
};
