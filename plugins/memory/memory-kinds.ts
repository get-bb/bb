export const MEMORY_KINDS = [
  "fact",
  "preference",
  "decision",
  "procedure",
  "episode",
  "reference",
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export function isMemoryKind(value: unknown): value is MemoryKind {
  return (
    typeof value === "string" && MEMORY_KINDS.some((kind) => kind === value)
  );
}
