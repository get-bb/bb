import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { experimental_nativeRootsResolveOutputSchema } from "@get-bb/plugin-sdk/host";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PI_NATIVE_ROOTS_DECLARATION,
  resolvePiNativeRoots,
} from "./native-roots.js";

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
  const answer = await resolvePiNativeRoots({ cwd: null, homeDir, env });
  const parsed = experimental_nativeRootsResolveOutputSchema.parse(answer);
  expect(parsed.commands).toEqual([]);
  for (const root of parsed.skills) {
    expect(root).toMatchObject({
      origin: "user",
      recursive: true,
      shape: "skills",
      namePrefix: "",
    });
  }
  return parsed.skills.map((root) => root.path);
}

it("answers only the agent dir's skills without a settings file or with an unreadable one", async () => {
  const agentSkills = join(homeDir, ".pi", "agent", "skills");
  await expect(resolvedSkillPaths({})).resolves.toEqual([agentSkills]);
  mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
  writeFileSync(join(homeDir, ".pi", "agent", "settings.json"), "{not json");
  await expect(resolvedSkillPaths({})).resolves.toEqual([agentSkills]);
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
      resolve("/opt/team-skills"),
      join(homeDir, ".pi", "agent", "local-skills"),
      join(homeDir, ".pi", "agent", "skills"),
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
      resolve("/etc/skills"),
      resolve("/opt/skills"),
      join(homeDir, ".pi", "agent", "escape"),
      join(homeDir, ".pi", "agent", "skills"),
      resolve("/srv/skills"),
      join(homeDir, "team-skills"),
    ].sort(),
  );
});

describe("user skill roots under a relocated PI_CODING_AGENT_DIR", () => {
  async function listedUserSkillRoots(
    homeDir: string,
    env: Readonly<Record<string, string | undefined>>,
  ): Promise<string[]> {
    const declared = (
      PI_NATIVE_ROOTS_DECLARATION.experimental_nativeSkillRoots?.user ?? []
    ).map((root) =>
      path.join(homeDir, typeof root === "string" ? root : root.path),
    );
    const resolved = await resolvePiNativeRoots({ cwd: null, homeDir, env });
    return [
      ...declared,
      ...(resolved.skills ?? [])
        .filter((root) => root.origin === "user")
        .map((root) => root.path),
    ];
  }

  it("lists the relocated home's skills and not the default home's", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-home-"));
    const relocated = path.join(homeDir, "relocated");
    const listed = await listedUserSkillRoots(homeDir, {
      PI_CODING_AGENT_DIR: relocated,
    });
    expect(listed).toContain(path.join(relocated, "skills"));
    expect(listed).not.toContain(path.join(homeDir, ".pi/agent", "skills"));
  });

  it("lists the default home's skills exactly once when PI_CODING_AGENT_DIR is unset", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-home-"));
    const listed = await listedUserSkillRoots(homeDir, {});
    expect(
      listed.filter(
        (root) => root === path.join(homeDir, ".pi/agent", "skills"),
      ),
    ).toHaveLength(1);
  });
});
