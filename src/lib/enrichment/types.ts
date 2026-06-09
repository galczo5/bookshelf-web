export interface EnrichmentInput {
  filename: string;
  embeddedTitle: string | null;
  embeddedAuthor: string | null;
  embeddedIsbn: string | null;
  frontMatterStrings: string[];
}

export type ConfidenceLevel = "high" | "low";

export interface FieldProposal<T> {
  value: T;
  provenance: string;
  confidence: ConfidenceLevel;
  alternatives: T[];
}

export interface CoverProposal {
  urls: string[];
  primary: string;
  provenance: string;
  confidence: ConfidenceLevel;
}

export interface EnrichmentProposals {
  title: FieldProposal<string> | null;
  author: FieldProposal<string> | null;
  isbn: FieldProposal<string> | null;
  cover: CoverProposal | null;
  publisher: FieldProposal<string> | null;
  language: FieldProposal<string> | null;
  publishedDate: FieldProposal<string> | null;
  description: FieldProposal<string> | null;
}
