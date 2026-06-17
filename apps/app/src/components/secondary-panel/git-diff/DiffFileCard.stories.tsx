import { useCallback, useMemo, useState } from "react";
import type { DiffFileEntry } from "@bb/server-contract";
import { GIT_DIFF_VIEW_BASE_OPTIONS } from "@/components/git-diff/GitDiffCard";
import type { RequestDiffFileContents } from "@/components/git-diff/GitDiffCardBody";
import { DEFAULT_CODE_OVERFLOW_MODE } from "@/lib/code-overflow-mode";
import { usePreferredTheme } from "@/hooks/useTheme";
import type { DiffPatchState } from "@/hooks/queries/use-environment-diff-patches";
import { appToast } from "@/components/ui/app-toast";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { DiffFileCard } from "./DiffFileCard";

export default {
  title: "right-panel/Diff File Card",
};

// A one-line modified patch — the card parses this and renders the real diff.
const MODIFIED_PATCH = [
  "diff --git a/src/file.ts b/src/file.ts",
  "index 1111111..2222222 100644",
  "--- a/src/file.ts",
  "+++ b/src/file.ts",
  "@@ -1 +1 @@",
  "-export const value = 1;",
  "+export const value = 2;",
  "",
].join("\n");

const TALL_ADDED_LINES = 40;

// A taller patch so the sticky header has a body to stay pinned over while the
// file scrolls underneath it.
const TALL_PATCH = [
  "diff --git a/src/tall.ts b/src/tall.ts",
  "index 1111111..2222222 100644",
  "--- a/src/tall.ts",
  "+++ b/src/tall.ts",
  `@@ -1,2 +1,${TALL_ADDED_LINES + 2} @@`,
  " export const start = true;",
  ...Array.from(
    { length: TALL_ADDED_LINES },
    (_, index) => `+export const line${index + 1} = ${index + 1};`,
  ),
  " export const end = true;",
  "",
].join("\n");

// Git emits this (no `--binary`) for an added image; it parses to a zero-hunk
// file the card routes to its inline image preview.
const ADDED_IMAGE_PATCH = [
  "diff --git a/assets/logo.png b/assets/logo.png",
  "new file mode 100644",
  "index 0000000..2222222",
  "Binary files /dev/null and b/assets/logo.png differ",
  "",
].join("\n");

// A 1x1 transparent PNG so the image-preview branch has something to render.
const IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/Qo3AAAAAElFTkSuQmCC";

const imageContentsRequester: RequestDiffFileContents = async () => ({
  kind: "image",
  dataUrl: IMAGE_DATA_URL,
  sizeBytes: 20_480,
});

function buildEntry(overrides: Partial<DiffFileEntry> = {}): DiffFileEntry {
  return {
    path: "src/file.ts",
    previousPath: null,
    changeKind: "modified",
    additions: 1,
    deletions: 1,
    binary: false,
    origin: "tracked",
    loadMode: "auto",
    ...overrides,
  };
}

interface CardStageProps {
  entry?: Partial<DiffFileEntry>;
  patchState?: DiffPatchState;
  collapsed?: boolean;
  onRequestFileContents?: RequestDiffFileContents;
}

// Mounts a single DiffFileCard at a panel-realistic width with live theme-aware
// view options, mirroring how DiffFilesPanel renders each row.
function CardStage({
  entry,
  patchState = { status: "idle" },
  collapsed = false,
  onRequestFileContents,
}: CardStageProps) {
  const preferredTheme = usePreferredTheme();
  const diffViewOptions = useMemo(
    () => ({
      ...GIT_DIFF_VIEW_BASE_OPTIONS,
      diffStyle: "unified",
      overflow: DEFAULT_CODE_OVERFLOW_MODE,
      themeType: preferredTheme,
    }),
    [preferredTheme],
  );
  const [isCollapsed, setIsCollapsed] = useState(collapsed);
  const toast = useCallback(
    (label: string) => (path: string) =>
      appToast.message(label, { description: path }),
    [],
  );
  return (
    <div className="w-full max-w-[640px] min-w-0">
      <DiffFileCard
        entry={buildEntry(entry)}
        diffViewOptions={diffViewOptions}
        isCollapsed={isCollapsed}
        onToggleCollapsed={() => setIsCollapsed((value) => !value)}
        patchState={patchState}
        onLoadPatch={() => appToast.message("Load diff requested")}
        onRetry={() => appToast.message("Retry requested")}
        onOpenFileInEditor={toast("Open in editor")}
        onOpenFilePreview={toast("Open file preview")}
        onRequestFileContents={onRequestFileContents}
      />
    </div>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="loaded · modified"
        hint="an auto-tier file whose patch has arrived; renders the real unified diff"
      >
        <CardStage
          patchState={{
            status: "loaded",
            patch: MODIFIED_PATCH,
            truncated: false,
          }}
        />
      </StoryRow>
      <StoryRow
        label="load on demand"
        hint="on_demand tier (large or binary): header + a Load diff CTA that triggers the fetch"
      >
        <CardStage entry={{ loadMode: "on_demand", additions: 820, deletions: 140 }} />
      </StoryRow>
      <StoryRow
        label="too large"
        hint="too_large tier: never fetched; a notice plus an open-in-preview link"
      >
        <CardStage
          entry={{ loadMode: "too_large", additions: 30_000, deletions: 0 }}
        />
      </StoryRow>
      <StoryRow
        label="truncated patch"
        hint="loaded but tail-cut past the byte budget; offers a Show full diff affordance"
      >
        <CardStage
          patchState={{
            status: "loaded",
            patch: MODIFIED_PATCH,
            truncated: true,
          }}
        />
      </StoryRow>
      <StoryRow
        label="per-file error"
        hint="a failed patch fetch surfaces the message inline with a Retry"
      >
        <CardStage
          patchState={{ status: "error", error: "Request timed out after 10s" }}
        />
      </StoryRow>
      <StoryRow
        label="loading"
        hint="auto-tier patch in flight; a skeleton holds the space"
      >
        <CardStage patchState={{ status: "loading" }} />
      </StoryRow>
      <StoryRow
        label="no renderable diff"
        hint="a loaded patch that parses to nothing (pure rename / mode-only) is terminal, not a spinner"
      >
        <CardStage
          patchState={{ status: "loaded", patch: "", truncated: false }}
        />
      </StoryRow>
      <StoryRow
        label="image change"
        hint="a binary image routes to an inline preview instead of a No renderable diff notice"
      >
        <CardStage
          entry={{
            path: "assets/logo.png",
            changeKind: "added",
            additions: 0,
            deletions: 0,
            binary: true,
            loadMode: "on_demand",
          }}
          patchState={{
            status: "loaded",
            patch: ADDED_IMAGE_PATCH,
            truncated: false,
          }}
          onRequestFileContents={imageContentsRequester}
        />
      </StoryRow>
      <StoryRow
        label="collapsed"
        hint="header only; click the chevron to expand the body"
      >
        <CardStage
          collapsed
          patchState={{
            status: "loaded",
            patch: MODIFIED_PATCH,
            truncated: false,
          }}
        />
      </StoryRow>
    </StoryCard>
  );
}

export function StickyHeader() {
  return (
    <StoryCard>
      <StoryRow
        label="sticky header on scroll"
        hint="scroll the panel: each file header pins to the top, squares its top corners while stuck, and clips to the card's rounded shape so corners never peek over the scrolling diff"
      >
        <div
          className="w-full max-w-[640px] min-w-0 space-y-2 overflow-auto rounded-md border border-border bg-background px-4 py-3"
          style={{ maxHeight: 320 }}
        >
          <CardStage
            entry={{ path: "src/first.ts" }}
            patchState={{ status: "loaded", patch: TALL_PATCH, truncated: false }}
          />
          <CardStage
            entry={{ path: "src/second.ts" }}
            patchState={{ status: "loaded", patch: TALL_PATCH, truncated: false }}
          />
        </div>
      </StoryRow>
    </StoryCard>
  );
}
