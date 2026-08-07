import { describe, expect, it } from "vitest";
import {
  buildFilePreviewUrl,
  parseTriageBoardFiles,
} from "./dashboard-triage-boards";

describe("parseTriageBoardFiles", () => {
  it("keeps exact triage board outputs and sorts newest first", () => {
    expect(
      parseTriageBoardFiles([
        {
          name: "triage-board-2026-08-06.html",
          path: "triage-board-2026-08-06.html",
        },
        { name: "triage-board-notes.md", path: "triage-board-notes.md" },
        {
          name: "triage-board-2026-08-07.html",
          path: "archive/triage-board-2026-08-07.html",
        },
      ]),
    ).toEqual([
      {
        date: "2026-08-07",
        name: "triage-board-2026-08-07.html",
        path: "archive/triage-board-2026-08-07.html",
      },
      {
        date: "2026-08-06",
        name: "triage-board-2026-08-06.html",
        path: "triage-board-2026-08-06.html",
      },
    ]);
  });
});

describe("buildFilePreviewUrl", () => {
  it("encodes every relative path segment beneath the preview lease", () => {
    expect(
      buildFilePreviewUrl({
        baseUrl: "/api/v1/file-previews/lease-id",
        filePath: "saved boards/triage-board-2026-08-07.html",
        origin: "https://bb.example.test",
      }),
    ).toBe(
      "https://bb.example.test/api/v1/file-previews/lease-id/saved%20boards/triage-board-2026-08-07.html",
    );
  });
});
