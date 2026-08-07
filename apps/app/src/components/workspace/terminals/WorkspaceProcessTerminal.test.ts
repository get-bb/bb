import { describe, expect, it } from "vitest";
import {
  findLatestLoopbackPreviewUrl,
  formatLoopbackPreviewLabel,
  getWorkspaceProcessAction,
} from "./WorkspaceProcessTerminal";

describe("findLatestLoopbackPreviewUrl", () => {
  it("returns the latest ANSI-wrapped loopback URL", () => {
    expect(
      findLatestLoopbackPreviewUrl(
        "Local: http://localhost:3000\n\u001b[32mhttp://127.0.0.1:4173/app\u001b[0m",
      ),
    ).toBe("http://127.0.0.1:4173/app");
  });

  it("rejects public and non-HTTP URLs", () => {
    expect(
      findLatestLoopbackPreviewUrl("https://example.com ftp://localhost:21"),
    ).toBeNull();
  });

  it("accepts the complete IPv4 loopback range", () => {
    expect(findLatestLoopbackPreviewUrl("http://127.0.0.2:4173")).toBe(
      "http://127.0.0.2:4173/",
    );
  });
});

describe("workspace process actions", () => {
  it("shows Start only when the current terminal can start", () => {
    expect(
      getWorkspaceProcessAction({
        canCreateTerminal: true,
        isCreateTerminalPending: false,
        previewUrl: null,
        purpose: "setup",
        sessionStatus: null,
      }),
    ).toEqual({ kind: "start" });

    expect(
      getWorkspaceProcessAction({
        canCreateTerminal: false,
        isCreateTerminalPending: false,
        previewUrl: null,
        purpose: "setup",
        sessionStatus: null,
      }),
    ).toEqual({ kind: "none" });
  });

  it("replaces the Run action with the detected port and never returns Stop", () => {
    const previewUrl = "http://localhost:4173/app";
    expect(formatLoopbackPreviewLabel(previewUrl)).toBe("Open :4173");
    expect(
      getWorkspaceProcessAction({
        canCreateTerminal: true,
        isCreateTerminalPending: false,
        previewUrl,
        purpose: "run",
        sessionStatus: "running",
      }),
    ).toEqual({ kind: "open", label: "Open :4173", url: previewUrl });
    expect(
      getWorkspaceProcessAction({
        canCreateTerminal: true,
        isCreateTerminalPending: false,
        previewUrl: null,
        purpose: "run",
        sessionStatus: "running",
      }),
    ).toEqual({ kind: "none" });
  });
});
