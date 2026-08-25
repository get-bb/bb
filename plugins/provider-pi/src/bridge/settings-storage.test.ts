import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readPiEnabledModelPatterns,
  readPiSettingsFile,
  updatePiSettingsFile,
} from "./settings-storage.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bb-pi-settings-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("pi settings files", () => {
  it("rewrites atomically, keeps unrelated keys and the file mode, and leaves no temp file", () => {
    const root = tempRoot();
    const path = join(root, "agent", "settings.json");
    mkdirSync(join(root, "agent"), { recursive: true });
    writeFileSync(path, JSON.stringify({ theme: "dark", skills: ["~/skills"] }));
    chmodSync(path, 0o644);

    updatePiSettingsFile(path, (current) => ({ ...current, enabledModels: ["a/b"] }));

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      theme: "dark",
      skills: ["~/skills"],
      enabledModels: ["a/b"],
    });
    expect(statSync(path).mode & 0o777).toBe(0o644);
    expect(readdirSync(join(root, "agent"))).toEqual(["settings.json"]);
  });

  it("creates a private file in a missing agent dir and reads an absent one as empty", () => {
    const root = tempRoot();
    const path = join(root, "fresh", "settings.json");
    expect(readPiSettingsFile(path)).toEqual({});
    updatePiSettingsFile(path, () => ({ enabledModels: ["a/b"] }));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("reports an unreadable file instead of silently starting over", () => {
    const root = tempRoot();
    const path = join(root, "settings.json");
    writeFileSync(path, "{not json");
    expect(() => readPiSettingsFile(path)).toThrow(/Failed to load Pi settings/u);
    expect(() => updatePiSettingsFile(path, (current) => current)).toThrow(
      /Failed to load Pi settings/u,
    );
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });

  it("reads the global enabledModels, and reads a broken file as empty instead of failing", () => {
    const root = tempRoot();
    const agentDir = join(root, "agent");
    mkdirSync(agentDir, { recursive: true });
    const env = { PI_CODING_AGENT_DIR: agentDir };
    expect(readPiEnabledModelPatterns(env)).toBeUndefined();
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ enabledModels: ["global/*"] }));
    expect(readPiEnabledModelPatterns(env)).toEqual(["global/*"]);
    writeFileSync(join(agentDir, "settings.json"), "{not json");
    expect(readPiEnabledModelPatterns(env)).toBeUndefined();
  });

  it("writes through a symlink and leaves no lock behind", () => {
    const root = tempRoot();
    const real = join(root, "dotfiles", "settings.json");
    mkdirSync(join(root, "dotfiles"), { recursive: true });
    mkdirSync(join(root, "agent"), { recursive: true });
    writeFileSync(real, JSON.stringify({ theme: "dark" }));
    const link = join(root, "agent", "settings.json");
    symlinkSync(real, link);

    updatePiSettingsFile(link, (current) => ({ ...current, enabledModels: ["a/b"] }));

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(real, "utf8"))).toEqual({ theme: "dark", enabledModels: ["a/b"] });
    expect(readdirSync(join(root, "agent"))).toEqual(["settings.json"]);
    expect(readdirSync(join(root, "dotfiles"))).toEqual(["settings.json"]);
  });
});
