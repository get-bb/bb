import { describe, expect, it } from "vitest";
import type { FilePreviewLineRange } from "@bb/client-core";
import type { WorkspaceOpenTargetId } from "@bb/host-daemon-contract";
import { resolveThreadLocalFileLink } from "./thread-local-file-links";

const WORKSPACE = { environmentId: "env_one", rootPath: "/Users/me/project" };
const STORAGE = {
  threadId: "thr_one",
  rootPath: "/Users/me/.bb/thread-storage/thr_one",
};

function resolve(
  path: string,
  overrides: Partial<Parameters<typeof resolveThreadLocalFileLink>[0]> & {
    lineRange?: FilePreviewLineRange | null;
    openTargetId?: WorkspaceOpenTargetId | null;
  } = {},
) {
  const { lineRange = null, openTargetId = null, ...args } = overrides;
  return resolveThreadLocalFileLink({
    fileOpenTargetIds: [],
    hostId: "host_one",
    threadStorage: null,
    workspace: WORKSPACE,
    ...args,
    link: { lineRange, openTargetId, path },
  });
}

describe("resolveThreadLocalFileLink", () => {
  it("leaves app routes as normal navigation", () => {
    expect(resolve("/projects/proj_gyz9przugq/threads/thr_rq7r4uv8zg")).toEqual(
      { kind: "app-route" },
    );
  });

  it("opens host file links when there is no ready local workspace", () => {
    expect(
      resolve("/Users/me/project/src/file.ts", { workspace: null }),
    ).toEqual({
      kind: "preview",
      options: {
        target: {
          kind: "host",
          hostId: "host_one",
          path: "/Users/me/project/src/file.ts",
        },
        location: null,
      },
    });
  });

  it("rejects file links when the thread has no machine", () => {
    expect(resolve("/Users/me/.ssh/id_rsa", { hostId: null })).toEqual({
      description:
        "Thread file links are only available when the thread has an environment.",
      kind: "error",
    });
  });

  it("opens paths outside the workspace root as host files", () => {
    expect(
      resolve("/Users/me/.ssh/id_rsa", {
        lineRange: { startLineNumber: 12, endLineNumber: 14 },
      }),
    ).toEqual({
      kind: "preview",
      options: {
        target: {
          kind: "host",
          hostId: "host_one",
          path: "/Users/me/.ssh/id_rsa",
        },
        location: { kind: "range", startLine: 12, endLine: 14 },
      },
    });
  });

  it("normalizes paths before checking workspace containment", () => {
    expect(
      resolve("/Users/me/project/src/../src/file.ts", {
        workspace: { environmentId: "env_one", rootPath: "/Users/me/project/" },
      }),
    ).toEqual({
      kind: "preview",
      options: {
        target: {
          kind: "workspace",
          environmentId: "env_one",
          path: "src/file.ts",
        },
        location: null,
      },
    });
  });

  it("opens a Windows path inside the workspace in any spelling", () => {
    expect(
      resolve("c:/src/Repo/packages/app/file.ts", {
        workspace: { environmentId: "env_one", rootPath: "C:\\src\\repo" },
      }),
    ).toEqual({
      kind: "preview",
      options: {
        target: {
          kind: "workspace",
          environmentId: "env_one",
          path: "packages/app/file.ts",
        },
        location: null,
      },
    });
  });

  it("rejects relative file links", () => {
    expect(resolve("apps/app/src/main.tsx")).toEqual({
      description: "Thread file links must use absolute file paths.",
      kind: "error",
    });
  });

  it("does not mistake deeper filesystem paths for project routes", () => {
    expect(
      resolve("/projects/my-repo/src/file.ts", {
        workspace: { environmentId: "env_one", rootPath: "/projects/my-repo" },
      }),
    ).toMatchObject({
      kind: "preview",
      options: { target: { kind: "workspace", path: "src/file.ts" } },
    });
  });

  it("opens paths inside the known thread storage root as storage files", () => {
    expect(
      resolve(`${STORAGE.rootPath}/reports/preview.html`, {
        lineRange: { startLineNumber: 4, endLineNumber: 6 },
        threadStorage: STORAGE,
      }),
    ).toEqual({
      kind: "preview",
      options: {
        target: {
          kind: "thread-storage",
          threadId: "thr_one",
          path: "reports/preview.html",
        },
        location: { kind: "range", startLine: 4, endLine: 6 },
      },
    });
  });

  it("opens editor links in the editor they name when it is available", () => {
    const editorLink = {
      lineRange: { startLineNumber: 12, endLineNumber: 12 },
      openTargetId: "devin-desktop" as const,
    };

    expect(
      resolve("/Users/me/project/src/../review.diff", {
        ...editorLink,
        fileOpenTargetIds: ["vscode", "devin-desktop"],
      }),
    ).toEqual({
      kind: "open-in-target",
      lineRange: { startLineNumber: 12, endLineNumber: 12 },
      path: "/Users/me/project/review.diff",
      targetId: "devin-desktop",
    });
    expect(
      resolve("/Users/me/project/src/../review.diff", {
        ...editorLink,
        fileOpenTargetIds: ["vscode"],
      }),
    ).toMatchObject({
      kind: "preview",
      options: { target: { kind: "workspace", path: "review.diff" } },
    });
  });
});
