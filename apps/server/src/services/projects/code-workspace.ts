import { z } from "zod";

const codeWorkspaceSchema = z.object({
  folders: z
    .array(
      z
        .object({
          path: z.string().optional(),
          uri: z.string().optional(),
        })
        .passthrough(),
    )
    .optional(),
});

export type CodeWorkspaceFolder =
  | { kind: "path"; path: string }
  | { kind: "unsupported-uri"; uri: string };

function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (char === "\\") {
        output += next ?? "";
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      output += "\n";
    } else if (char === "/" && next === "*") {
      index += 2;
      while (
        index < text.length &&
        !(text[index] === "*" && text[index + 1] === "/")
      ) {
        index += 1;
      }
      index += 1;
    } else {
      output += char;
    }
  }
  return output;
}

function stripTrailingCommas(text: string): string {
  let output = "";
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      output += char;
      if (char === "\\") {
        output += text[index + 1] ?? "";
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ",") {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/u.test(text[lookahead] ?? "")) {
        lookahead += 1;
      }
      if (text[lookahead] === "}" || text[lookahead] === "]") continue;
    }
    output += char;
  }
  return output;
}

export function parseLenientJson(text: string): unknown {
  return JSON.parse(
    stripTrailingCommas(stripJsonComments(text.replace(/^﻿/u, ""))),
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

export function parseCodeWorkspaceFolders(
  text: string,
): CodeWorkspaceFolder[] | null {
  let parsed: unknown;
  try {
    parsed = parseLenientJson(text);
  } catch {
    return null;
  }
  const document = codeWorkspaceSchema.safeParse(parsed);
  if (!document.success) return null;
  return (document.data.folders ?? []).flatMap(
    (folder): CodeWorkspaceFolder[] => {
      const path = folder.path?.trim();
      if (path !== undefined && path.length > 0) {
        return [{ kind: "path", path }];
      }
      const uri = folder.uri?.trim();
      if (uri === undefined || uri.length === 0) return [];
      const uriPath = fileUriPath(uri);
      return uriPath === null
        ? [{ kind: "unsupported-uri", uri }]
        : [{ kind: "path", path: uriPath }];
    },
  );
}
