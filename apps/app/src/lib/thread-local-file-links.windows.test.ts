import { describe, expect, it } from "vitest";
import { resolveThreadLocalFileLink } from "./thread-local-file-links";

describe("resolveThreadLocalFileLink on native Windows paths", () => {
  it("resolves workspace containment for native Windows paths", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: { startLineNumber: 3, endLineNumber: 5 },
          path: "C:\\Users\\me\\Работа\\проект\\src\\..\\canvas-demo.html",
        },
        threadStorageRootPath: null,
        workspaceRootPath: "C:\\Users\\me\\Работа\\проект",
      }),
    ).toEqual({
      kind: "open-workspace-path",
      request: {
        lineRange: { startLineNumber: 3, endLineNumber: 5 },
        path: "c:/Users/me/Работа/проект/canvas-demo.html",
        relativePath: "canvas-demo.html",
        workspaceRootPath: "c:/Users/me/Работа/проект",
      },
    });
  });

  it("keeps native Windows paths outside the workspace as host files", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: null,
          path: "C:\\Users\\me\\outside\\id_rsa",
        },
        threadStorageRootPath: null,
        workspaceRootPath: "C:\\Users\\me\\project",
      }),
    ).toEqual({
      kind: "open-host-path",
      request: {
        lineRange: null,
        path: "c:/Users/me/outside/id_rsa",
      },
    });
  });
});
