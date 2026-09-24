import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { experimental_nativeRootsResolveOutputSchema } from "@get-bb/plugin-sdk/host";
import { afterEach, beforeEach, expect, it } from "vitest";
import { resolvePiNativeRoots } from "./native-roots.js";

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "bb-pi-native-roots-"));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

function writeSettings(agentDir: string, settings: unknown): void {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings));
}

async function resolvedSkillPaths(
  env: Readonly<Record<string, string | undefined>>,
): Promise<string[]> {
  const answer = await resolvePiNativeRoots({ homeDir, env, cwd: null });
  const parsed = experimental_nativeRootsResolveOutputSchema.parse(answer);
  for (const root of parsed.skills) {
    expect(root).toMatchObject({
      origin: "user",
      shape: "skills",
      namePrefix: "",
    });
  }
  return parsed.skills.map((root) => root.path);
}

async function resolvedCommandFiles(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string | null = null,
): Promise<Array<{ path: string; origin: "user" | "project"; shape: string }>> {
  const answer = await resolvePiNativeRoots({ homeDir, env, cwd });
  const parsed = experimental_nativeRootsResolveOutputSchema.parse(answer);
  return parsed.commands.map(({ path, origin, shape }) => ({
    path,
    origin,
    shape,
  }));
}

function writePrompt(directory: string, name: string): string {
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, name);
  writeFileSync(filePath, `---\ndescription: ${name}\n---\nTest prompt`);
  return filePath;
}
it("answers empty without a settings file or with an unreadable one", async () => {
  await expect(resolvedSkillPaths({})).resolves.toEqual([]);
  mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
  writeFileSync(join(homeDir, ".pi", "agent", "settings.json"), "{not json");
  await expect(resolvedSkillPaths({})).resolves.toEqual([]);
});

it("resolves plain skill entries against home, the agent dir, or as given, and drops the rest", async () => {
  writeSettings(join(homeDir, ".pi", "agent"), {
    skills: [
      "/opt/team-skills",
      "~/shared/skills",
      "local-skills/",
      "team/one-skill/SKILL.md",
      "notes/single-skill.md",
      "!disabled-pattern",
      "npm:@acme/pi-skills",
      "git:github.com/acme/skills",
      "https://example.invalid/skills",
      "  ",
      "/opt/team-skills",
    ],
  });
  await expect(resolvedSkillPaths({})).resolves.toEqual(
    [
      "/opt/team-skills",
      join(homeDir, ".pi", "agent", "local-skills"),
      join(homeDir, "shared", "skills"),
    ].sort(),
  );
});

it("adds the moved agent dir's skills directory when PI_CODING_AGENT_DIR points elsewhere", async () => {
  const agentDir = join(homeDir, "custom-agent");
  writeSettings(agentDir, { skills: [] });
  await expect(
    resolvedSkillPaths({ PI_CODING_AGENT_DIR: agentDir }),
  ).resolves.toEqual([join(agentDir, "skills")]);
  await expect(
    resolvedSkillPaths({ PI_CODING_AGENT_DIR: "~/custom-agent" }),
  ).resolves.toEqual([join(agentDir, "skills")]);
});

it("never answers a root the contract would refuse", async () => {
  writeSettings(join(homeDir, ".pi", "agent"), {
    skills: [
      "/opt/../etc/skills",
      "/opt//skills",
      "relative/../escape",
      "/srv/skills/",
      "~/team-skills//",
    ],
  });
  await expect(resolvedSkillPaths({})).resolves.toEqual(
    [
      "/etc/skills",
      "/opt/skills",
      join(homeDir, ".pi", "agent", "escape"),
      "/srv/skills",
      join(homeDir, "team-skills"),
    ].sort(),
  );
});

it("lists flat user and project Pi prompt templates without nested files", async () => {
  const userDir = join(homeDir, ".pi", "agent", "prompts");
  const workspace = join(homeDir, "workspace");
  const userPr = writePrompt(userDir, "pr.md");
  writeSettings(join(homeDir, ".pi", "agent"), {
    defaultProjectTrust: "always",
  });
  const projectRebase = writePrompt(
    join(workspace, ".pi", "prompts"),
    "rebase.md",
  );
  writePrompt(join(userDir, "nested"), "not-loaded.md");
  writeFileSync(join(userDir, "notes.txt"), "not a prompt");
  const roots = await resolvedCommandFiles({}, workspace);
  expect(roots).toEqual(
    [
      { path: userPr, origin: "user", shape: "command-file" },
      { path: projectRebase, origin: "project", shape: "command-file" },
    ].sort((a, b) => a.path.localeCompare(b.path)),
  );
  await expect(resolvedCommandFiles({})).resolves.toEqual([
    { path: userPr, origin: "user", shape: "command-file" },
  ]);
});

it("resolves configured prompt directories and files on the invoking host", async () => {
  const agentDir = join(homeDir, ".pi", "agent");
  const team = join(homeDir, "team-prompts");
  const local = join(agentDir, "local-prompts");
  const shared = join(homeDir, "shared", "prompts");
  const files = [
    writePrompt(team, "team.md"),
    writePrompt(shared, "shared.md"),
    writePrompt(local, "local.md"),
    writePrompt(agentDir, "custom.md"),
  ];
  writePrompt(join(team, "nested"), "not-loaded.md");
  writeSettings(agentDir, {
    prompts: [
      team,
      "~/shared/prompts",
      "local-prompts/",
      "custom.md",
      "!disabled-pattern",
      "npm:@acme/pi-prompts",
      "git:github.com/acme/prompts",
      "  ",
      team,
    ],
  });
  await expect(resolvedCommandFiles({})).resolves.toEqual(
    files
      .sort()
      .map((path) => ({ path, origin: "user", shape: "command-file" })),
  );
});

it("lists prompt templates under a moved PI_CODING_AGENT_DIR", async () => {
  const agentDir = join(homeDir, "custom-agent");
  const filePath = writePrompt(join(agentDir, "prompts"), "pr.md");
  writeSettings(agentDir, { prompts: [] });
  const expected = [{ path: filePath, origin: "user", shape: "command-file" }];
  await expect(
    resolvedCommandFiles({ PI_CODING_AGENT_DIR: agentDir }),
  ).resolves.toEqual(expected);
  await expect(
    resolvedCommandFiles({ PI_CODING_AGENT_DIR: "~/custom-agent" }),
  ).resolves.toEqual(expected);
});

it("filters ignored and disabled user and project templates, with Pi override precedence", async () => {
  const agentDir = join(homeDir, ".pi", "agent");
  const userDir = join(agentDir, "prompts");
  const workspace = join(homeDir, "workspace");
  const projectDir = join(workspace, ".pi", "prompts");
  const enabled = writePrompt(userDir, "enabled.md");
  const restored = writePrompt(userDir, "restored.md");
  writePrompt(userDir, "disabled.md");
  writePrompt(userDir, "blocked.md");
  writePrompt(userDir, "ignored-git.md");
  writePrompt(userDir, "ignored-ignore.md");
  writePrompt(userDir, "ignored-fd.md");
  writePrompt(userDir, ".hidden.md");
  writeFileSync(join(userDir, ".gitignore"), "ignored-git.md\n");
  writeFileSync(join(userDir, ".ignore"), "ignored-ignore.md\n");
  writeFileSync(join(userDir, ".fdignore"), "ignored-fd.md\n");
  const projectEnabled = writePrompt(projectDir, "project-enabled.md");
  writePrompt(projectDir, "project-disabled.md");
  writeSettings(agentDir, {
    defaultProjectTrust: "always",
    prompts: [
      "!disabled.md",
      "!restored.md",
      "+prompts/restored.md",
      "!blocked.md",
      "+prompts/blocked.md",
      "-prompts/blocked.md",
    ],
  });
  writeSettings(join(workspace, ".pi"), { prompts: ["!project-disabled.md"] });
  await expect(resolvedCommandFiles({}, workspace)).resolves.toEqual(
    [enabled, restored, projectEnabled].sort().map((path) => ({
      path,
      origin: path === projectEnabled ? "project" : "user",
      shape: "command-file",
    })),
  );
});

it("keeps untrusted project prompts out of the picker", async () => {
  const workspace = join(homeDir, "workspace");
  const projectPrompt = writePrompt(
    join(workspace, ".pi", "prompts"),
    "project.md",
  );
  await expect(resolvedCommandFiles({}, workspace)).resolves.toEqual([]);
  const agentDir = join(homeDir, ".pi", "agent");
  writeSettings(agentDir, { defaultProjectTrust: "always" });
  await expect(resolvedCommandFiles({}, workspace)).resolves.toEqual([
    { path: projectPrompt, origin: "project", shape: "command-file" },
  ]);
  writeFileSync(
    join(agentDir, "trust.json"),
    JSON.stringify({ [realpathSync(workspace)]: false }),
  );
  await expect(resolvedCommandFiles({}, workspace)).resolves.toEqual([]);
  writeFileSync(
    join(agentDir, "trust.json"),
    JSON.stringify({ [realpathSync(homeDir)]: true }),
  );
  await expect(resolvedCommandFiles({}, workspace)).resolves.toEqual([
    { path: projectPrompt, origin: "project", shape: "command-file" },
  ]);
});

it("returns symlinked prompt files by their command name, including configured links", async () => {
  const agentDir = join(homeDir, ".pi", "agent");
  const userDir = join(agentDir, "prompts");
  const projectDir = join(homeDir, "workspace", ".pi", "prompts");
  const target = writePrompt(join(homeDir, "other"), "actual-name.md");
  mkdirSync(userDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  const userLink = join(userDir, "alias.md");
  const projectLink = join(projectDir, "project-alias.md");
  const configuredLink = join(agentDir, "configured.md");
  symlinkSync(target, userLink);
  symlinkSync(target, projectLink);
  symlinkSync(target, configuredLink);
  symlinkSync(join(homeDir, "missing.md"), join(userDir, "broken.md"));
  writeSettings(agentDir, {
    prompts: ["configured.md"],
    defaultProjectTrust: "always",
  });
  await expect(
    resolvedCommandFiles({}, join(homeDir, "workspace")),
  ).resolves.toEqual(
    [
      { path: configuredLink, origin: "user", shape: "command-file" },
      { path: userLink, origin: "user", shape: "command-file" },
      { path: projectLink, origin: "project", shape: "command-file" },
    ].sort((a, b) => a.path.localeCompare(b.path)),
  );
});
