import { describe, expect, it, vi } from "vitest";
import { parseChangelog } from "@bb/domain/changelog";
import { ApiError } from "../../../src/errors.js";
import { getReleaseNotes } from "../../../src/services/system/release-notes.js";

const ENTRIES = parseChangelog(`# Changelog

## 0.45.0

Windows, tiers, and speed.

### Highlights

- Native Windows support.

![Windows desktop](https://getbb.app/changelog/0.45.0/windows.jpg)

## 0.44.0

Diff filtering.

### Highlights

- Filter the diff panel.

### Fixes

- Fix a crash.

## 0.43.3

Saved drafts.

## 0.43.0

Custom environments.
`);

const PUBLISHED = parseChangelog(`# Changelog

## 0.46.0

Forty-six.
`);

function request(
  overrides: Partial<Parameters<typeof getReleaseNotes>[0]> = {},
) {
  return getReleaseNotes({
    installedVersion: "0.44.0",
    version: undefined,
    since: undefined,
    entries: ENTRIES,
    fetchPublished: vi.fn(async () => PUBLISHED),
    ...overrides,
  });
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("getReleaseNotes", () => {
  it("returns the installed release with its published headline and date", async () => {
    const result = await request();

    expect(result.installedVersion).toBe("0.44.0");
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]).toMatchObject({
      version: "0.44.0",
      date: "September 25, 2026",
      headline: "Diff filtering, safer archiving, and plugin safe mode",
      visual: "diff-filter",
      hero: null,
      lede: [{ kind: "paragraph", text: "Diff filtering." }],
    });
    expect(
      result.releases[0]?.sections.map((section) => section.title),
    ).toEqual(["Highlights", "Fixes"]);
  });

  it("moves a release's changelog image out of its notes and into hero", async () => {
    const result = await request({ version: "0.45.0" });

    expect(result.releases[0]?.hero).toEqual({
      src: "https://getbb.app/changelog/0.45.0/windows.jpg",
      darkSrc: null,
      alt: "Windows desktop",
    });
    expect(result.releases[0]?.sections).toEqual([
      {
        title: "Highlights",
        blocks: [{ kind: "list", items: ["Native Windows support."] }],
      },
    ]);
  });

  it("falls back to the newest bundled release for a prerelease or dev build", async () => {
    const result = await request({ installedVersion: "0.0.0-dev" });

    expect(result.releases.map((release) => release.version)).toEqual([
      "0.45.0",
    ]);
  });

  it("returns one specific release", async () => {
    const result = await request({ version: "0.43.3" });

    expect(result.releases.map((release) => release.version)).toEqual([
      "0.43.3",
    ]);
  });

  it("lists releases after since up to the installed one, newest first", async () => {
    const result = await request({ since: "0.43.0" });

    expect(result.releases.map((release) => release.version)).toEqual([
      "0.44.0",
      "0.43.3",
    ]);
  });

  it("rejects an unknown older version", async () => {
    const fetchPublished = vi.fn(async () => PUBLISHED);
    const error = await rejection(
      request({ version: "0.40.1", fetchPublished }),
    );

    expect(error.status).toBe(404);
    expect(error.body.code).toBe("release_not_found");
    expect(error.body.message).toBe("No release notes for bb 0.40.1");
    expect(fetchPublished).not.toHaveBeenCalled();
  });

  it("reads a newer release from the published changelog", async () => {
    const result = await request({ version: "0.46.0" });

    expect(result.releases[0]).toMatchObject({
      version: "0.46.0",
      headline: null,
      date: null,
      visual: null,
      hero: null,
    });
  });

  it("reports unavailable notes when the published changelog cannot be loaded", async () => {
    const error = await rejection(
      request({
        version: "0.46.0",
        fetchPublished: vi.fn(async () => {
          throw new Error("fetch failed");
        }),
      }),
    );

    expect(error.status).toBe(503);
    expect(error.body.code).toBe("release_notes_unavailable");
    expect(error.body.message).toContain("fetch failed");
  });

  it("rejects a value that is not a version", async () => {
    const error = await rejection(request({ since: "yesterday" }));

    expect(error.status).toBe(400);
    expect(error.body.code).toBe("invalid_request");
  });
});
