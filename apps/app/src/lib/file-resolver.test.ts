import { describe, expect, it } from "vitest";
import type { ExperimentalFileIdentity } from "@get-bb/plugin-sdk";
import {
  byteFileTabFromIdentity,
  resolveFileInteraction,
} from "./file-resolver";

function identity(
  source: ExperimentalFileIdentity["source"],
): ExperimentalFileIdentity {
  return {
    source,
    displayName: "资料 100%#final.md",
    mimeType: "text/markdown",
    sizeBytes: 42,
    location: { kind: "range", startLine: 2, endLine: 7 },
  };
}

describe("resolveFileInteraction", () => {
  it("gives equivalent internal stores preview and download actions", () => {
    const cases = [
      identity({
        store: "host",
        ownerId: "host-1",
        path: "/tmp/资料 100%#final.md",
      }),
      identity({
        store: "thread-storage",
        ownerId: "thread-1",
        path: "reports/资料 100%#final.md",
      }),
      identity({
        store: "project-attachment",
        ownerId: "project-1",
        path: "stored/资料 100%#final.md",
      }),
      identity({
        store: "tasks-attachment",
        ownerId: "task-1",
        attachmentId: "attachment % # 资料",
      }),
    ];

    for (const file of cases) {
      const resolved = resolveFileInteraction(file);
      expect(resolved.openAction).toBe("preview");
      expect(resolved.previewUrl).toContain("%25");
      expect(resolved.downloadUrl).toContain("%25");
    }
  });

  it("keeps remote URLs external and resolves workspace byte routes", () => {
    expect(
      resolveFileInteraction(
        identity({
          store: "remote",
          ownerId: "example.com",
          url: "https://example.com/report.pdf#page=2",
        }),
      ),
    ).toEqual({
      downloadUrl: null,
      openAction: "external",
      previewUrl: "https://example.com/report.pdf#page=2",
    });
    expect(
      resolveFileInteraction(
        identity({
          store: "workspace",
          ownerId: "environment-1",
          path: "src/app.ts",
        }),
      ),
    ).toEqual({
      downloadUrl:
        "/api/v1/environments/environment-1/files/download?path=src%2Fapp.ts",
      openAction: "preview",
      previewUrl:
        "/api/v1/environments/environment-1/files/preview?path=src%2Fapp.ts",
    });
  });

  it("maps thread-host files to thread routes", () => {
    expect(
      resolveFileInteraction(
        identity({
          store: "thread-host",
          ownerId: "thread-1",
          path: "/tmp/report.md",
        }),
      ),
    ).toEqual({
      downloadUrl:
        "/api/v1/threads/thread-1/host-files/download?path=%2Ftmp%2Freport.md",
      openAction: "preview",
      previewUrl:
        "/api/v1/threads/thread-1/host-files/preview?path=%2Ftmp%2Freport.md",
    });
  });

  it("uses distinct Tasks preview and download routes", () => {
    expect(
      resolveFileInteraction(
        identity({
          store: "tasks-attachment",
          ownerId: "task-1",
          attachmentId: "attachment % # 资料",
        }),
      ),
    ).toEqual({
      downloadUrl:
        "/api/v1/plugins/tasks/http/attachments/download?attachmentId=attachment%20%25%20%23%20%E8%B5%84%E6%96%99",
      openAction: "preview",
      previewUrl:
        "/api/v1/plugins/tasks/http/attachments/preview?attachmentId=attachment%20%25%20%23%20%E8%B5%84%E6%96%99",
    });
  });

  it("creates a Tasks byte tab without losing identity or line range", () => {
    expect(
      byteFileTabFromIdentity(
        identity({
          store: "tasks-attachment",
          ownerId: "task-1",
          attachmentId: "attachment-1",
        }),
      ),
    ).toEqual({
      displayName: "资料 100%#final.md",
      lineRange: { startLineNumber: 2, endLineNumber: 7 },
      mimeType: "text/markdown",
      ownerId: "task-1",
      resourceId: "attachment-1",
      sizeBytes: 42,
      source: "tasks-attachment",
    });
  });
});
