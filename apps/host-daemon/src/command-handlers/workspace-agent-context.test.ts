import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EMPTY_PROVIDER_NATIVE_ROOTS,
  normalizeProviderNativeRoots,
} from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import { readWorkspaceAgentContext } from "./workspace-agent-context.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-agent-context-"));
  tempDirs.push(dir);
  return fs.realpath(dir);
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

function skillMarkdown(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill\n---\n\nBody\n`;
}

describe("readWorkspaceAgentContext", () => {
  it("reads the instructions and each direct project skill the way the server listed them", async () => {
    const root = await makeWorkspace();
    const skillsRoot = path.join(root, ".bb", "skills");
    await writeFile(path.join(root, ".bb", "AGENTS.md"), "\n  Be terse.  \n");
    await writeFile(
      path.join(skillsRoot, "beta", "SKILL.md"),
      skillMarkdown("beta"),
    );
    await writeFile(
      path.join(skillsRoot, "alpha", "SKILL.md"),
      skillMarkdown("alpha"),
    );
    await writeFile(
      path.join(skillsRoot, ".hidden", "SKILL.md"),
      skillMarkdown("hidden"),
    );
    await writeFile(path.join(skillsRoot, "no-skill", "README.md"), "nothing");
    await writeFile(
      path.join(skillsRoot, "nested", "deeper", "SKILL.md"),
      skillMarkdown("deeper"),
    );
    const outside = await makeWorkspace();
    await writeFile(
      path.join(outside, "linked", "SKILL.md"),
      skillMarkdown("linked"),
    );
    await fs.symlink(
      path.join(outside, "linked"),
      path.join(skillsRoot, "linked"),
    );
    await fs.mkdir(path.join(skillsRoot, "huge"));
    const huge = await fs.open(path.join(skillsRoot, "huge", "SKILL.md"), "w");
    await huge.truncate(10 * 1024 * 1024 + 1);
    await huge.close();

    const context = await readWorkspaceAgentContext({
      type: "host.read_workspace_agent_context",
      rootPath: root,
      sharedSkillRoots: EMPTY_PROVIDER_NATIVE_ROOTS,
    });

    expect(context).toEqual({
      agentInstructions: "Be terse.",
      projectSkills: [
        {
          kind: "file",
          directoryName: "alpha",
          content: skillMarkdown("alpha"),
        },
        { kind: "file", directoryName: "beta", content: skillMarkdown("beta") },
        {
          kind: "oversized",
          directoryName: "huge",
          sizeBytes: 10 * 1024 * 1024 + 1,
        },
      ],
      projectSkillsTruncated: false,
      sharedSkills: [],
    });
  });

  it("returns an empty context for a workspace without .bb", async () => {
    const root = await makeWorkspace();
    await writeFile(path.join(root, ".bb-not", "AGENTS.md"), "ignored");

    await expect(
      readWorkspaceAgentContext({
        type: "host.read_workspace_agent_context",
        rootPath: root,
        sharedSkillRoots: EMPTY_PROVIDER_NATIVE_ROOTS,
      }),
    ).resolves.toEqual({
      agentInstructions: null,
      projectSkills: [],
      projectSkillsTruncated: false,
      sharedSkills: [],
    });
  });

  it("lists shared skills from the configured roots relative to the workspace", async () => {
    const root = await makeWorkspace();
    await writeFile(
      path.join(root, ".shared-skills", "lint", "SKILL.md"),
      skillMarkdown("lint"),
    );

    const context = await readWorkspaceAgentContext({
      type: "host.read_workspace_agent_context",
      rootPath: root,
      sharedSkillRoots: normalizeProviderNativeRoots({
        project: [".shared-skills"],
      }),
    });

    expect(context.sharedSkills).toEqual([
      expect.objectContaining({
        name: "lint",
        rootKind: "shared-project",
        filePath: path.join(root, ".shared-skills", "lint", "SKILL.md"),
      }),
    ]);
  });
});
