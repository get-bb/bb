import stripJsonComments from "strip-json-comments";
import { z } from "zod";

const codeWorkspaceSchema = z.object({
  folders: z.array(z.unknown()).optional(),
});

const codeWorkspaceFolderSchema = z.object({
  path: z.string().optional(),
  uri: z.string().optional(),
});

export type CodeWorkspaceFolder =
  | { kind: "path"; path: string }
  | { kind: "unsupported-uri"; uri: string }
  | { kind: "invalid"; entry: string };

function parseJsonc(text: string): unknown {
  return JSON.parse(
    stripJsonComments(text.replace(/^﻿/u, ""), { trailingCommas: true }),
  );
}

function fileUriPath(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (
    url.protocol !== "file:" ||
    (url.host !== "" && url.host !== "localhost")
  ) {
    return null;
  }
  const path = decodeURIComponent(url.pathname);
  return /^\/[A-Za-z]:/u.test(path) ? path.slice(1) : path;
}

function parseFolder(entry: unknown, index: number): CodeWorkspaceFolder {
  const folder = codeWorkspaceFolderSchema.safeParse(entry);
  if (folder.success) {
    const path = folder.data.path?.trim();
    if (path !== undefined && path.length > 0) {
      return { kind: "path", path };
    }
    const uri = folder.data.uri?.trim();
    if (uri !== undefined && uri.length > 0) {
      const uriPath = fileUriPath(uri);
      return uriPath === null
        ? { kind: "unsupported-uri", uri }
        : { kind: "path", path: uriPath };
    }
  }
  return { kind: "invalid", entry: `folders[${index}]` };
}

export function parseCodeWorkspaceFolders(
  text: string,
): CodeWorkspaceFolder[] | null {
  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch {
    return null;
  }
  const document = codeWorkspaceSchema.safeParse(parsed);
  if (!document.success) return null;
  return (document.data.folders ?? []).map(parseFolder);
}
