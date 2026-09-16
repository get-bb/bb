import type { TypstMdSource } from "../server.js";

export type DirectiveSourceResult =
  | { ok: true; source: TypstMdSource }
  | { ok: false; message: string };

export function directiveSource(
  threadId: string,
  value: string | undefined,
): DirectiveSourceResult {
  const normalized = value?.trim() ?? "";
  if (normalized === "" || normalized === "workspace") {
    return { ok: true, source: { kind: "thread-workspace", threadId } };
  }
  if (normalized === "thread-storage") {
    return { ok: true, source: { kind: "thread-storage", threadId } };
  }
  return {
    ok: false,
    message: `typst-md source must be "workspace" or "thread-storage", got ${JSON.stringify(normalized)}.`,
  };
}

export function sourceKey(source: TypstMdSource): string {
  return JSON.stringify(source);
}
