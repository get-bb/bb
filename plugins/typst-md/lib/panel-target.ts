import type { TypstMdSource } from "../server.js";
import { directiveSource } from "./artifact-source.js";

export interface TypstMdPanelTarget {
  file: string;
  source: TypstMdSource;
}

export function parseTypstMdPanelTarget(input: {
  threadId: string;
  params: unknown;
}): TypstMdPanelTarget | null {
  const params = input.params;
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return null;
  }
  const record = params as Record<string, unknown>;
  const file = typeof record.file === "string" ? record.file.trim() : "";
  if (file.length === 0) return null;
  const sourceValue =
    typeof record.source === "string" ? record.source : undefined;
  const sourceResult = directiveSource(input.threadId, sourceValue);
  return sourceResult.ok ? { file, source: sourceResult.source } : null;
}
