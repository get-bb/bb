import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectLogPayloads,
  getHelpOutput,
  readlineMocks,
  runCommand,
  setupCommandOutputTestEnvironment,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerPluginCommands } from "../../commands/plugin.js";

const installed = {
  version: "a".repeat(40),
  label: "0.1.0",
  display: "repo@v0.1.0 (aaaaaaaaaaaa)",
};
const candidate = {
  version: "b".repeat(40),
  label: "0.2.0",
  display: "repo@v0.2.0 (bbbbbbbbbbbb)",
};

function trackingResult(
  applied: boolean,
  range = ">=0.1.0 <1.0.0",
  openEnded = false,
) {
  return {
    applied,
    previousRange: "^0.1.0",
    range,
    openEnded,
    check: {
      id: "notes",
      outcome: "update-available",
      installed,
      candidate,
    },
  };
}

function requests(): { path: string; body: unknown }[] {
  return vi.mocked(fetch).mock.calls.map(([input, init]) => ({
    path: new URL(String(input)).pathname,
    body: JSON.parse(String(init?.body)),
  }));
}

describe("bb plugin track", () => {
  setupCommandOutputTestEnvironment();

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const register: CommandRegistrar = (program) =>
    registerPluginCommands(program, () => "http://server");

  it("previews the range, asks, then changes it and points at bb plugin update", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(trackingResult(false)))
      .mockResolvedValueOnce(Response.json(trackingResult(true)));
    readlineMocks.question.mockResolvedValue("y");

    await runCommand(["plugin", "track", "notes", ">=0.1.0 <1.0.0"], register);

    expect(readlineMocks.question).toHaveBeenCalledWith(
      "Change the range? [y/N] ",
    );
    expect(requests()).toEqual([
      {
        path: "/api/v1/plugins/notes/tracking-range",
        body: { range: ">=0.1.0 <1.0.0", dryRun: true },
      },
      {
        path: "/api/v1/plugins/notes/tracking-range",
        body: { range: ">=0.1.0 <1.0.0" },
      },
    ]);
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "notes: track >=0.1.0 <1.0.0 instead of ^0.1.0. Settings, secrets, schedules, and data are kept; nothing is installed until you update.",
      "  With >=0.1.0 <1.0.0: update available: repo@v0.1.0 (aaaaaaaaaaaa) → repo@v0.2.0 (bbbbbbbbbbbb).",
      "notes now tracks >=0.1.0 <1.0.0 (was ^0.1.0).",
      "  update available: repo@v0.1.0 (aaaaaaaaaaaa) → repo@v0.2.0 (bbbbbbbbbbbb); apply it with `bb plugin update notes`.",
    ]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns before asking when the range has no upper bound", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json(trackingResult(false, ">=0.1.0", true)),
      )
      .mockResolvedValueOnce(
        Response.json(trackingResult(true, ">=0.1.0", true)),
      );
    readlineMocks.question.mockResolvedValue("y");

    await runCommand(["plugin", "track", "notes", ">=0.1.0"], register);

    expect(vi.mocked(console.warn).mock.calls).toEqual([
      [
        "Warning: >=0.1.0 has no upper bound, so every future major release will be offered as an update.",
      ],
    ]);
    expect(vi.mocked(console.warn).mock.invocationCallOrder[0]).toBeLessThan(
      readlineMocks.question.mock.invocationCallOrder[0] ?? 0,
    );
    expect(requests()).toHaveLength(2);
  });

  it("warns in a dry run of a range without an upper bound, but not in its JSON", async () => {
    const preview = trackingResult(false, ">=0.1.0", true);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(preview));

    await runCommand(
      ["plugin", "track", "notes", ">=0.1.0", "--dry-run"],
      register,
    );

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "notes would track >=0.1.0 instead of ^0.1.0; nothing changed (dry run).",
      "  update available: repo@v0.1.0 (aaaaaaaaaaaa) → repo@v0.2.0 (bbbbbbbbbbbb).",
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      "Warning: >=0.1.0 has no upper bound, so every future major release will be offered as an update.",
    );

    vi.mocked(console.warn).mockClear();
    vi.mocked(console.log).mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(preview));

    await runCommand(
      ["plugin", "track", "notes", ">=0.1.0", "--dry-run", "--json"],
      register,
    );

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(preview, null, 2),
    ]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("--dry-run reports what the range offers without asking or changing it", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(trackingResult(false)),
    );

    await runCommand(
      ["plugin", "track", "notes", ">=0.1.0 <1.0.0", "--dry-run"],
      register,
    );

    expect(readlineMocks.question).not.toHaveBeenCalled();
    expect(requests()).toHaveLength(1);
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "notes would track >=0.1.0 <1.0.0 instead of ^0.1.0; nothing changed (dry run).",
      "  update available: repo@v0.1.0 (aaaaaaaaaaaa) → repo@v0.2.0 (bbbbbbbbbbbb).",
    ]);
  });

  it("marks a candidate that may break and a release the range still excludes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        ...trackingResult(false, "^0.2.0"),
        check: {
          id: "notes",
          outcome: "update-available",
          installed,
          candidate,
          candidateBreaking: true,
          outsideRange: {
            version: "1.0.0",
            display: "repo@v1.0.0 (cccccccccccc)",
            breaking: true,
            range: "^0.2.0",
            suggestedRange: ">=0.1.0 <2.0.0",
          },
        },
      }),
    );

    await runCommand(
      ["plugin", "track", "notes", "^0.2.0", "--dry-run"],
      register,
    );

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "notes would track ^0.2.0 instead of ^0.1.0; nothing changed (dry run).",
      "  update available (may break): repo@v0.1.0 (aaaaaaaaaaaa) → repo@v0.2.0 (bbbbbbbbbbbb); 1.0.0 stays outside the range (compatibility not checked).",
    ]);
  });

  it("--dry-run --json prints the preview result", async () => {
    const preview = trackingResult(false);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(preview));

    await runCommand(
      ["plugin", "track", "notes", ">=0.1.0 <1.0.0", "--dry-run", "--json"],
      register,
    );

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(preview, null, 2),
    ]);
  });

  it("reports the current range as a no-op without asking or warning", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        applied: false,
        previousRange: ">=0.1.0",
        range: ">=0.1.0",
        openEnded: true,
        check: { id: "notes", outcome: "current", installed },
      }),
    );

    await runCommand(["plugin", "track", "notes", ">=0.1.0"], register);

    expect(readlineMocks.question).not.toHaveBeenCalled();
    expect(requests()).toHaveLength(1);
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "notes already tracks >=0.1.0; nothing changed.",
      "  current: repo@v0.1.0 (aaaaaaaaaaaa) is the newest compatible release in range.",
    ]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("names the latest release an npm install followed before its first range", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          applied: false,
          previousRange: null,
          range: "^1.0.0",
          openEnded: false,
          check: {
            id: "linear",
            outcome: "unavailable",
            installed: {
              version: "1.0.0",
              label: "1.0.0",
              display: "linear@1.0.0",
            },
            detail: "registry offline",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          applied: true,
          previousRange: null,
          range: "^1.0.0",
          openEnded: false,
          check: {
            id: "linear",
            outcome: "unavailable",
            installed: {
              version: "1.0.0",
              label: "1.0.0",
              display: "linear@1.0.0",
            },
            detail: "registry offline",
          },
        }),
      );

    await runCommand(
      ["plugin", "track", "linear", "^1.0.0", "--yes"],
      register,
    );

    expect(readlineMocks.question).not.toHaveBeenCalled();
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "linear: track ^1.0.0 instead of its latest release. Settings, secrets, schedules, and data are kept; nothing is installed until you update.",
      "  With ^1.0.0: unavailable: registry offline",
      "linear now tracks ^1.0.0 (was its latest release).",
      "  unavailable: registry offline",
    ]);
  });

  it("prints the server's refusal and changes nothing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        {
          error:
            '"0.2.0" names a single version, not a range; use a range like ^0.2.0',
        },
        { status: 422 },
      ),
    );

    await expect(
      runCommand(["plugin", "track", "notes", "0.2.0", "--yes"], register),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      '"0.2.0" names a single version, not a range; use a range like ^0.2.0',
    );
    expect(requests()).toHaveLength(1);
  });

  it("refuses without --yes when it cannot ask, and stops when the answer is no", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(trackingResult(false)),
    );

    await expect(
      runCommand(["plugin", "track", "notes", ">=0.1.0 <1.0.0"], register),
    ).rejects.toThrow("process.exit:1");
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      "Refusing to change the range without confirmation — re-run with --yes.",
    );
    expect(requests()).toHaveLength(1);

    vi.mocked(fetch).mockClear();
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(trackingResult(false)),
    );
    readlineMocks.question.mockResolvedValue("n");

    await expect(
      runCommand(["plugin", "track", "notes", ">=0.1.0 <1.0.0"], register),
    ).rejects.toThrow("process.exit:1");
    expect(collectLogPayloads(vi.mocked(console.log))).toContain("Aborted.");
    expect(requests()).toHaveLength(1);
  });

  it("--yes --json prints only the applied result", async () => {
    const applied = trackingResult(true);
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(trackingResult(false)))
      .mockResolvedValueOnce(Response.json(applied));

    await runCommand(
      ["plugin", "track", "notes", ">=0.1.0 <1.0.0", "--yes", "--json"],
      register,
    );

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(applied, null, 2),
    ]);
  });

  const legacyRefusal =
    'plugin "linear" was installed by an earlier bb into a directory named after its pinned npm version, so bb cannot change its range in place; to track releases, remove it and install `npm:bb-plugin-linear@<range>` (removing deletes its settings, secrets, and schedules)';

  it.each([
    [
      "a managed pinned npm install at bb plugin track",
      undefined,
      "linear: skipped — pinned; run `bb plugin track linear <range>` (for example ^1.2.3) to receive updates; settings, secrets, and schedules are kept.",
    ],
    [
      "a pinned npm install track cannot change at the server's guidance",
      legacyRefusal,
      `linear: skipped — pinned: ${legacyRefusal}.`,
    ],
  ])("points %s", async (_case, detail, line) => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({
          results: [
            {
              id: "linear",
              outcome: "pinned",
              installed: {
                version: "1.2.3",
                label: "1.2.3",
                display: "bb-plugin-linear@1.2.3",
              },
              ...(detail === undefined ? {} : { detail }),
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          plugins: [
            {
              id: "linear",
              source: "npm:bb-plugin-linear@1.2.3",
              rootDir: "/plugins/linear",
              version: "1.2.3",
              provenance: "direct",
              publisherLabel: null,
              isOrphanedBuiltin: false,
              sourceDisplay: "npm · bb-plugin-linear · pinned",
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
        }),
      );

    await runCommand(["plugin", "update", "linear"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([line]);
  });

  it("documents its flags in help", async () => {
    const help = await getHelpOutput(["plugin", "track"], register);
    expect(help).toContain("track [options] <id> <range>");
    expect(help).toContain("--dry-run");
    expect(help).toContain("--yes");
    expect(help).toContain("--json");
  });
});
