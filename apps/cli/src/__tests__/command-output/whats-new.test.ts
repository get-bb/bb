import { describe, expect, it, vi } from "vitest";
import type { SystemReleaseNotesResponse } from "@bb/server-contract";
import {
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerWhatsNewCommands } from "../../commands/whats-new.js";

const FORTY_FIVE = {
  version: "0.45.0",
  date: "October 2, 2026",
  headline: "Native Windows support, service tiers, and faster conversations",
  lede: [
    {
      kind: "paragraph" as const,
      text: "Thread titles without a **Codex** login.",
    },
  ],
  sections: [
    {
      title: "Highlights",
      blocks: [
        {
          kind: "list" as const,
          items: ["**Faster conversations:** smoother streaming."],
        },
      ],
    },
    {
      title: "Thanks",
      blocks: [
        {
          kind: "paragraph" as const,
          text: "[@ada](https://github.com/ada)",
        },
      ],
    },
  ],
};

const FORTY_FOUR = {
  version: "0.44.0",
  date: null,
  headline: null,
  lede: [{ kind: "paragraph" as const, text: "Diff filtering." }],
  sections: [],
};

function notes(
  releases: SystemReleaseNotesResponse["releases"],
): SystemReleaseNotesResponse {
  return { installedVersion: "0.45.0", releases };
}

describe("bb whats-new command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerWhatsNewCommands(program, () => "http://server");

  it("prints the installed release's notes as readable text", async () => {
    const releaseNotes = vi.fn(async () => notes([FORTY_FIVE]));
    stubServerApi({ "v1.system.release-notes.$get": releaseNotes });

    await runCommand(["whats-new"], register);

    expect(releaseNotes).toHaveBeenCalledWith({ query: {} });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      [
        "bb 0.45.0 · October 2, 2026",
        "Native Windows support, service tiers, and faster conversations",
        "",
        "Thread titles without a Codex login.",
        "",
        "Highlights",
        "  - Faster conversations: smoother streaming.",
        "",
        "Thanks",
        "@ada",
      ].join("\n"),
    ]);
  });

  it("prints the structured notes with --json", async () => {
    const payload = notes([FORTY_FIVE]);
    stubServerApi({
      "v1.system.release-notes.$get": vi.fn(async () => payload),
    });

    await runCommand(["whats-new", "--json"], register);

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual(payload);
  });

  it("asks for one release with --version", async () => {
    const releaseNotes = vi.fn(async () => notes([FORTY_FOUR]));
    stubServerApi({ "v1.system.release-notes.$get": releaseNotes });

    await runCommand(["whats-new", "--version", "0.44.0"], register);

    expect(releaseNotes).toHaveBeenCalledWith({ query: { version: "0.44.0" } });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "bb 0.44.0\n\nDiff filtering.",
    ]);
  });

  it("prints releases since a version in the server's newest-first order", async () => {
    const releaseNotes = vi.fn(async () => notes([FORTY_FIVE, FORTY_FOUR]));
    stubServerApi({ "v1.system.release-notes.$get": releaseNotes });

    await runCommand(["whats-new", "--since", "0.43.3"], register);

    expect(releaseNotes).toHaveBeenCalledWith({ query: { since: "0.43.3" } });
    const output = String(vi.mocked(console.log).mock.calls[0]?.[0]);
    expect(output.indexOf("bb 0.45.0")).toBeLessThan(
      output.indexOf("bb 0.44.0"),
    );
  });

  it("says when nothing is newer than --since", async () => {
    stubServerApi({
      "v1.system.release-notes.$get": vi.fn(async () => notes([])),
    });

    await runCommand(["whats-new", "--since", "0.45.0"], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      "No releases after 0.45.0 up to the installed bb 0.45.0.",
    ]);
  });

  it("reports an unknown version", async () => {
    stubServerApi({
      "v1.system.release-notes.$get": vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "release_not_found",
              message: "No release notes for bb 0.40.1",
            }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          ),
      ),
    });

    await expect(
      runCommand(["whats-new", "--version", "0.40.1"], register),
    ).rejects.toThrow("process.exit:1");
    expect(collectLogPayloads(vi.mocked(console.error)).join("\n")).toContain(
      "No release notes for bb 0.40.1",
    );
  });

  it("rejects --version with --since", async () => {
    const releaseNotes = vi.fn(async () => notes([FORTY_FIVE]));
    stubServerApi({ "v1.system.release-notes.$get": releaseNotes });

    await expect(
      runCommand(
        ["whats-new", "--version", "0.44.0", "--since", "0.43.0"],
        register,
      ),
    ).rejects.toThrow();
    expect(releaseNotes).not.toHaveBeenCalled();
  });

  it("only reads release notes and never marks a release seen", async () => {
    const releaseNotes = vi.fn(async () => notes([FORTY_FIVE]));
    const setUiPreference = vi.fn(async () => ({}));
    const acknowledgeAppUpdate = vi.fn(async () => ({}));
    stubServerApi({
      "v1.system.release-notes.$get": releaseNotes,
      "v1.preferences.ui.:key.$put": setUiPreference,
      "v1.system.app-update.acknowledge.$post": acknowledgeAppUpdate,
    });

    await runCommand(["whats-new"], register);
    await runCommand(["whats-new", "--json"], register);

    expect(releaseNotes).toHaveBeenCalledTimes(2);
    expect(setUiPreference).not.toHaveBeenCalled();
    expect(acknowledgeAppUpdate).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
