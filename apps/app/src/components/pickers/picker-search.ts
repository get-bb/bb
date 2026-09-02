import { defaultFilter } from "cmdk";

interface SearchPickerOptionsArgs<T> {
  options: readonly T[];
  query: string;
  getLabel: (option: T) => string;
  getAliases?: (option: T) => readonly string[];
}

interface RankedPickerOption<T> {
  option: T;
  sourceIndex: number;
  score: number;
}

function scorePickerOption(
  label: string,
  aliases: readonly string[],
  query: string,
): number {
  let score = defaultFilter(label, query, []);
  for (const alias of aliases) {
    score = Math.max(score, defaultFilter(alias, query, []));
  }
  return score;
}

export function searchPickerOptions<T>({
  options,
  query,
  getLabel,
  getAliases,
}: SearchPickerOptionsArgs<T>): readonly T[] {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    return options;
  }

  return options
    .map((option, sourceIndex): RankedPickerOption<T> => {
      return {
        option,
        sourceIndex,
        score: scorePickerOption(
          getLabel(option),
          getAliases?.(option) ?? [],
          normalizedQuery,
        ),
      };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.sourceIndex - right.sourceIndex,
    )
    .map(({ option }) => option);
}
