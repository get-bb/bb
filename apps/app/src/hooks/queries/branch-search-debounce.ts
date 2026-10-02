import { useDebouncedValue } from "@/hooks/useDebouncedValue";

const BRANCH_SEARCH_DEBOUNCE_MS = 120;

export function useDebouncedBranchSearchQuery(query: string): string {
  return useDebouncedValue(query, BRANCH_SEARCH_DEBOUNCE_MS);
}
