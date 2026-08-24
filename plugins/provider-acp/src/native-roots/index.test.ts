import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acpProviderDeclaration } from "../declaration.js";
import { KNOWN_ACP_AGENTS } from "../known-agents.js";
import { resolveAcpNativeRoots } from "./index.js";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), "bb-acp-native-roots-index-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tempRoot, { recursive: true, force: true });
});

describe("resolveAcpNativeRoots", () => {
  it("answers for the agent asked and nothing for the rest", async () => {
    const homeDir = path.join(tempRoot, "home");
    const args = { cwd: null, homeDir, env: { OPENCODE_CONFIG_DIR: "oc" } };

    const opencode = await resolveAcpNativeRoots({ ...args, agentId: "acp-opencode" });
    expect(opencode.skills?.map((root) => root.path)).toEqual([
      path.join(homeDir, ".config", "opencode", "skills"),
      path.join(homeDir, "oc", "skills"),
    ]);
    // Cursor declares everything statically; a configured agent is unknown here.
    expect(await resolveAcpNativeRoots({ ...args, agentId: "acp-cursor" })).toEqual({});
    expect(await resolveAcpNativeRoots({ ...args, agentId: "acp-amp" })).toEqual({});
  });

  it("drops only the root the contract refuses, with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const homeDir = path.join(tempRoot, "home");
    // A grok plugin whose directory name cannot be a name prefix.
    const pluginRoot = path.join(homeDir, ".grok", "plugins", "bad name");
    await mkdir(path.join(pluginRoot, "skills"), { recursive: true });
    await mkdir(path.join(homeDir, ".grok"), { recursive: true });
    await writeFile(
      path.join(homeDir, ".grok", "config.toml"),
      '[plugins]\nenabled = ["bad name"]\n',
      "utf8",
    );

    const answer = await resolveAcpNativeRoots({
      agentId: "acp-grok",
      cwd: null,
      homeDir,
      env: {},
    });
    expect(answer.skills?.map((root) => root.path)).toEqual([
      path.join(homeDir, ".grok", "skills"),
      path.join(homeDir, ".claude", "skills"),
      path.join(homeDir, ".cursor", "skills"),
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      `dropped the skills root "${path.join(pluginRoot, "skills")}"`,
    );
  });
});

describe("known agent declarations", () => {
  it("declares the resolver flag exactly for the agents that carry one", () => {
    const resolving = KNOWN_ACP_AGENTS.filter(
      (agent) => acpProviderDeclaration(agent).experimental_resolvesNativeRoots === true,
    ).map((agent) => agent.id);
    expect(resolving).toEqual(["acp-opencode", "acp-omp", "acp-grok", "acp-hermes-agent"]);
    expect(
      KNOWN_ACP_AGENTS.every(
        (agent) => (agent.nativeRootsResolver !== undefined) === resolving.includes(agent.id),
      ),
    ).toBe(true);
  });

  it("passes root options through to the declaration unchanged", () => {
    const cursor = KNOWN_ACP_AGENTS.find((agent) => agent.id === "acp-cursor");
    const grok = KNOWN_ACP_AGENTS.find((agent) => agent.id === "acp-grok");
    if (cursor === undefined || grok === undefined) throw new Error("missing agent");

    const cursorRoots = acpProviderDeclaration(cursor).experimental_nativeSkillRoots;
    for (const side of [cursorRoots?.user ?? [], cursorRoots?.project ?? []]) {
      expect(side).toHaveLength(4);
      expect(side.every((root) => typeof root === "object" && root.recursive === true)).toBe(true);
    }
    expect(acpProviderDeclaration(grok).experimental_nativeSkillRoots).toEqual({
      user: [{ path: ".agents/skills", recursive: true }],
      project: [
        { path: ".grok/skills", recursive: true, ancestors: true },
        { path: ".agents/skills", recursive: true, ancestors: true },
      ],
    });
  });
});
