import type { ComposerInsertPart, ComposerMention } from "@get-bb/plugin-sdk";

function quoteResourceName(name: string): string {
  return JSON.stringify(name);
}

function pathMention(
  path: string,
  entryKind: "file" | "directory",
): ComposerMention {
  const normalizedPath = path.replace(/\/+$/u, "") || path;
  return {
    from: 0,
    to: 0,
    kind: "path",
    source: "workspace",
    entryKind,
    path: normalizedPath,
    label: normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) || path,
  };
}

export function buildPluginEditThreadPrompt({
  name,
  path,
}: {
  name: string;
  path: string;
}): ComposerInsertPart[] {
  return [
    `Edit the bb plugin ${quoteResourceName(name)} at `,
    pathMention(path, "directory"),
    ". I want to ",
  ];
}

export function buildSkillEditThreadPrompt({
  id,
  name,
  path,
}: {
  id: string;
  name: string;
  path: string;
}): ComposerInsertPart[] {
  return [
    `Edit the bb skill ${quoteResourceName(name)} (ID ${id}) at `,
    pathMention(path, "file"),
    `. Inspect it with bb skill show ${id} --json and pass that revision to bb skill update when saving. I want to `,
  ];
}
