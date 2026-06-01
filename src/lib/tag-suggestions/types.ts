export interface TagSuggestionInput {
  title: string;
  author: string | null;
  isbn: string | null;
  existingTagNames: string[];
}

export interface TagProposal {
  name: string;
  isNew: boolean;
  provenance: string;
}

export interface TagSuggestionsResponse {
  tags: TagProposal[];
}
