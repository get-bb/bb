import type { PluginFileOpenerSource } from "@get-bb/plugin-sdk/app";
import type { TypstArtifactSource } from "../server.js";

export type DirectiveSourceResult =
  | { ok: true; source: TypstArtifactSource }
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
    message: `typst-inline source must be "workspace" or "thread-storage", got ${JSON.stringify(normalized)}.`,
  };
}

export function openedSource(
  source: PluginFileOpenerSource,
): TypstArtifactSource | null {
  if (source.kind === "thread-storage") {
    return source.threadId === null
      ? null
      : { kind: "thread-storage", threadId: source.threadId };
  }
  if (source.kind === "host") return null;
  if (source.threadId !== null) {
    return { kind: "thread-workspace", threadId: source.threadId };
  }
  if (source.environmentId === null && source.projectId === null) return null;
  return {
    kind: "workspace",
    environmentId: source.environmentId,
    projectId: source.projectId,
    hostId: source.experimental_hostId ?? null,
  };
}

export function sourceKey(source: TypstArtifactSource): string {
  return JSON.stringify(source);
}
