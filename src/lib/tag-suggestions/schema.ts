export const tagSuggestionsSchema = {
  type: "object",
  required: ["tags"],
  additionalProperties: false,
  properties: {
    tags: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: {
        type: "object",
        required: ["name", "isNew", "provenance"],
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          isNew: { type: "boolean" },
          provenance: { type: "string" },
        },
      },
    },
  },
};
