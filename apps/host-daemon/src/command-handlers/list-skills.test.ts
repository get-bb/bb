import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  ProviderNativeRoot,
  ProviderNativeRootSet,
  ProviderNativeRoots,
  ProviderResolvedNativeRoot,
} from "@bb/domain";
import type { DiscoveredSkill } from "@bb/host-daemon-contract";
import { discoverSkills, type SkillScanRoot } from "../command-discovery.js";
import { CommandDispatchError } from "../command-dispatch-support.js";
import {
  deleteHostSkill,
  resolveSkillScanRoots,
  writeHostSkill,
} from "./list-skills.js";

interface WorkspaceFixture {
  cwd: string;
  dataDir: string;
  homeDir: string;
}

let tempRoot: string;

async function writeSkill(filePath: string, name: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `---\nname: ${name}\ndescription: ${name} skill\n---\n`,
    "utf8",
  );
}

async function makeWorkspaceFixture(): Promise<WorkspaceFixture> {
  const cwd = path.join(tempRoot, "workspace");
  const dataDir = path.join(tempRoot, "bb-data");
  const homeDir = path.join(tempRoot, "home");
  await mkdir(cwd, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  return { cwd, dataDir, homeDir };
}

function declared(
  rootPath: string,
  options: Partial<Omit<ProviderNativeRoot, "path">> = {},
): ProviderNativeRoot {
  return {
    path: rootPath,
    recursive: false,
    ancestors: false,
    namePrefix: "",
    ...options,
  };
}

function skillRoots(
  skills: Partial<ProviderNativeRoots>,
): ProviderNativeRootSet {
  return {
    skills: { user: [], project: [], ...skills },
    commands: { user: [], project: [] },
    resolved: { skills: [], commands: [] },
  };
}

function resolvedSkillRoots(
  skills: ProviderResolvedNativeRoot[],
): ProviderNativeRootSet {
  return {
    skills: { user: [], project: [] },
    commands: { user: [], project: [] },
    resolved: { skills, commands: [] },
  };
}

function expectedSkillId(identitySeed: string, logicalPath: string): string {
  return `skill_${createHash("sha256")
    .update(`${identitySeed}\0${logicalPath}`)
    .digest("hex")}`;
}

const AGENT_SKILL_ROOTS = skillRoots({
  project: [declared(".agent/skills")],
  user: [declared(".agent/skills")],
});

async function listSkills(
  fixture: WorkspaceFixture,
  cwd: string | null,
  nativeRoots: ProviderNativeRootSet,
  providerId = "test-provider",
): Promise<DiscoveredSkill[]> {
  return discoverSkills({
    roots: await resolveSkillScanRoots({
      providerId,
      cwd,
      homeDir: fixture.homeDir,
      nativeRoots,
    }),
  });
}

function byName(
  skills: DiscoveredSkill[],
  name: string,
): DiscoveredSkill | undefined {
  return skills.find((skill) => skill.name === name);
}

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), "bb-list-skills-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("resolveSkillScanRoots + discoverSkills", () => {
  it("classifies the host-owned bb project root and the declared provider roots only", async () => {
    const fixture = await makeWorkspaceFixture();
    const files = {
      "proj-bb": path.join(fixture.cwd, ".bb", "skills", "proj-bb", "SKILL.md"),
      "data-bb": path.join(fixture.dataDir, "skills", "data-bb", "SKILL.md"),
      "proj-agent": path.join(
        fixture.cwd,
        ".agent",
        "skills",
        "proj-agent",
        "SKILL.md",
      ),
      "user-agent": path.join(
        fixture.homeDir,
        ".agent",
        "skills",
        "user-agent",
        "SKILL.md",
      ),
    };
    for (const [name, filePath] of Object.entries(files)) {
      await writeSkill(filePath, name);
    }

    const skills = await listSkills(fixture, fixture.cwd, AGENT_SKILL_ROOTS);

    expect(byName(skills, "proj-bb")).toEqual({
      id: expect.stringMatching(/^skill_[a-f0-9]{64}$/u),
      name: "proj-bb",
      description: "proj-bb skill",
      filePath: files["proj-bb"],
      rootKind: "bb-project",
      linked: false,
    });
    expect(byName(skills, "data-bb")).toBeUndefined();
    expect(byName(skills, "proj-agent")?.rootKind).toBe("provider-project");
    expect(byName(skills, "user-agent")?.rootKind).toBe("provider-user");
    expect(byName(skills, "user-agent")?.filePath).toBe(files["user-agent"]);
  });

  it("keeps native skill IDs stable when the workspace root moves", async () => {
    const firstRoot = path.join(tempRoot, "checkout-a", ".bb", "skills");
    const secondRoot = path.join(tempRoot, "checkout-b", ".bb", "skills");
    await writeSkill(path.join(firstRoot, "review", "SKILL.md"), "review");
    await writeSkill(path.join(secondRoot, "review", "SKILL.md"), "review");

    const [first] = await discoverSkills({
      roots: [
        {
          rootPath: firstRoot,
          shape: "skill",
          namePrefix: "",
          source: "skill",
          origin: "project",
          identitySeed: "bb-project",
          rootKind: "bb-project",
        },
      ],
    });
    const [second] = await discoverSkills({
      roots: [
        {
          rootPath: secondRoot,
          shape: "skill",
          namePrefix: "",
          source: "skill",
          origin: "project",
          identitySeed: "bb-project",
          rootKind: "bb-project",
        },
      ],
    });

    expect(first?.id).toBe(second?.id);
  });

  it("keeps a declared provider skill's ID stable when the workspace root moves", async () => {
    const roots = skillRoots({ project: [declared(".agent/skills")] });
    const ids: string[] = [];
    for (const checkout of ["checkout-a", "checkout-b"]) {
      const cwd = path.join(tempRoot, checkout);
      await writeSkill(
        path.join(cwd, ".agent", "skills", "review", "SKILL.md"),
        "review",
      );
      const skills = await listSkills(
        { cwd, dataDir: "", homeDir: path.join(tempRoot, "home") },
        cwd,
        roots,
      );
      ids.push(byName(skills, "review")?.id ?? "");
    }
    expect(ids[0]).toMatch(/^skill_/u);
    expect(ids[0]).toBe(ids[1]);
  });

  it("drops project roots when cwd is null", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeSkill(
      path.join(fixture.cwd, ".bb", "skills", "proj-bb", "SKILL.md"),
      "proj-bb",
    );
    await writeSkill(
      path.join(fixture.cwd, ".agent", "skills", "proj-agent", "SKILL.md"),
      "proj-agent",
    );
    await writeSkill(
      path.join(fixture.homeDir, ".agent", "skills", "user-agent", "SKILL.md"),
      "user-agent",
    );

    const skills = await listSkills(fixture, null, AGENT_SKILL_ROOTS);

    expect(skills.map((skill) => skill.name)).toEqual(["user-agent"]);
  });

  it("classifies repository and nested ancestor roots as provider project skills with distinct IDs", async () => {
    const fixture = await makeWorkspaceFixture();
    const cwd = path.join(fixture.cwd, "packages", "app");
    await mkdir(path.join(fixture.cwd, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeSkill(
      path.join(
        fixture.cwd,
        ".agents",
        "skills",
        "repository-skill",
        "SKILL.md",
      ),
      "repository-skill",
    );
    await writeSkill(
      path.join(cwd, ".agents", "skills", "nested-skill", "SKILL.md"),
      "nested-skill",
    );
    await writeSkill(
      path.join(fixture.cwd, ".agents", "skills", "review", "SKILL.md"),
      "review",
    );
    await writeSkill(
      path.join(cwd, ".agents", "skills", "review", "SKILL.md"),
      "review",
    );

    const skills = await listSkills(
      fixture,
      cwd,
      skillRoots({
        project: [declared(".agents/skills", { ancestors: true })],
      }),
    );

    expect(byName(skills, "repository-skill")?.rootKind).toBe(
      "provider-project",
    );
    expect(byName(skills, "nested-skill")?.rootKind).toBe("provider-project");
    const reviews = skills.filter((skill) => skill.name === "review");
    expect(reviews).toHaveLength(2);
    expect(new Set(reviews.map((skill) => skill.id)).size).toBe(2);
  });

  it("preserves user object-store skill directory and SKILL.md links", async () => {
    const fixture = await makeWorkspaceFixture();
    const skillsRoot = path.join(fixture.homeDir, ".agent", "skills");
    const linkedDirectoryTarget = path.join(tempRoot, "linked-skill-target");
    await writeSkill(
      path.join(linkedDirectoryTarget, "SKILL.md"),
      "linked-directory",
    );
    await mkdir(skillsRoot, { recursive: true });
    await symlink(
      linkedDirectoryTarget,
      path.join(skillsRoot, "linked-directory"),
    );

    const linkedFileTarget = path.join(tempRoot, "linked-skill-file.md");
    await writeSkill(linkedFileTarget, "linked-file");
    const linkedFileRoot = path.join(skillsRoot, "linked-file");
    await mkdir(linkedFileRoot, { recursive: true });
    await symlink(linkedFileTarget, path.join(linkedFileRoot, "SKILL.md"));

    const skills = await listSkills(fixture, fixture.cwd, AGENT_SKILL_ROOTS);

    expect(byName(skills, "linked-directory")).toMatchObject({
      filePath: path.join(skillsRoot, "linked-directory", "SKILL.md"),
      linked: true,
      rootKind: "provider-user",
    });
    expect(byName(skills, "linked-file")).toMatchObject({
      filePath: path.join(skillsRoot, "linked-file", "SKILL.md"),
      linked: true,
      rootKind: "provider-user",
    });
  });

  it("follows project skill directory and SKILL.md links inside the repository", async () => {
    const fixture = await makeWorkspaceFixture();
    const canonicalRoot = path.join(fixture.cwd, ".agents", "skills");
    const providerRoot = path.join(fixture.cwd, ".claude", "skills");
    await writeSkill(
      path.join(canonicalRoot, "voice", "SKILL.md"),
      "canonical-voice",
    );
    await writeSkill(
      path.join(canonicalRoot, "domain-modeling", "SKILL.md"),
      "canonical-domain-modeling",
    );
    await mkdir(path.join(providerRoot, "domain-modeling"), {
      recursive: true,
    });
    await symlink(
      path.join("..", "..", ".agents", "skills", "voice"),
      path.join(providerRoot, "voice"),
      "dir",
    );
    await symlink(
      path.join(
        "..",
        "..",
        "..",
        ".agents",
        "skills",
        "domain-modeling",
        "SKILL.md",
      ),
      path.join(providerRoot, "domain-modeling", "SKILL.md"),
    );

    const skills = await listSkills(
      fixture,
      fixture.cwd,
      skillRoots({ project: [declared(".claude/skills")] }),
      "test-provider",
    );

    expect(byName(skills, "voice")).toEqual({
      id: expectedSkillId(
        "test-provider:provider-project:.claude/skills",
        "voice/SKILL.md",
      ),
      name: "voice",
      description: "canonical-voice skill",
      filePath: path.join(providerRoot, "voice", "SKILL.md"),
      rootKind: "provider-project",
      linked: true,
    });
    expect(byName(skills, "domain-modeling")).toEqual({
      id: expectedSkillId(
        "test-provider:provider-project:.claude/skills",
        "domain-modeling/SKILL.md",
      ),
      name: "domain-modeling",
      description: "canonical-domain-modeling skill",
      filePath: path.join(providerRoot, "domain-modeling", "SKILL.md"),
      rootKind: "provider-project",
      linked: true,
    });
  });

  it("follows project resolved skill roots only inside the repository", async () => {
    const fixture = await makeWorkspaceFixture();
    const canonicalDirectory = path.join(
      fixture.cwd,
      ".agents",
      "skills",
      "directory-alias",
    );
    const canonicalFile = path.join(
      fixture.cwd,
      ".agents",
      "skills",
      "file-alias",
      "SKILL.md",
    );
    const resolvedDirectory = path.join(
      fixture.cwd,
      ".provider",
      "directory-alias",
    );
    const resolvedFile = path.join(
      fixture.cwd,
      ".provider",
      "file-alias",
      "SKILL.md",
    );
    const outsideDirectory = path.join(tempRoot, "resolved-outside-directory");
    const outsideFile = path.join(
      tempRoot,
      "resolved-outside-file",
      "SKILL.md",
    );
    const resolvedOutsideDirectory = path.join(
      fixture.cwd,
      ".provider",
      "outside-directory",
    );
    const resolvedOutsideFile = path.join(
      fixture.cwd,
      ".provider",
      "outside-file",
      "SKILL.md",
    );
    await writeSkill(
      path.join(canonicalDirectory, "SKILL.md"),
      "directory-alias",
    );
    await writeSkill(canonicalFile, "file-alias");
    await writeSkill(
      path.join(outsideDirectory, "SKILL.md"),
      "outside-directory",
    );
    await writeSkill(outsideFile, "outside-file");
    await mkdir(path.dirname(resolvedDirectory), { recursive: true });
    await mkdir(path.dirname(resolvedFile), { recursive: true });
    await mkdir(path.dirname(resolvedOutsideFile), { recursive: true });
    await symlink(canonicalDirectory, resolvedDirectory, "dir");
    await symlink(canonicalFile, resolvedFile);
    await symlink(outsideDirectory, resolvedOutsideDirectory, "dir");
    await symlink(outsideFile, resolvedOutsideFile);

    const skills = await listSkills(
      fixture,
      fixture.cwd,
      resolvedSkillRoots([
        {
          path: resolvedDirectory,
          origin: "project",
          shape: "skill",
          recursive: false,
          ancestors: false,
          namePrefix: "",
        },
        {
          path: resolvedFile,
          origin: "project",
          shape: "skill-file",
          recursive: false,
          ancestors: false,
          namePrefix: "",
        },
        {
          path: resolvedOutsideDirectory,
          origin: "project",
          shape: "skill",
          recursive: false,
          ancestors: false,
          namePrefix: "",
        },
        {
          path: resolvedOutsideFile,
          origin: "project",
          shape: "skill-file",
          recursive: false,
          ancestors: false,
          namePrefix: "",
        },
      ]),
    );

    expect(byName(skills, "directory-alias")).toMatchObject({
      filePath: path.join(resolvedDirectory, "SKILL.md"),
      linked: true,
      rootKind: "provider-project",
    });
    expect(byName(skills, "file-alias")).toMatchObject({
      filePath: resolvedFile,
      linked: true,
      rootKind: "provider-project",
    });
    expect(byName(skills, "outside-directory")).toBeUndefined();
    expect(byName(skills, "outside-file")).toBeUndefined();
  });

  it("keeps an OMP-style external plain project root scannable without following child links", async () => {
    const fixture = await makeWorkspaceFixture();
    const externalRoot = path.join(tempRoot, "omp-custom-skills");
    const externalFile = path.join(tempRoot, "omp-custom-file", "SKILL.md");
    const linkedExternalFile = path.join(
      tempRoot,
      "omp-linked-file",
      "SKILL.md",
    );
    const internalDirectory = path.join(
      fixture.cwd,
      ".agents",
      "skills",
      "internal-directory",
    );
    const internalFile = path.join(
      fixture.cwd,
      ".agents",
      "skills",
      "internal-file",
      "SKILL.md",
    );
    await writeSkill(
      path.join(externalRoot, "external-plain", "SKILL.md"),
      "external-plain",
    );
    await writeSkill(externalFile, "external-file");
    await writeSkill(
      path.join(internalDirectory, "SKILL.md"),
      "linked-directory",
    );
    await writeSkill(internalFile, "linked-file");
    await symlink(
      internalDirectory,
      path.join(externalRoot, "linked-directory"),
      "dir",
    );
    await mkdir(path.join(externalRoot, "linked-file"), { recursive: true });
    await symlink(
      internalFile,
      path.join(externalRoot, "linked-file", "SKILL.md"),
    );
    await mkdir(path.dirname(linkedExternalFile), { recursive: true });
    await symlink(internalFile, linkedExternalFile);

    const skills = await listSkills(
      fixture,
      fixture.cwd,
      resolvedSkillRoots([
        {
          path: externalRoot,
          origin: "project",
          shape: "skills",
          recursive: false,
          ancestors: false,
          namePrefix: "",
        },
        {
          path: externalFile,
          origin: "project",
          shape: "skill-file",
          recursive: false,
          ancestors: false,
          namePrefix: "",
        },
        {
          path: linkedExternalFile,
          origin: "project",
          shape: "skill-file",
          recursive: false,
          ancestors: false,
          namePrefix: "",
        },
      ]),
    );

    expect(skills.map((skill) => skill.name)).toEqual([
      "external-plain",
      "external-file",
    ]);
    expect(byName(skills, "external-plain")).toMatchObject({
      filePath: path.join(externalRoot, "external-plain", "SKILL.md"),
      linked: false,
      rootKind: "provider-project",
    });
  });

  it("keeps a Claude cached project plugin's external plain skill root scannable", async () => {
    const fixture = await makeWorkspaceFixture();
    const cachedSkill = path.join(tempRoot, "claude-cache", "cached-skill");
    const linkedSkillTarget = path.join(
      tempRoot,
      "claude-cache-target",
      "linked-skill",
    );
    const linkedSkill = path.join(tempRoot, "claude-cache", "linked-skill");
    await writeSkill(path.join(cachedSkill, "SKILL.md"), "cached-skill");
    await writeSkill(path.join(linkedSkillTarget, "SKILL.md"), "linked-skill");
    await mkdir(path.dirname(linkedSkill), { recursive: true });
    await symlink(linkedSkillTarget, linkedSkill, "dir");

    const skills = await listSkills(
      fixture,
      fixture.cwd,
      resolvedSkillRoots([
        {
          path: cachedSkill,
          origin: "project",
          shape: "skill",
          recursive: false,
          ancestors: false,
          namePrefix: "cache:",
        },
        {
          path: linkedSkill,
          origin: "project",
          shape: "skill",
          recursive: false,
          ancestors: false,
          namePrefix: "cache:",
        },
      ]),
    );

    expect(skills.map((skill) => skill.name)).toEqual(["cache:cached-skill"]);
    expect(byName(skills, "cache:cached-skill")).toMatchObject({
      filePath: path.join(cachedSkill, "SKILL.md"),
      linked: false,
      rootKind: "plugin",
    });
  });

  it("rejects project resolved roots without a repository boundary", async () => {
    const fixture = await makeWorkspaceFixture();
    const directoryRoot = path.join(tempRoot, "unbounded-project-directory");
    const fileRoot = path.join(tempRoot, "unbounded-project-file", "SKILL.md");
    await writeSkill(path.join(directoryRoot, "SKILL.md"), "directory-root");
    await writeSkill(fileRoot, "file-root");

    const skills = await listSkills(
      fixture,
      null,
      resolvedSkillRoots([
        {
          path: directoryRoot,
          origin: "project",
          shape: "skill",
          recursive: false,
          ancestors: false,
          namePrefix: "",
        },
        {
          path: fileRoot,
          origin: "project",
          shape: "skill-file",
          recursive: false,
          ancestors: false,
          namePrefix: "",
        },
      ]),
    );

    expect(skills).toEqual([]);
  });

  it("preserves plain bb-project skills without following child links", async () => {
    const fixture = await makeWorkspaceFixture();
    const plainFile = path.join(
      fixture.cwd,
      ".bb",
      "skills",
      "plain",
      "SKILL.md",
    );
    const inside = path.join(fixture.cwd, ".agents", "skills", "inside");
    const fileTarget = path.join(
      fixture.cwd,
      ".agents",
      "skills",
      "file-target",
      "SKILL.md",
    );
    const outside = path.join(tempRoot, "outside-bb-project");
    await writeSkill(plainFile, "plain");
    await writeSkill(path.join(inside, "SKILL.md"), "inside");
    await writeSkill(fileTarget, "file-target");
    await writeSkill(path.join(outside, "SKILL.md"), "outside");
    const bbRoot = path.join(fixture.cwd, ".bb", "skills");
    await mkdir(bbRoot, { recursive: true });
    await symlink(inside, path.join(bbRoot, "inside"), "dir");
    await symlink(outside, path.join(bbRoot, "outside"), "dir");
    await mkdir(path.join(bbRoot, "file-linked"), { recursive: true });
    await symlink(fileTarget, path.join(bbRoot, "file-linked", "SKILL.md"));

    const skills = await listSkills(fixture, fixture.cwd, skillRoots({}));

    expect(skills).toHaveLength(1);
    expect(byName(skills, "plain")).toMatchObject({
      filePath: plainFile,
      linked: false,
      rootKind: "bb-project",
    });
    expect(byName(skills, "inside")).toBeUndefined();
    expect(byName(skills, "file-target")).toBeUndefined();
    expect(byName(skills, "outside")).toBeUndefined();
  });

  it("allows project aliases from a nested cwd to target the repository root", async () => {
    const fixture = await makeWorkspaceFixture();
    const cwd = path.join(fixture.cwd, "packages", "app");
    const providerTarget = path.join(
      fixture.cwd,
      ".agents",
      "skills",
      "provider-root-skill",
    );
    const bbTarget = path.join(
      fixture.cwd,
      ".agents",
      "skills",
      "bb-root-skill",
    );
    const providerRoot = path.join(cwd, ".provider", "skills");
    const bbRoot = path.join(cwd, ".bb", "skills");
    await mkdir(path.join(fixture.cwd, ".git"), { recursive: true });
    await writeSkill(
      path.join(providerTarget, "SKILL.md"),
      "provider-root-skill",
    );
    await writeSkill(path.join(bbTarget, "SKILL.md"), "bb-root-skill");
    await mkdir(providerRoot, { recursive: true });
    await mkdir(bbRoot, { recursive: true });
    await symlink(
      providerTarget,
      path.join(providerRoot, "provider-root-skill"),
      "dir",
    );
    await symlink(bbTarget, path.join(bbRoot, "bb-root-skill"), "dir");

    const skills = await listSkills(
      fixture,
      cwd,
      skillRoots({ project: [declared(".provider/skills")] }),
    );

    expect(byName(skills, "provider-root-skill")).toMatchObject({
      filePath: path.join(providerRoot, "provider-root-skill", "SKILL.md"),
      linked: true,
      rootKind: "provider-project",
    });
    expect(byName(skills, "bb-root-skill")).toBeUndefined();
  });

  it("rejects sibling-prefix, external, broken, and looping project skill links", async () => {
    const fixture = await makeWorkspaceFixture();
    const providerRoot = path.join(fixture.cwd, ".provider", "skills");
    const outsideRoot = `${fixture.cwd}-sibling`;
    const outsideDirectory = path.join(tempRoot, "outside-directory");
    const outsideFile = path.join(tempRoot, "outside-file", "SKILL.md");
    await writeSkill(
      path.join(outsideRoot, "outside-root", "SKILL.md"),
      "outside-root",
    );
    await writeSkill(
      path.join(outsideDirectory, "SKILL.md"),
      "outside-directory",
    );
    await writeSkill(outsideFile, "outside-file");
    await writeSkill(path.join(providerRoot, "safe", "SKILL.md"), "safe");
    await mkdir(path.join(providerRoot, "outside-file"), { recursive: true });
    await mkdir(path.join(providerRoot, "broken-file"), { recursive: true });
    await mkdir(path.join(providerRoot, "looping-file"), { recursive: true });
    await symlink(
      outsideDirectory,
      path.join(providerRoot, "outside-directory"),
      "dir",
    );
    await symlink(
      outsideFile,
      path.join(providerRoot, "outside-file", "SKILL.md"),
    );
    await symlink(
      path.join(tempRoot, "missing-directory"),
      path.join(providerRoot, "broken-directory"),
      "dir",
    );
    await symlink(
      path.join(tempRoot, "missing-file.md"),
      path.join(providerRoot, "broken-file", "SKILL.md"),
    );
    await symlink(
      "looping-directory",
      path.join(providerRoot, "looping-directory"),
      "dir",
    );
    await symlink(
      "SKILL.md",
      path.join(providerRoot, "looping-file", "SKILL.md"),
    );

    const outsideRootLink = path.join(fixture.cwd, ".outside-root");
    const brokenRootLink = path.join(fixture.cwd, ".broken-root");
    const loopingRootLink = path.join(fixture.cwd, ".looping-root");
    await symlink(outsideRoot, outsideRootLink, "dir");
    await symlink(path.join(tempRoot, "missing-root"), brokenRootLink, "dir");
    await symlink(".looping-root", loopingRootLink, "dir");

    const skills = await listSkills(
      fixture,
      fixture.cwd,
      skillRoots({
        project: [
          declared(".provider/skills"),
          declared(".outside-root"),
          declared(".broken-root"),
          declared(".looping-root"),
        ],
      }),
    );

    expect(skills.map((skill) => skill.name)).toEqual(["safe"]);
  });

  it("rejects internal project roots whose root or parent component escapes the repository", async () => {
    const fixture = await makeWorkspaceFixture();
    const outsideParent = path.join(tempRoot, "outside-parent");
    const outsideRoot = path.join(tempRoot, "outside-root");
    await writeSkill(
      path.join(outsideParent, "skills", "parent-escape", "SKILL.md"),
      "parent-escape",
    );
    await writeSkill(
      path.join(outsideRoot, "root-escape", "SKILL.md"),
      "root-escape",
    );
    await symlink(outsideParent, path.join(fixture.cwd, ".parent-link"), "dir");
    await mkdir(path.join(fixture.cwd, ".root-link"), { recursive: true });
    await symlink(
      outsideRoot,
      path.join(fixture.cwd, ".root-link", "skills"),
      "dir",
    );

    const skills = await listSkills(
      fixture,
      fixture.cwd,
      skillRoots({
        project: [
          declared(".parent-link/skills"),
          declared(".root-link/skills"),
        ],
      }),
    );

    expect(skills).toEqual([]);
  });

  it("deduplicates project root aliases by real skill file", async () => {
    const fixture = await makeWorkspaceFixture();
    const canonicalRoot = path.join(fixture.cwd, ".agents", "skills");
    const aliasRoot = path.join(fixture.cwd, ".claude", "skills");
    await writeSkill(path.join(canonicalRoot, "review", "SKILL.md"), "review");
    await mkdir(path.dirname(aliasRoot), { recursive: true });
    await symlink(path.join("..", ".agents", "skills"), aliasRoot, "dir");

    const skills = await listSkills(
      fixture,
      fixture.cwd,
      skillRoots({
        project: [declared(".claude/skills"), declared(".agents/skills")],
      }),
    );

    expect(skills.filter((skill) => skill.name === "review")).toHaveLength(1);
    expect(byName(skills, "review")).toMatchObject({
      filePath: path.join(aliasRoot, "review", "SKILL.md"),
      linked: true,
    });
  });

  it("classifies a prefixed declared root as a plugin root", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeSkill(
      path.join(fixture.homeDir, "tools", "skills", "release", "SKILL.md"),
      "release",
    );

    const skills = await listSkills(
      fixture,
      fixture.cwd,
      skillRoots({
        user: [declared("tools/skills", { namePrefix: "release-tools:" })],
      }),
    );

    expect(byName(skills, "release-tools:release")).toMatchObject({
      rootKind: "plugin",
      filePath: path.join(
        fixture.homeDir,
        "tools",
        "skills",
        "release",
        "SKILL.md",
      ),
    });
  });

  it("classifies configured shared user and project roots", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeSkill(
      path.join(
        fixture.homeDir,
        ".agents",
        "skills",
        "user-shared",
        "SKILL.md",
      ),
      "user-shared",
    );
    await writeSkill(
      path.join(fixture.cwd, ".agents", "skills", "project-shared", "SKILL.md"),
      "project-shared",
    );

    const skills = await listSkills(
      fixture,
      fixture.cwd,
      skillRoots({
        user: [declared(".agents/skills")],
        project: [declared(".agents/skills")],
      }),
      "bb-shared",
    );

    expect(byName(skills, "project-shared")?.rootKind).toBe("shared-project");
    expect(byName(skills, "user-shared")?.rootKind).toBe("shared-user");
  });

  it("discovers a project skill through a symlinked shared root", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeSkill(
      path.join(fixture.cwd, ".agents", "skills", "linked-root", "SKILL.md"),
      "linked-root",
    );
    await mkdir(path.join(fixture.cwd, ".shared"), { recursive: true });
    await symlink(
      path.join("..", ".agents", "skills"),
      path.join(fixture.cwd, ".shared", "skills"),
      "dir",
    );

    const skills = await listSkills(
      fixture,
      fixture.cwd,
      skillRoots({ project: [declared(".shared/skills")] }),
      "bb-shared",
    );

    expect(byName(skills, "linked-root")).toMatchObject({
      rootKind: "shared-project",
      linked: true,
    });
  });

  it("classifies a skill through a symlinked recursive .cursor/skills root", async () => {
    const fixture = await makeWorkspaceFixture();
    await writeSkill(
      path.join(fixture.cwd, ".agents", "skills", "impeccable", "SKILL.md"),
      "impeccable",
    );
    await mkdir(path.join(fixture.cwd, ".cursor"), { recursive: true });
    await symlink(
      path.join("..", ".agents", "skills"),
      path.join(fixture.cwd, ".cursor", "skills"),
      "dir",
    );

    const skills = await listSkills(
      fixture,
      fixture.cwd,
      skillRoots({
        project: [declared(".cursor/skills", { recursive: true })],
      }),
    );

    expect(skills.filter((skill) => skill.name === "impeccable")).toHaveLength(
      1,
    );
    expect(byName(skills, "impeccable")).toMatchObject({
      rootKind: "provider-project",
      linked: true,
      filePath: path.join(
        fixture.cwd,
        ".cursor",
        "skills",
        "impeccable",
        "SKILL.md",
      ),
    });
  });
});

describe("discoverSkills marks the linked flag per root shape", () => {
  const USER_SKILL_ROOT = {
    namePrefix: "",
    source: "skill",
    origin: "user",
    identitySeed: "provider-user",
    rootKind: "provider-user",
  } as const;

  async function writeSkillTarget(name: string): Promise<string> {
    const target = path.join(tempRoot, "targets", `${name}.md`);
    await writeSkill(target, name);
    return target;
  }

  async function discoverRoot(
    root: SkillScanRoot,
  ): Promise<[name: string, linked: boolean, filePath: string][]> {
    const skills = await discoverSkills({ roots: [root] });
    return skills.map((skill) => [skill.name, skill.linked, skill.filePath]);
  }

  it("skill-directory: the root directory or its SKILL.md being a symlink", async () => {
    const plainRoot = path.join(tempRoot, "plain-dir");
    await writeSkill(path.join(plainRoot, "SKILL.md"), "plain-dir");
    const linkedRoot = path.join(tempRoot, "linked-dir");
    await symlink(plainRoot, linkedRoot, "dir");
    const fileLinkedRoot = path.join(tempRoot, "file-linked-dir");
    await mkdir(fileLinkedRoot, { recursive: true });
    await symlink(
      await writeSkillTarget("file-linked-dir"),
      path.join(fileLinkedRoot, "SKILL.md"),
    );

    for (const [rootPath, linked] of [
      [plainRoot, false],
      [linkedRoot, true],
      [fileLinkedRoot, true],
    ] as const) {
      expect(
        await discoverRoot({
          ...USER_SKILL_ROOT,
          shape: "skill-directory",
          rootPath,
        }),
      ).toEqual([
        [path.basename(rootPath), linked, path.join(rootPath, "SKILL.md")],
      ]);
    }
  });

  it("skill-file: the SKILL.md itself being a symlink", async () => {
    const plainFile = path.join(tempRoot, "plugin", "SKILL.md");
    await writeSkill(plainFile, "plain-plugin");
    const linkedFile = path.join(tempRoot, "plugin-linked", "SKILL.md");
    await mkdir(path.dirname(linkedFile), { recursive: true });
    await symlink(await writeSkillTarget("linked-plugin"), linkedFile);

    for (const [filePath, name, linked] of [
      [plainFile, "plain-plugin", false],
      [linkedFile, "linked-plugin", true],
    ] as const) {
      expect(
        await discoverRoot({
          ...USER_SKILL_ROOT,
          shape: "skill-file",
          filePath,
          fallbackName: "unused-fallback",
        }),
      ).toEqual([[name, linked, filePath]]);
    }
  });

  it("skill-recursive: only the root being a symlink counts; nested links are not walked", async () => {
    const plainRoot = path.join(tempRoot, "recursive");
    await writeSkill(
      path.join(plainRoot, "category", "nested", "SKILL.md"),
      "nested",
    );
    await writeSkill(
      path.join(tempRoot, "nested-link-target", "SKILL.md"),
      "through-nested-link",
    );
    await symlink(
      path.join(tempRoot, "nested-link-target"),
      path.join(plainRoot, "linked-category"),
      "dir",
    );
    const linkedRoot = path.join(tempRoot, "recursive-linked");
    await symlink(plainRoot, linkedRoot, "dir");

    for (const [rootPath, linked] of [
      [plainRoot, false],
      [linkedRoot, true],
    ] as const) {
      expect(
        await discoverRoot({
          ...USER_SKILL_ROOT,
          shape: "skill-recursive",
          rootPath,
        }),
      ).toEqual([
        [
          "nested",
          linked,
          path.join(rootPath, "category", "nested", "SKILL.md"),
        ],
      ]);
    }
  });

  it("skill: the root, the skill entry, or its SKILL.md being a symlink", async () => {
    const rootPath = path.join(tempRoot, "skills");
    await writeSkill(path.join(rootPath, "plain", "SKILL.md"), "plain");
    await writeSkill(
      path.join(tempRoot, "entry-target", "SKILL.md"),
      "entry-linked",
    );
    await symlink(
      path.join(tempRoot, "entry-target"),
      path.join(rootPath, "entry-linked"),
      "dir",
    );
    await mkdir(path.join(rootPath, "file-linked"), { recursive: true });
    await symlink(
      await writeSkillTarget("file-linked"),
      path.join(rootPath, "file-linked", "SKILL.md"),
    );
    const linkedRoot = path.join(tempRoot, "skills-linked");
    await symlink(rootPath, linkedRoot, "dir");

    expect(
      await discoverRoot({ ...USER_SKILL_ROOT, shape: "skill", rootPath }),
    ).toEqual([
      ["entry-linked", true, path.join(rootPath, "entry-linked", "SKILL.md")],
      ["file-linked", true, path.join(rootPath, "file-linked", "SKILL.md")],
      ["plain", false, path.join(rootPath, "plain", "SKILL.md")],
    ]);
    expect(
      (
        await discoverRoot({
          ...USER_SKILL_ROOT,
          shape: "skill",
          rootPath: linkedRoot,
        })
      ).map(([name, linked]) => [name, linked]),
    ).toEqual([
      ["entry-linked", true],
      ["file-linked", true],
      ["plain", true],
    ]);
  });
});

describe("deleteHostSkill", () => {
  it("deletes a bb-user skill directory", async () => {
    const fixture = await makeWorkspaceFixture();
    const skillDir = path.join(fixture.dataDir, "skills", "doomed");
    await writeSkill(path.join(skillDir, "SKILL.md"), "doomed");

    const result = await deleteHostSkill(
      {
        type: "host.delete_skill",
        scope: "bb-user",
        name: "doomed",
        cwd: null,
        rootPath: null,
      },
      { dataDir: fixture.dataDir },
    );

    expect(await stat(skillDir).catch(() => null)).toBeNull();
    expect(result.deletedPath).toContain("doomed");
  });

  it("deletes a bb-project skill directory under cwd/.bb/skills", async () => {
    const fixture = await makeWorkspaceFixture();
    const skillDir = path.join(fixture.cwd, ".bb", "skills", "proj-doomed");
    await writeSkill(path.join(skillDir, "SKILL.md"), "proj-doomed");

    await deleteHostSkill(
      {
        type: "host.delete_skill",
        scope: "bb-project",
        name: "proj-doomed",
        cwd: fixture.cwd,
        rootPath: null,
      },
      { dataDir: fixture.dataDir },
    );

    expect(await stat(skillDir).catch(() => null)).toBeNull();
  });

  it("deletes a user-owned provider skill inside its discovered root", async () => {
    const fixture = await makeWorkspaceFixture();
    const providerRoot = path.join(fixture.homeDir, ".claude", "skills");
    const skillDir = path.join(providerRoot, "notes");
    await writeSkill(path.join(skillDir, "SKILL.md"), "notes");

    await deleteHostSkill(
      {
        type: "host.delete_skill",
        scope: "provider-user",
        name: "notes",
        cwd: null,
        rootPath: providerRoot,
      },
      { dataDir: fixture.dataDir },
    );

    expect(await stat(skillDir).catch(() => null)).toBeNull();
  });

  it("refuses a name that escapes the root via path traversal", async () => {
    const fixture = await makeWorkspaceFixture();
    await expect(
      deleteHostSkill(
        {
          type: "host.delete_skill",
          scope: "bb-user",
          name: "../evil",
          cwd: null,
          rootPath: null,
        },
        { dataDir: fixture.dataDir },
      ),
    ).rejects.toMatchObject({ code: "invalid_skill_name" });
  });

  it("refuses a skill symlinked outside the bb root after realpath", async () => {
    const fixture = await makeWorkspaceFixture();
    const outside = path.join(tempRoot, "outside", "secret");
    await writeSkill(path.join(outside, "SKILL.md"), "secret");
    const skillsRoot = path.join(fixture.dataDir, "skills");
    await mkdir(skillsRoot, { recursive: true });
    await symlink(outside, path.join(skillsRoot, "link"));

    await expect(
      deleteHostSkill(
        {
          type: "host.delete_skill",
          scope: "bb-user",
          name: "link",
          cwd: null,
          rootPath: null,
        },
        { dataDir: fixture.dataDir },
      ),
    ).rejects.toMatchObject({ code: "skill_outside_root" });
    expect(
      await stat(path.join(outside, "SKILL.md")).catch(() => null),
    ).not.toBeNull();
  });

  it("refuses a skill symlinked to a sibling inside the same root", async () => {
    const fixture = await makeWorkspaceFixture();
    const skillsRoot = path.join(fixture.dataDir, "skills");
    await writeSkill(path.join(skillsRoot, "real", "SKILL.md"), "real");
    await symlink(
      path.join(skillsRoot, "real"),
      path.join(skillsRoot, "alias"),
    );

    await expect(
      deleteHostSkill(
        {
          type: "host.delete_skill",
          scope: "bb-user",
          name: "alias",
          cwd: null,
          rootPath: null,
        },
        { dataDir: fixture.dataDir },
      ),
    ).rejects.toMatchObject({ code: "skill_outside_root" });
    expect(
      await stat(path.join(skillsRoot, "real", "SKILL.md")).catch(() => null),
    ).not.toBeNull();
  });

  it("reports skill_not_found for a missing skill", async () => {
    const fixture = await makeWorkspaceFixture();
    await mkdir(path.join(fixture.dataDir, "skills"), { recursive: true });
    await expect(
      deleteHostSkill(
        {
          type: "host.delete_skill",
          scope: "bb-user",
          name: "ghost",
          cwd: null,
          rootPath: null,
        },
        { dataDir: fixture.dataDir },
      ),
    ).rejects.toBeInstanceOf(CommandDispatchError);
  });

  it("refuses a directory that is not a skill (no SKILL.md)", async () => {
    const fixture = await makeWorkspaceFixture();
    const notSkill = path.join(fixture.dataDir, "skills", "plain");
    await mkdir(notSkill, { recursive: true });
    await writeFile(path.join(notSkill, "README.md"), "not a skill", "utf8");

    await expect(
      deleteHostSkill(
        {
          type: "host.delete_skill",
          scope: "bb-user",
          name: "plain",
          cwd: null,
          rootPath: null,
        },
        { dataDir: fixture.dataDir },
      ),
    ).rejects.toMatchObject({ code: "not_a_skill" });
    expect(await stat(notSkill).catch(() => null)).not.toBeNull();
  });
});

describe("writeHostSkill", () => {
  it("atomically replaces a bb skill only at the expected revision", async () => {
    const fixture = await makeWorkspaceFixture();
    const filePath = path.join(fixture.dataDir, "skills", "review", "SKILL.md");
    const original = "---\nname: review\ndescription: Review\n---\n";
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, original, "utf8");
    const revision = createHash("sha256").update(original).digest("hex");

    const written = await writeHostSkill(
      {
        type: "host.write_skill",
        scope: "bb-user",
        name: "review",
        cwd: null,
        content: "# Updated",
        expectedSha256: revision,
      },
      { dataDir: fixture.dataDir },
    );

    expect(written).toMatchObject({
      outcome: "written",
      filePath: await realpath(filePath),
      sha256: createHash("sha256").update("# Updated").digest("hex"),
    });
    expect(await readFile(filePath, "utf8")).toBe("# Updated");

    const stale = await writeHostSkill(
      {
        type: "host.write_skill",
        scope: "bb-user",
        name: "review",
        cwd: null,
        content: "# Stale overwrite",
        expectedSha256: revision,
      },
      { dataDir: fixture.dataDir },
    );
    expect(stale).toMatchObject({ outcome: "conflict" });
    expect(await readFile(filePath, "utf8")).toBe("# Updated");
  });
});
