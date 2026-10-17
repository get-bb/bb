import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { validateWorkspaceProfileSandbox } from "./workspace-permissions.js";

let fixture: string;
let cwd: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "bb-permission-policy-"));
  cwd = join(fixture, "workspace");
  const home = join(fixture, "home");
  mkdirSync(cwd);
  mkdirSync(join(home, ".codex"), { recursive: true });
  env = { HOME: home, CODEX_HOME: join(home, ".codex") };
});

afterEach(() => rmSync(fixture, { recursive: true, force: true }));

it("accepts a workspace sandbox with specific developer cache roots", () => {
  expect(() =>
    validateWorkspaceProfileSandbox(
      {
        sandbox: {
          type: "workspaceWrite",
          writableRoots: [
            join(env.HOME!, ".npm"),
            join(env.HOME!, ".codex-other"),
          ],
        },
      },
      cwd,
      env,
    ),
  ).not.toThrow();
});

it.each(["dangerFullAccess", "externalSandbox"])(
  "rejects effective %s policies",
  (type) => {
    expect(() =>
      validateWorkspaceProfileSandbox({ sandbox: { type } }, cwd, env),
    ).toThrow("exceed BB workspace isolation");
  },
);

it("reports a read-only policy as incompatible with workspace edit modes", () => {
  expect(() =>
    validateWorkspaceProfileSandbox(
      { sandbox: { type: "readOnly" } },
      cwd,
      env,
    ),
  ).toThrow("read-only");
});

it.each(["root", "home", "codex", "config", "ancestor", "traversal"])(
  "rejects writable %s paths",
  (kind) => {
    const roots = {
      root: "/",
      home: env.HOME!,
      codex: env.CODEX_HOME!,
      config: join(env.CODEX_HOME!, "config.toml"),
      ancestor: fixture,
      traversal: join(cwd, "..", "home", ".codex"),
    };
    expect(() =>
      validateWorkspaceProfileSandbox(
        {
          sandbox: {
            type: "workspaceWrite",
            writableRoots: [roots[kind as keyof typeof roots]],
          },
        },
        cwd,
        env,
      ),
    ).toThrow("Codex configuration");
  },
);

it("rejects a symlink that resolves to the protected configuration directory", () => {
  const link = join(fixture, "cache-link");
  symlinkSync(env.CODEX_HOME!, link);
  expect(() =>
    validateWorkspaceProfileSandbox(
      { sandbox: { type: "workspaceWrite", writableRoots: [link] } },
      cwd,
      env,
    ),
  ).toThrow("Codex configuration");
});

it("checks the implicit cwd even when the server omits it from writableRoots", () => {
  expect(() =>
    validateWorkspaceProfileSandbox(
      { sandbox: { type: "workspaceWrite", writableRoots: [] } },
      env.CODEX_HOME!,
      env,
    ),
  ).toThrow("Codex configuration");
});
