import { describe, expect, it } from "vitest";
import { threadTabsSchema, type ThreadTab } from "../src/api/thread-tabs.js";

const OPENER_TAB_BASE = {
  actionId: "file-opener:markdown",
  id: "plugin-panel:docs%3Afile-opener%3Amarkdown%3A%7B%7D:none",
  kind: "plugin-panel",
  paramsJson: JSON.stringify({
    path: "docs/readme.md",
    source: {
      kind: "workspace",
      threadId: "thr_docs",
      environmentId: "env_docs",
      projectId: null,
    },
  }),
  pluginId: "docs",
  title: "readme.md",
} as const;

/**
 * The three owner shapes a plugin file opener can divert, mirroring the app's
 * `ownerRequestForOpenRequest` branches.
 */
const OWNERS = [
  {
    environmentId: "env_docs",
    kind: "workspace-file-preview",
    projectId: null,
    tab: {
      lineRange: { endLineNumber: 12, startLineNumber: 8 },
      path: "docs/readme.md",
      source: { kind: "working-tree" },
      statusLabel: null,
    },
    threadId: "thr_docs",
  },
  {
    environmentId: "env_docs",
    kind: "host-file-preview",
    tab: { lineRange: null, path: "/Users/dev/notes.md" },
    threadId: "thr_docs",
  },
  {
    environmentId: null,
    kind: "thread-storage-file-preview",
    tab: { lineRange: null, path: "plan.md" },
    threadId: "thr_docs",
  },
] as const;

describe("thread tab file-opener owner", () => {
  it.each(OWNERS.map((owner) => [owner.kind, owner] as const))(
    "accepts a plugin-panel tab that diverted a %s",
    (_kind, fileOpenerOwner) => {
      const parsed = threadTabsSchema.parse([
        { ...OPENER_TAB_BASE, fileOpenerOwner },
      ]);

      expect(parsed[0]).toEqual({ ...OPENER_TAB_BASE, fileOpenerOwner });
    },
  );

  it("round-trips through the server's JSON storage of the tab list", () => {
    const tabs: ThreadTab[] = [
      { ...OPENER_TAB_BASE, fileOpenerOwner: OWNERS[0] },
    ];

    const restored = threadTabsSchema.parse(JSON.parse(JSON.stringify(tabs)));

    expect(restored).toEqual(tabs);
  });

  it("still rejects unknown fields on the plugin-panel branch", () => {
    const result = threadTabsSchema.safeParse([
      { ...OPENER_TAB_BASE, fileOpenerBogus: {} },
    ]);

    expect(result.success).toBe(false);
  });

  it("rejects an owner whose payload does not match its kind", () => {
    const result = threadTabsSchema.safeParse([
      {
        ...OPENER_TAB_BASE,
        // `host-file-preview` owners require a concrete environment id.
        fileOpenerOwner: { ...OWNERS[1], environmentId: null },
      },
    ]);

    expect(result.success).toBe(false);
  });
});
