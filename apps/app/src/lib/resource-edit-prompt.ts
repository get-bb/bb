import type { ComposerInsertPart, ComposerMention } from "@get-bb/plugin-sdk";
import { pathMentionResource } from "@bb/client-core";

function quoteResourceName(name: string): string {
  return JSON.stringify(name);
}

function pathMention(
  path: string,
  entryKind: "file" | "directory",
): ComposerMention {
  return {
    from: 0,
    to: 0,
    ...pathMentionResource({ path, source: "workspace", entryKind }),
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
