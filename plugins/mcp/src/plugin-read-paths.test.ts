import { afterEach, expect, it, vi } from "vitest";
import { defineCli, cliCommand } from "@get-bb/plugin-sdk";
import { loadPluginReadPaths } from "./plugin-read-paths.js";
import { evaluateCliAccess } from "./policy.js";

afterEach(() => vi.unstubAllGlobals());
it("uses exact enabled CLI declarations and keeps mutations, aliases and core collisions out of MCP read", async () => {
  const registration = defineCli({
    name: "git",
    summary: "Git",
    commands: {
      status: cliCommand({
        summary: "Status",
        experimental_readOnly: true,
        run: () => ({ exitCode: 0, stdout: "" }),
      }),
      "viewed list": cliCommand({
        summary: "Viewed",
        experimental_readOnly: true,
        aliases: ["marks"],
        run: () => ({ exitCode: 0, stdout: "" }),
      }),
      "viewed mark": cliCommand({
        summary: "Mark",
        run: () => ({ exitCode: 0, stdout: "" }),
      }),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        cliCommands: [
          { pluginId: "git", name: "git", commands: registration.commands },
          {
            pluginId: "shadow",
            name: "thread",
            commands: registration.commands,
          },
        ],
      }),
    ),
  );
  const core = new Set(["thread list", "thread delete", "plugin run"]);
  const paths = await loadPluginReadPaths(
    "http://127.0.0.1:1234",
    core,
    new AbortController().signal,
  );
  const allowed = (argv: string[]) =>
    evaluateCliAccess(argv, "read", core, paths).allowed;
  expect(allowed(["git", "status", "--json"])).toBe(true);
  expect(allowed(["git", "--help"])).toBe(true);
  expect(allowed(["git", "viewed", "list", "--environment", "env-1"])).toBe(
    true,
  );
  expect(allowed(["plugin", "run", "git", "viewed", "list"])).toBe(true);
  expect(allowed(["git", "viewed", "mark", "--path", "file.ts"])).toBe(false);
  expect(allowed(["git", "marks"])).toBe(false);
  expect(allowed(["git", "status-extra"])).toBe(false);
  expect(allowed(["thread", "status"])).toBe(false);
  expect(allowed(["plugin", "run", "shadow", "status"])).toBe(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ cliCommands: [] })),
  );
  const disabled = await loadPluginReadPaths(
    "http://127.0.0.1:1234",
    core,
    new AbortController().signal,
  );
  expect(
    evaluateCliAccess(["git", "status"], "read", core, disabled).allowed,
  ).toBe(false);
});
