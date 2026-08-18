import { describe, expect, it } from "vitest";
import { threadTabsSchema } from "@bb/server-contract";
import type { PluginFileOpenerSlot } from "@/lib/plugin-slots";
import type { OpenSecondaryPanelTabRequest } from "@/components/secondary-panel/useThreadFileTabs";
import { createFileOpenerTabForRequest } from "./file-opener-tabs";

const MARKDOWN_OPENER = {
  component: () => null,
  extensions: ["md"],
  generation: 1,
  id: "markdown",
  pluginId: "docs",
  title: "Docs editor",
} satisfies PluginFileOpenerSlot;

const REQUESTS: readonly {
  label: string;
  request: OpenSecondaryPanelTabRequest;
}[] = [
  {
    label: "workspace file",
    request: {
      kind: "workspace-file-preview",
      tab: {
        lineRange: { endLineNumber: 12, startLineNumber: 8 },
        path: "docs/readme.md",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    },
  },
  {
    label: "host file",
    request: {
      kind: "host-file-preview",
      tab: { lineRange: null, path: "/Users/dev/notes.md" },
    },
  },
  {
    label: "thread-storage file",
    request: {
      kind: "thread-storage-file-preview",
      tab: { lineRange: null, path: "plan.md" },
    },
  },
];

/**
 * Opener tabs are persisted through the thread-tabs contract, which parses
 * every branch strictly — an owner field the contract does not model fails
 * the whole sync (issue #1773), not just that tab.
 */
describe("createFileOpenerTabForRequest thread-tabs contract", () => {
  it.each(REQUESTS.map(({ label, request }) => [label, request] as const))(
    "produces a %s tab the thread-tabs contract accepts",
    (_label, request) => {
      const tab = createFileOpenerTabForRequest({
        fileOpeners: [MARKDOWN_OPENER],
        preference: {},
        projectId: null,
        request,
        resolvedEnvironmentId: "env_docs",
        threadId: "thr_docs",
      });

      expect(tab?.fileOpenerOwner).toBeDefined();
      expect(() => threadTabsSchema.parse([tab])).not.toThrow();
    },
  );

  it("keeps a projectless workspace opener tab contract-valid", () => {
    const tab = createFileOpenerTabForRequest({
      fileOpeners: [MARKDOWN_OPENER],
      preference: {},
      projectId: null,
      request: {
        kind: "workspace-file-preview",
        tab: {
          lineRange: null,
          path: "docs/readme.md",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
      },
      resolvedEnvironmentId: null,
      threadId: null,
    });

    expect(tab?.fileOpenerOwner).toMatchObject({
      environmentId: null,
      kind: "workspace-file-preview",
      projectId: null,
      threadId: null,
    });
    expect(() => threadTabsSchema.parse([tab])).not.toThrow();
  });
});
