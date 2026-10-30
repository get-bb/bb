import { describe, expect, it, vi } from "vitest";
import {
  collectLogPayloads,
  getHelpOutput,
  runCommand,
  setupCommandOutputTestEnvironment,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerPluginCommands } from "../../commands/plugin.js";

const version = (value: string) => ({
  version: value,
  label: value,
  display: value,
});

const pluginList = (id: string, source: string) => ({
  plugins: [
    {
      id,
      source,
      rootDir: `/plugins/${id}`,
      version: "1.0.0",
      provenance: "direct",
      publisherLabel: null,
      isOrphanedBuiltin: false,
      sourceDisplay: `npm · ${id} · tracks compatible`,
      updateState: {},
      enabled: true,
      description: null,
      name: null,
      icon: null,
      iconUrl: null,
      status: "running",
      statusDetail: null,
      handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
      services: [],
      schedules: [],
      cliCommand: null,
      hasSettings: false,
      app: { hasApp: false, bundle: null },
      logoUrl: null,
      logoDarkUrl: null,
    },
  ],
});

describe("bb plugin update commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerPluginCommands(program, () => "http://server");

  it("outdated renders every outcome, reasons, and the dev-build annotation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        results: [
          { id: "a", outcome: "current", installed: version("1.0.0") },
          {
            id: "b",
            outcome: "update-available",
            installed: version("1.0.0"),
            candidate: version("1.1.0"),
          },
          {
            id: "c",
            outcome: "pinned",
            installed: version("2.0.0"),
            candidate: version("3.0.0"),
          },
          {
            id: "d",
            outcome: "incompatible",
            devMode: true,
            installed: version("1.0.0"),
            blocked: {
              version: "2.0.0",
              label: "2.0.0",
              reasons: ["requires bb >= 9"],
            },
          },
          {
            id: "e",
            outcome: "unavailable",
            installed: version("1.0.0"),
            detail: "registry offline",
          },
          {
            id: "f",
            outcome: "update-available",
            installed: version("1.4.0"),
            candidate: version("2.0.0"),
            candidateBreaking: true,
          },
          {
            id: "g",
            outcome: "current",
            installed: version("0.1.0"),
            outsideRange: {
              version: "0.2.0",
              display: "g@0.2.0",
              breaking: true,
              range: "^0.1.0",
              suggestedRange: ">=0.1.0 <1.0.0",
            },
          },
          {
            id: "h",
            outcome: "current",
            installed: version("2.0.0"),
            detail:
              'npm dist-tag "next" points to 1.0.0, older than the installed 2.0.0; bb does not downgrade',
          },
        ],
      }),
    );

    await runCommand(["plugin", "outdated"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    const row = (id: string) =>
      output.split("\n").find((line) => line.startsWith(`${id} `)) ?? "";
    expect(output).toContain("update available");
    expect(output).toContain("pinned");
    expect(output).toContain("2.0.0: requires bb >= 9");
    expect(output).toContain(
      "incompatible [dev build: engines.bb not enforced]",
    );
    expect(output).toContain("unavailable");
    expect(output).toContain("Outside range");
    expect(row("b")).not.toContain("may break");
    expect(row("f")).toContain("update available (may break)");
    expect(row("g")).toMatch(/0\.2\.0 \(may break\)\s+current$/u);
    expect(output).toContain(
      "Outside range: the newest release the installed range excludes; compatibility not checked.",
    );
    expect(output.split("\n")).toEqual(
      expect.arrayContaining([
        "e: registry offline",
        'h: npm dist-tag "next" points to 1.0.0, older than the installed 2.0.0; bb does not downgrade',
        'g: 0.2.0 (may break) is outside ^0.1.0. To follow it: bb plugin track g ">=0.1.0 <1.0.0"',
      ]),
    );
    expect(output).not.toMatch(/^[abcdf]: /mu);
  });

  it("outdated --json prints the parsed results", async () => {
    const results = [
      {
        id: "notes",
        outcome: "current",
        installed: version("1.0.0"),
        outsideRange: {
          version: "2.0.0",
          display: "notes@2.0.0",
          breaking: true,
          range: "^1.0.0",
          suggestedRange: ">=1.0.0 <3.0.0",
        },
      },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ results }));

    await runCommand(["plugin", "outdated", "--json"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(results, null, 2),
    ]);
  });

  it("source renders resolved source and activation history", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        requested: "npm:notes@^1",
        resolved: "1.2.0",
        integrity: "sha512-test",
        registry: "https://registry.npmjs.org",
        engines: { bb: ">=0.9", bbPluginSdk: "^0.2.0" },
        installedAt: 1_752_300_000_000,
        history: [
          { version: "1.2.0", activatedAt: 1_752_300_000_000 },
          { version: "1.1.0", activatedAt: 1_752_200_000_000 },
        ],
      }),
    );

    await runCommand(["plugin", "source", "notes"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("requested: npm:notes@^1");
    expect(output).toContain("resolved: 1.2.0");
    expect(output).toContain("engines.bbPluginSdk: ^0.2.0");
    expect(output).toContain("1.1.0");
  });

  it("source names the dist-tag an npm install follows", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        requested: "npm:notes@beta",
        resolved: "notes@1.3.0-beta.2",
        npmSpecKind: "tag",
        distTag: "beta",
        engines: {},
        history: [],
      }),
    );

    await runCommand(["plugin", "source", "notes"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "notes",
      "  requested: npm:notes@beta",
      "  resolved: notes@1.3.0-beta.2",
      "  dist-tag: beta",
      "  history: none",
    ]);
  });

  it("source --json prints the shared source contract", async () => {
    const source = {
      requested: "path:/plugins/notes",
      resolved: "path:/plugins/notes",
      engines: {},
      installedAt: 1_752_300_000_000,
      history: [{ version: "1.0.0", activatedAt: 1_752_300_000_000 }],
    };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(source));

    await runCommand(["plugin", "source", "notes", "--json"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(source, null, 2),
    ]);
  });

  it("reload rejects an unknown id instead of reporting the full inventory", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        ok: true,
        plugins: pluginList("other", "path:/other").plugins,
      }),
    );

    await expect(
      runCommand(["plugin", "reload", "missing", "--json"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify({ ok: false, error: 'unknown plugin "missing"' }, null, 2),
    ]);
  });

  it("reload prints only the requested plugin in human output", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        ok: true,
        plugins: [
          ...pluginList("notes", "path:/notes").plugins,
          ...pluginList("other", "path:/other").plugins,
        ],
      }),
    );

    await runCommand(["plugin", "reload", "notes"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("notes@1.0.0");
    expect(output).not.toContain("other@1.0.0");
  });

  it("list annotates only CLI commands shadowed by core", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        plugins: [
          {
            ...pluginList("shadower", "path:/shadower").plugins[0],
            cliCommand: { name: "thread", summary: "Shadow threads" },
          },
          {
            ...pluginList("notes", "path:/notes").plugins[0],
            cliCommand: { name: "notes", summary: "Take notes" },
          },
        ],
      }),
    );

    await runCommand(["plugin", "list"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain(
      'command: bb plugin run shadower — Shadow threads (core command "bb thread" takes precedence)',
    );
    expect(output).toContain("command: bb notes — Take notes");
    expect(output).not.toContain('core command "bb notes"');
  });

  it("skips pinned plugins with manual reinstall guidance", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              id: "notes",
              outcome: "pinned",
              installed: version("1.0.0"),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json(pluginList("notes", "git:https://example.com/notes@v1")),
      );

    await runCommand(["plugin", "update", "notes"], register);

    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "remove and reinstall with a tracking npm range, git branch, or git semver range",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("starts an update without waiting and lets the user inspect its job", async () => {
    const job = {
      id: "update-1",
      pluginId: "notes",
      displayName: "Notes",
      state: "running",
      phase: "checking",
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              id: "notes",
              outcome: "update-available",
              installed: version("1.0.0"),
              candidate: version("1.1.0"),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json(pluginList("notes", "npm:notes@^1")))
      .mockResolvedValueOnce(Response.json({ job }, { status: 202 }));
    await runCommand(
      ["plugin", "update", "notes", "--yes", "--no-wait"],
      register,
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body)),
    ).toEqual({ expectedVersion: "1.1.0" });
    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "bb plugin update-jobs update-1",
    );
    vi.mocked(console.log).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ job }));
    await runCommand(["plugin", "update-jobs", "update-1", "--json"], register);
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify({ jobs: [job] }, null, 2),
    ]);
  });

  it("--all updates compatible results and skips pinned and incompatible", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          results: [
            { id: "pin", outcome: "pinned", installed: version("1") },
            {
              id: "bad",
              outcome: "incompatible",
              installed: version("1"),
              blocked: {
                version: "2",
                label: "2",
                reasons: ["requires newer bb"],
              },
            },
            {
              id: "good",
              outcome: "update-available",
              installed: version("1"),
              candidate: version("2"),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json(pluginList("good", "npm:good@^1")))
      .mockResolvedValueOnce(
        Response.json({
          applied: true,
          from: version("1"),
          to: version("2"),
          outcome: "updated",
        }),
      );

    await runCommand(["plugin", "update", "--all", "--yes"], register);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("pin: skipped — pinned");
    expect(output).toContain("bad: skipped — incompatible: requires newer bb");
    expect(output).toContain("good: updated and activated 1 → 2");
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      expectedVersion: "2",
    });
  });

  it("explains a current plugin whose newest release is outside its range", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        results: [
          {
            id: "agent-board",
            outcome: "current",
            installed: version("0.6.1"),
            outsideRange: {
              version: "0.7.0",
              display: "agent-board@0.7.0",
              breaking: true,
              range: "^0.6.1",
              suggestedRange: ">=0.6.1 <1.0.0",
            },
          },
        ],
      }),
    );

    await runCommand(["plugin", "update", "agent-board"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      'agent-board: current within ^0.6.1; 0.7.0 (may break) is outside the range (compatibility not checked). To follow it: bb plugin track agent-board ">=0.6.1 <1.0.0"',
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      command: "outdated",
      args: ["plugin", "outdated"],
      line: "notes: 2.0.0 (may break) is outside ^1.0.0.",
    },
    {
      command: "update",
      args: ["plugin", "update", "notes"],
      line: "notes: current within ^1.0.0; 2.0.0 (may break) is outside the range (compatibility not checked).",
    },
  ])(
    "$command names a release outside the range without a track command when the server suggests no range",
    async ({ args, line }) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        Response.json({
          results: [
            {
              id: "notes",
              outcome: "current",
              installed: version("1.0.0"),
              outsideRange: {
                version: "2.0.0",
                display: "notes@2.0.0",
                breaking: true,
                range: "^1.0.0",
              },
            },
          ],
        }),
      );

      await runCommand(args, register);

      expect(collectLogPayloads(vi.mocked(console.log))).toContain(line);
    },
  );

  it("warns about a breaking candidate before asking to apply it", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              id: "notes",
              outcome: "update-available",
              installed: version("1.4.0"),
              candidate: version("2.0.0"),
              candidateBreaking: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json(pluginList("notes", "npm:notes")));

    await expect(
      runCommand(["plugin", "update", "notes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "notes: 2.0.0 may include breaking changes",
    );
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      "Refusing to update without confirmation — re-run with --yes.",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("names a breaking release outside the range alongside the in-range update", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              id: "notes",
              outcome: "update-available",
              installed: version("0.1.0"),
              candidate: version("0.1.1"),
              outsideRange: {
                version: "0.2.0",
                display: "notes@0.2.0",
                breaking: true,
                range: "^0.1.0",
                suggestedRange: ">=0.1.0 <1.0.0",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json(pluginList("notes", "npm:notes")));

    await expect(
      runCommand(["plugin", "update", "notes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.log))).toContain(
      'notes: 0.2.0 (may break) is outside the range ^0.1.0 and is not part of this update (compatibility not checked). To follow it: bb plugin track notes ">=0.1.0 <1.0.0"',
    );
  });

  it.each([[[]], [["--no-wait"]]])(
    "tells the user to upgrade a bb server that cannot bind the update to the reviewed release (%j)",
    async (flags) => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          Response.json({
            results: [
              {
                id: "notes",
                outcome: "update-available",
                installed: version("1.0.0"),
                candidate: version("1.1.0"),
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          Response.json(pluginList("notes", "npm:notes@^1")),
        )
        .mockResolvedValueOnce(
          Response.json(
            { error: "expected an empty JSON object" },
            { status: 400 },
          ),
        );

      await expect(
        runCommand(["plugin", "update", "notes", "--yes", ...flags], register),
      ).rejects.toThrow("process.exit:1");

      expect(vi.mocked(console.error)).toHaveBeenCalledWith(
        "notes: not updated — the bb server is older than this bb CLI and cannot guarantee that it installs 1.1.0, the release this check showed. Upgrade bb on the server, then run `bb plugin update notes` again.",
      );
    },
  );

  it("renders a rolled-back server result", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              id: "notes",
              outcome: "update-available",
              installed: version("1"),
              candidate: version("2"),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json(pluginList("notes", "npm:notes@^1")))
      .mockResolvedValueOnce(
        Response.json({
          applied: false,
          from: version("1"),
          to: version("2"),
          outcome: "rolled-back",
          detail: "activation failed; restored 1",
        }),
      );

    await runCommand(["plugin", "update", "notes", "--yes"], register);

    expect(collectLogPayloads(vi.mocked(console.log)).join("\n")).toContain(
      "notes: rolled-back — activation failed; restored 1",
    );
  });

  it("renders a 422 message and refuses non-TTY updates without --yes", async () => {
    const update = {
      results: [
        {
          id: "notes",
          outcome: "update-available",
          installed: version("1"),
          candidate: version("2"),
        },
      ],
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(update))
      .mockResolvedValueOnce(Response.json(pluginList("notes", "npm:notes@^1")))
      .mockResolvedValueOnce(
        Response.json(
          { error: "signature verification failed" },
          { status: 422 },
        ),
      );
    await expect(
      runCommand(["plugin", "update", "notes", "--yes"], register),
    ).rejects.toThrow("process.exit:1");
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      "signature verification failed",
    );

    vi.clearAllMocks();
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(update))
      .mockResolvedValueOnce(
        Response.json(pluginList("notes", "npm:notes@^1")),
      );
    await expect(
      runCommand(["plugin", "update", "notes"], register),
    ).rejects.toThrow("process.exit:1");
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      "Refusing to update without confirmation — re-run with --yes.",
    );
  });

  it("does not offer the removed update flags in help", async () => {
    const updateHelp = await getHelpOutput(["plugin", "update"], register);
    expect(updateHelp).not.toContain("--dry-run");
    expect(updateHelp).not.toContain("--latest");
  });
});
