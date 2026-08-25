import { afterEach, beforeEach, expect, it } from "vitest";
import { type FakePiBridgeHarness, startFakePiBridge } from "./test-support.js";

/**
 * Sessionless command discovery: `command/list` asks the cwd's catalog child
 * for pi's `get_commands` and lists the extension commands and prompt
 * templates with their origin; skills are the daemon's static scan, not
 * the bridge's to repeat. Another provider id is not this bridge's.
 */

let harness: FakePiBridgeHarness;
let nextId = 4000;

beforeEach(async () => {
  harness = await startFakePiBridge({ prefix: "bb-pi-command-list-", initialize: true });
}, 90_000);

afterEach(async () => {
  await harness.teardown();
}, 90_000);

it("lists pi's extension commands and prompt templates by origin, without skills", async () => {
  const response = await harness.request((nextId += 1), "command/list", {
    providerId: "pi",
    cwd: harness.workspaceDir,
  });
  expect(response.result).toEqual({
    supported: true,
    diagnostics: [],
    commands: [
      {
        name: "project-smoke",
        source: "command",
        origin: "project",
        description: "Project smoke command",
        argumentHint: null,
      },
      {
        name: "global-smoke",
        source: "command",
        origin: "user",
        description: "Global smoke command",
        argumentHint: null,
      },
      {
        name: "ext",
        source: "command",
        origin: "user",
        description: "Fake extension command: runs one ctx.ui call, or nothing",
        argumentHint: null,
      },
      { name: "review", source: "command", origin: "user", description: "Review the diff", argumentHint: null },
    ],
  });
}, 90_000);

it("answers unsupported for a provider this bridge does not serve", async () => {
  const response = await harness.request((nextId += 1), "command/list", {
    providerId: "acp-other",
    cwd: harness.workspaceDir,
  });
  expect(response.result).toEqual({ supported: false });
}, 90_000);
