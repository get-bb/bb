import type { ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar.js";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { ThreadRow, type ThreadRowOptions } from "./ThreadRow";
import {
  getSidebarThreadGroupLineLeft,
  getSidebarThreadRowPaddingLeft,
  SIDEBAR_ROW_BASE_CLASS,
} from "./sidebarRowClasses";

export default {
  title: "sidebar/Nest drop preview",
};

const PARENT_DEPTH = 0;
const CHILD_DEPTH = PARENT_DEPTH + 1;
const CHILD_INDENT_PX = getSidebarThreadRowPaddingLeft(CHILD_DEPTH);
const PARENT_GLYPH_PX = getSidebarThreadGroupLineLeft(PARENT_DEPTH);

const rowOption = (
  depth: number,
  isCompact = false,
  nest = false,
): ThreadRowOptions => ({
  kind: "default",
  depth,
  isCompact,
  nestDrop: nest
    ? { setNodeRef: () => undefined, state: "valid", reorderPlacement: null }
    : undefined,
});

const thread = (id: string, title: string): ThreadListEntry =>
  makeThreadListEntry({ id, title, titleFallback: title });

const SIBLING_ABOVE = thread("thr_above", "Weekly triage sweep");
const TARGET = thread("thr_target", "Drafting the changelog");
const EXISTING_CHILD = thread("thr_child", "Crash on cold start");
const SIBLING_BELOW = thread("thr_below", "Rotate build credentials");
const DRAGGED = thread("thr_dragged", "Audit spacing tokens");

function Row({
  entry,
  depth,
  isCompact = false,
  nest = false,
}: {
  entry: ThreadListEntry;
  depth: number;
  isCompact?: boolean;
  nest?: boolean;
}) {
  return (
    <ThreadRow
      projectId="proj_demo"
      crossProjectId={null}
      thread={entry}
      isActive={false}
      hasComposerDraft={false}
      options={rowOption(depth, isCompact, nest)}
    />
  );
}

function Stage({ children }: { children: ReactNode }) {
  return (
    <ThreadActionsProvider>
      <div className="w-[300px] rounded-md bg-sidebar p-2 text-sidebar-foreground">
        <SidebarMenu className="gap-2">
          <SidebarMenuItem>
            <div className="relative space-y-0.5">{children}</div>
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
    </ThreadActionsProvider>
  );
}

function DraggedRow() {
  return (
    <div className="opacity-35">
      <Row entry={DRAGGED} depth={PARENT_DEPTH} />
    </div>
  );
}

function Frame({
  children,
  tone = "none",
}: {
  children: ReactNode;
  tone?: "none" | "soft" | "accent";
}) {
  return (
    <div className="relative">
      {tone !== "none" ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 z-[5] rounded-md",
            tone === "soft" ? "bg-sidebar-accent/45" : "bg-sidebar-accent",
          )}
        />
      ) : null}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

function VariantCurrent() {
  return (
    <Stage>
      <Row entry={SIBLING_ABOVE} depth={PARENT_DEPTH} />
      <Row entry={TARGET} depth={PARENT_DEPTH} nest />
      <Row entry={EXISTING_CHILD} depth={CHILD_DEPTH} isCompact />
      <Row entry={SIBLING_BELOW} depth={PARENT_DEPTH} />
      <DraggedRow />
    </Stage>
  );
}

function VariantElbow() {
  return (
    <Stage>
      <Row entry={SIBLING_ABOVE} depth={PARENT_DEPTH} />
      <Frame tone="soft">
        <Row entry={TARGET} depth={PARENT_DEPTH} />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 z-20 w-0.5 rounded-full bg-sidebar-ring"
          style={{ left: PARENT_GLYPH_PX, height: 11 }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 z-20 h-0.5 rounded-full bg-sidebar-ring"
          style={{
            left: PARENT_GLYPH_PX,
            width: CHILD_INDENT_PX - PARENT_GLYPH_PX,
          }}
        />
      </Frame>
      <Row entry={EXISTING_CHILD} depth={CHILD_DEPTH} isCompact />
      <Row entry={SIBLING_BELOW} depth={PARENT_DEPTH} />
      <DraggedRow />
    </Stage>
  );
}

function VariantDash() {
  return (
    <Stage>
      <Row entry={SIBLING_ABOVE} depth={PARENT_DEPTH} />
      <Frame tone="soft">
        <Row entry={TARGET} depth={PARENT_DEPTH} />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 z-20 h-0.5 w-6 rounded-full bg-sidebar-ring"
          style={{ left: CHILD_INDENT_PX }}
        />
      </Frame>
      <Row entry={EXISTING_CHILD} depth={CHILD_DEPTH} isCompact />
      <Row entry={SIBLING_BELOW} depth={PARENT_DEPTH} />
      <DraggedRow />
    </Stage>
  );
}

function VariantOutlineElbow() {
  return (
    <Stage>
      <Row entry={SIBLING_ABOVE} depth={PARENT_DEPTH} />
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 rounded-md ring-1 ring-inset ring-sidebar-ring/70"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 z-20 w-0.5 rounded-full bg-sidebar-ring"
          style={{ left: PARENT_GLYPH_PX, height: 11 }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 z-20 h-0.5 rounded-full bg-sidebar-ring"
          style={{
            left: PARENT_GLYPH_PX,
            width: CHILD_INDENT_PX - PARENT_GLYPH_PX,
          }}
        />
        <div className="relative z-10">
          <Row entry={TARGET} depth={PARENT_DEPTH} />
        </div>
      </div>
      <Row entry={EXISTING_CHILD} depth={CHILD_DEPTH} isCompact />
      <Row entry={SIBLING_BELOW} depth={PARENT_DEPTH} />
      <DraggedRow />
    </Stage>
  );
}

function VariantGhostChild() {
  return (
    <Stage>
      <Row entry={SIBLING_ABOVE} depth={PARENT_DEPTH} />
      <Frame tone="soft">
        <Row entry={TARGET} depth={PARENT_DEPTH} />
      </Frame>
      <div
        className={cn(
          SIDEBAR_ROW_BASE_CLASS,
          "h-7 rounded-md border border-dashed border-sidebar-ring/70 bg-sidebar-accent/30 text-sm text-muted-foreground",
        )}
        style={{ paddingLeft: CHILD_INDENT_PX }}
      >
        <span className="min-w-0 flex-1 truncate">Audit spacing tokens</span>
      </div>
      <Row entry={EXISTING_CHILD} depth={CHILD_DEPTH} isCompact />
      <Row entry={SIBLING_BELOW} depth={PARENT_DEPTH} />
      <DraggedRow />
    </Stage>
  );
}

function VariantCaretOnly() {
  return (
    <Stage>
      <Row entry={SIBLING_ABOVE} depth={PARENT_DEPTH} />
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 z-20 w-[3px] rounded-full bg-sidebar-ring"
          style={{ left: 0 }}
        />
        <div className="relative z-10">
          <Row entry={TARGET} depth={PARENT_DEPTH} />
        </div>
      </div>
      <Row entry={EXISTING_CHILD} depth={CHILD_DEPTH} isCompact />
      <Row entry={SIBLING_BELOW} depth={PARENT_DEPTH} />
      <DraggedRow />
    </Stage>
  );
}

function VariantControlMain() {
  return (
    <Stage>
      <Row entry={SIBLING_ABOVE} depth={PARENT_DEPTH} />
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[5] rounded-md bg-sidebar-accent ring-1 ring-inset ring-sidebar-ring"
        />
        <div className="relative z-10">
          <Row entry={TARGET} depth={PARENT_DEPTH} />
        </div>
      </div>
      <Row entry={EXISTING_CHILD} depth={CHILD_DEPTH} isCompact />
      <div
        className={cn(
          SIDEBAR_ROW_BASE_CLASS,
          "h-7 overflow-hidden text-sidebar-foreground opacity-50",
        )}
        style={{ paddingLeft: CHILD_INDENT_PX }}
      >
        <span className="min-w-0 flex-1 truncate">{DRAGGED.title}</span>
      </div>
      <Row entry={SIBLING_BELOW} depth={PARENT_DEPTH} />
    </Stage>
  );
}

function SelectedTarget({ underlineBottom }: { underlineBottom: number }) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[5] rounded-md bg-sidebar-accent ring-1 ring-inset ring-sidebar-ring"
      />
      <div className="relative z-10">
        <Row entry={TARGET} depth={PARENT_DEPTH} />
      </div>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-1 z-20 h-0.5 rounded-full bg-sidebar-ring"
        style={{ left: CHILD_INDENT_PX, bottom: underlineBottom }}
      />
    </div>
  );
}

function VariantSelectedUnderline({
  underlineBottom,
}: {
  underlineBottom: number;
}) {
  return (
    <Stage>
      <Row entry={SIBLING_ABOVE} depth={PARENT_DEPTH} />
      <SelectedTarget underlineBottom={underlineBottom} />
      <Row entry={EXISTING_CHILD} depth={CHILD_DEPTH} isCompact />
      <Row entry={SIBLING_BELOW} depth={PARENT_DEPTH} />
      <DraggedRow />
    </Stage>
  );
}

export function Variants() {
  return (
    <StoryCard labelWidth="260px">
      <StoryRow
        label="A — current"
        hint="accent row + underline from the child indent to the row's right edge"
      >
        <VariantCurrent />
      </StoryRow>
      <StoryRow
        label="B — elbow"
        hint="tree elbow from the parent glyph turning right at the child indent: the shape a real child hangs from"
      >
        <VariantElbow />
      </StoryRow>
      <StoryRow
        label="C — dash"
        hint="short dash at the child indent instead of a full-width rule; points at the slot rather than underlining the row"
      >
        <VariantDash />
      </StoryRow>
      <StoryRow
        label="D — outline + elbow"
        hint="no fill at all: the row is outlined and the elbow carries the meaning"
      >
        <VariantOutlineElbow />
      </StoryRow>
      <StoryRow
        label="E — ghost child"
        hint="explicit placeholder row at child depth; costs one row of layout"
      >
        <VariantGhostChild />
      </StoryRow>
      <StoryRow
        label="F — leading bar"
        hint="accent bar on the row's leading edge, no indent language at all"
      >
        <VariantCaretOnly />
      </StoryRow>
      <StoryRow
        label="H — G's selection + A's underline"
        hint="filled row with the ring back, and the underline from the child indent; source row stays dimmed in place"
      >
        <VariantSelectedUnderline underlineBottom={0} />
      </StoryRow>
      <StoryRow
        label="H2 — same, underline lifted inside the ring"
        hint="the underline sits 3px up so it reads as its own mark instead of merging with the ring's bottom edge"
      >
        <VariantSelectedUnderline underlineBottom={3} />
      </StoryRow>
      <StoryRow
        label="G — control (origin/main)"
        hint="pre-branch behaviour: filled row with a ring, a ghost child carrying the dragged title at 50%, and the source row pulled out of flow entirely"
      >
        <VariantControlMain />
      </StoryRow>
    </StoryCard>
  );
}
