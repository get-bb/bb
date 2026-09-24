import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../..");
const THEME_PREVIEW_TAXONOMY = resolve(
  REPO_ROOT,
  "plugins/theme-preview/taxonomy.ts",
);

interface FixtureAnchor {
  file: string;
  mustContain: readonly string[];
  because: string;
}

const SHARED_FIXTURE_ANCHORS: readonly FixtureAnchor[] = [
  {
    file: "apps/app/src/components/ui/sidebar.tsx",
    mustContain: ["fixed inset-y-0", "bg-sidebar text-sidebar-foreground"],
    because:
      "The mock sidebar carries `fixed bg-sidebar` so theme blocks scoped to `.fixed.bg-sidebar` (token overrides, noise overlays) apply to it exactly as they do in the app.",
  },
  {
    file: "apps/app/src/components/sidebar/sidebarRowClasses.ts",
    mustContain: [
      "SIDEBAR_ROW_BASE_CLASS =",
      "SIDEBAR_ROW_INTERACTIVE_STATE_CLASS =",
      "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      "SIDEBAR_ROW_SELECTED_STATE_CLASS =",
      "SIDEBAR_ROW_OPEN_IN_SPLIT_STATE_CLASS =",
    ],
    because:
      "Mock thread and settings rows keep BB's shared row geometry and rest, hover, selected, and split states.",
  },
  {
    file: "apps/app/src/components/sidebar/SectionSidebar.tsx",
    mustContain: [
      'from "@bb/shared-ui/button"',
      "PROJECT_LIST_ACTION_BUTTON_CLASS",
      "CHROME_SECTION_LABEL_CLASS",
      "SIDEBAR_STANDARD_ROW_PADDING_CLASS",
    ],
    because:
      "Mock sidebars use BB's shared button primitive, section-label token, padding, and project-row anatomy.",
  },
  {
    file: "apps/app/src/components/ui/context-selection.ts",
    mustContain: ['CONTEXT_SELECTION_SURFACE_CLASS = "bg-state-active"'],
    because: "The open thread's row in the mock paints state-active.",
  },
  {
    file: "apps/app/src/components/ui/theme.css",
    mustContain: [
      "--canvas:",
      "--sidebar:",
      "--card:",
      "--popover:",
      "--secondary:",
      "--muted:",
      "--surface-recessed:",
      "--surface-recessed-solid:",
      "--surface-recessed-soft-solid:",
      "--surface-scrim:",
      "--foreground:",
      "--muted-foreground:",
      "--subtle-foreground:",
      "--readback-foreground:",
      "--sidebar-foreground:",
      "--primary:",
      "--file-accent:",
      "--timeline-accent:",
      "--surface-selected:",
      "--state-hover:",
      "--state-active:",
      "--success:",
      "--warning:",
      "--attention:",
      "--destructive:",
      "--pr-merged:",
      "--diff-added:",
      "--diff-removed:",
      "--border:",
      "--border-hairline:",
      "--border-seam:",
      "--sidebar-border:",
      "--input:",
      "--ring:",
      "--font-sans:",
      "--font-mono:",
      "--text-2xs:",
      "--text-xs:",
      "--text-sm:",
      "--text-base:",
      "--spacing:",
      "--tracking-normal:",
      "--bb-sidebar-row-height:",
      "--icon-stroke-width:",
      "--radius:",
      "--shadow-x:",
      "--shadow-y:",
      "--shadow-blur:",
      "--shadow-spread:",
      "--shadow-color:",
      "--shadow-opacity:",
      "--bb-sidebar-open-in-split-background",
    ],
    because:
      "Every token the preview reads and lists must still be declared by the app's theme source of truth.",
  },
  {
    file: "apps/app/src/hooks/useTheme.ts",
    mustContain: ['THEME_STORAGE_KEY = "bb.theme"'],
    because:
      "The mode switch writes localStorage `bb.theme` and dispatches the storage event so Settings → Appearance stays synchronized.",
  },
  {
    file: "apps/app/src/main.tsx",
    mustContain: ["AppToaster"],
    because:
      "The toast specimen fires a real sonner toast rendered by the app-mounted Toaster.",
  },
];

const VIEW_FIXTURE_ANCHORS: Record<string, readonly FixtureAnchor[]> = {
  thread: [
    {
      file: "apps/app/src/views/thread-detail/ThreadTimelinePane.tsx",
      mustContain: [
        'variant="hosted-footer"',
        "scrollOverlay=",
        "<ThreadTableOfContents",
        "footer={footer}",
      ],
      because:
        "The thread projection keeps the real hosted-footer timeline, bottom composer, and held-open table of contents composition.",
    },
    {
      file: "apps/app/src/components/thread/toc/ThreadTableOfContents.tsx",
      mustContain: [
        'aria-label="Thread table of contents"',
        'label="Agent messages"',
        'label="Your messages"',
        "bg-popover",
      ],
      because:
        "The held-open fixture keeps the real message-role tabs and popover surface.",
    },
    {
      file: "apps/app/src/views/thread-detail/ThreadDetailView.tsx",
      mustContain: [
        'label: "Info"',
        'label: "Diff"',
        '<Icon name="Info" />',
        '<Icon name="FileDiff" />',
      ],
      because:
        "The thread projection exposes the same fixed secondary-panel tabs as BB.",
    },
    {
      file: "apps/app/src/components/secondary-panel/ThreadMetadataContent.tsx",
      mustContain: [
        'appearance="flat"',
        "<EnvironmentRow",
        "<BranchRow",
        "<PullRequestRow",
      ],
      because:
        "The open Info panel projects BB's flat metadata card and representative environment, branch, and pull-request rows.",
    },
    {
      file: "apps/app/src/components/promptbox/follow-up-placeholder.ts",
      mustContain: [
        "Ask for a follow-up. @ to mention files, folders, sections, or threads",
      ],
      because:
        "The thread composer uses the current follow-up prompt language.",
    },
  ],
  new: [
    {
      file: "apps/app/src/views/RootComposeEmptyWelcome.tsx",
      mustContain: [
        'title="New thread"',
        'description="Start a new conversation"',
        'title="Automatically import my projects"',
        'title="New project"',
        'title="Learn what bb can do"',
        "hover:bg-state-hover",
      ],
      because:
        "The New thread projection uses BB's current empty-welcome actions, hierarchy, and hover state.",
    },
  ],
  split: [
    {
      file: "apps/app/src/views/thread-detail/SplitThreadArea.tsx",
      mustContain: [
        "data-split-pane-id",
        "data-focused",
        "data-pane-focus-scrim",
        '"bg-background/30"',
        "<SplitDivider",
      ],
      because:
        "The Split projection keeps BB's pane identity, focus state, divider, and inactive-pane wash.",
    },
  ],
  settings: [
    {
      file: "apps/app/src/components/settings/SettingsSidebar.tsx",
      mustContain: [
        'backLabel="Back to app"',
        "<SectionSidebarLabel>Settings</SectionSidebarLabel>",
        "activeSection === section.id",
      ],
      because:
        "The Appearance projection uses BB's settings navigation hierarchy and selected-row state.",
    },
    {
      file: "apps/app/src/components/settings/settings-sections.ts",
      mustContain: [
        '{ icon: "Palette", id: "appearance", label: "Appearance" }',
      ],
      because:
        "The settings navigation keeps Appearance as a first-class BB settings destination.",
    },
    {
      file: "apps/app/src/views/SettingsView.tsx",
      mustContain: [
        '<SettingsSection title="Appearance">',
        '<SettingsWithControl label="Theme">',
        'label="Palette"',
        "Palettes change bb's colors, including syntax colors in diffs and file previews.",
        'label="Favicon color"',
        "<SplitDimmingSetting />",
      ],
      because:
        "The Appearance projection keeps BB's current theme, palette, favicon, and inactive-split controls.",
    },
    {
      file: "apps/app/src/components/ui/settings-section.tsx",
      mustContain: [
        "rounded-lg border border-border bg-card px-4 py-3.5",
        "flex flex-col gap-2.5",
        "text-xs leading-snug text-subtle-foreground/75",
      ],
      because:
        "The Appearance projection keeps BB's section card, responsive rows, and supporting-copy hierarchy.",
    },
  ],
};

const FIXTURE_ANCHORS: readonly FixtureAnchor[] = [
  ...SHARED_FIXTURE_ANCHORS,
  ...Object.values(VIEW_FIXTURE_ANCHORS).flat(),
];

async function themePreviewViewIds(): Promise<string[]> {
  const taxonomy: { MOCK_VIEWS?: unknown } = await import(
    /* @vite-ignore */ THEME_PREVIEW_TAXONOMY
  );
  const views = taxonomy.MOCK_VIEWS;
  if (!Array.isArray(views)) {
    throw new Error("plugins/theme-preview/taxonomy.ts exports no MOCK_VIEWS");
  }
  return views.map((view: unknown) => {
    if (
      typeof view !== "object" ||
      view === null ||
      !("id" in view) ||
      typeof view.id !== "string"
    ) {
      throw new Error("a Theme Preview mock view has no string id");
    }
    return view.id;
  });
}

describe("Theme Preview fixture anatomy", () => {
  it("gives every Theme Preview mock view a live-app source contract", async () => {
    for (const id of await themePreviewViewIds()) {
      expect(VIEW_FIXTURE_ANCHORS[id]?.length ?? 0, id).toBeGreaterThan(0);
    }
  });

  for (const anchor of FIXTURE_ANCHORS) {
    it(`still matches ${anchor.file}`, () => {
      const source = readFileSync(resolve(REPO_ROOT, anchor.file), "utf8");
      for (const needle of anchor.mustContain) {
        expect(
          source,
          `${anchor.because}\nTheme Preview's mock (plugins/theme-preview/app.tsx) mirrors this, so update it together with this anchor.\nExpected ${anchor.file} to contain: ${needle}`,
        ).toContain(needle);
      }
    });
  }
});
