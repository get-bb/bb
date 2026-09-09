import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import { registerBrowserCommands } from "../../commands/browser.js";

const flags = [
  "--host",
  "host",
  "--instance",
  "instance",
  "--generation",
  "generation",
  "--thread",
  "thread",
];
describe("browser credential output", () => {
  setupCommandOutputTestEnvironment();
  it("writes a new private file without printing the connection credential", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-browser-cli-"));
    const output = join(dir, "connection.json");
    const connection = {
      hostId: "host",
      wsEndpoint: "ws://127.0.0.1:1234/private-token",
      expiresAt: Date.now() + 10000,
    };
    stubServerApi({
      "v1.desktop-browsers.connection.$post": vi.fn(async () => connection),
    });
    try {
      await runCommand(
        [
          "browser",
          "connection",
          "lease",
          ...flags,
          "--output",
          output,
          "--json",
        ],
        (program) => registerBrowserCommands(program, () => "http://server"),
      );
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(connection);
      expect((await stat(output)).mode & 0o777).toBe(0o600);
      expect(
        JSON.stringify(collectLogPayloads(vi.mocked(console.log))),
      ).not.toContain("private-token");
      await expect(
        runCommand(
          ["browser", "connection", "lease", ...flags, "--output", output],
          (program) => registerBrowserCommands(program, () => "http://server"),
        ),
      ).rejects.toThrow();
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(connection);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("browser cookie import output", () => {
  setupCommandOutputTestEnvironment();
  const instanceFlags = [
    "--host",
    "host",
    "--instance",
    "instance",
    "--generation",
    "generation",
  ];
  it("prints importable sources with readiness and cookie counts", async () => {
    stubServerApi({
      "v1.desktop-browsers.import-sources.$post": vi.fn(async () => ({
        sources: [
          {
            id: "chrome",
            name: "Google Chrome",
            profiles: [
              { directory: "Default", name: "Person 1", cookieCount: 4 },
            ],
          },
          {
            id: "safari",
            name: "Safari",
            profiles: [],
            unavailable: "needsFullDiskAccess",
          },
        ],
      })),
    });
    await runCommand(
      ["browser", "import-sources", ...instanceFlags],
      (program) => registerBrowserCommands(program, () => "http://server"),
    );
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "chrome  ready  Person 1 (4)\nsafari  needsFullDiskAccess",
    ]);
  });
  it("sends the import request and reports skipped hosts or the failure reason", async () => {
    const importCookies = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        imported: 3,
        skipped: 1,
        skippedDomains: ["a.test"],
      })
      .mockResolvedValueOnce({ ok: false, reason: "browserRunning" });
    stubServerApi({
      "v1.desktop-browsers.import-cookies.$post": importCookies,
    });
    await runCommand(
      [
        "browser",
        "import-cookies",
        ...instanceFlags,
        "--from",
        "chrome",
        "--profile",
        "Default",
        "--into",
        "automation:agent-1",
      ],
      (program) => registerBrowserCommands(program, () => "http://server"),
    );
    expect(importCookies).toHaveBeenCalledWith({
      json: {
        hostId: "host",
        instanceId: "instance",
        generation: "generation",
        sourceId: "chrome",
        sourceProfileDirectory: "Default",
        profile: { kind: "automation", id: "agent-1" },
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Imported 3 cookies, skipped 1 (a.test)",
    ]);
    vi.mocked(console.log).mockClear();
    await runCommand(
      [
        "browser",
        "import-cookies",
        ...instanceFlags,
        "--from",
        "chrome",
        "--profile",
        "Default",
      ],
      (program) => registerBrowserCommands(program, () => "http://server"),
    );
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Import failed: Quit the browser first so its cookie database can be read.",
    ]);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
