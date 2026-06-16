import { useState } from "react";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import {
  TimelineSelectionMenu,
  type TimelineSelectionMenuProps,
} from "./TimelineSelectionMenu";
import type { MessageProseSelection } from "./SelectableMessageProse";

export default {
  title: "thread/timeline/SelectionMenu",
};

// The component reads `rect` straight off the selection, so stories can hand
// it a mock DOMRect and skip the live-selection machinery entirely.
function mockSelection(
  text: string,
  rect: Partial<DOMRect>,
): MessageProseSelection {
  const base = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
  };
  const merged = { ...base, ...rect };
  return {
    text,
    rect: { ...merged, toJSON: () => merged } as DOMRect,
  };
}

const handlers: Pick<
  TimelineSelectionMenuProps,
  "onAddToChat" | "onReplyInSideChat" | "onDismiss"
> = {
  onAddToChat: (text) => console.log("onAddToChat", text),
  onReplyInSideChat: (text) => console.log("onReplyInSideChat", text),
  onDismiss: () => console.log("onDismiss"),
};

/**
 * A fixed-height stage that gives the fixed-positioned anchor a stable
 * coordinate space to render against inside the story canvas.
 */
function MenuStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-[220px] w-full overflow-hidden rounded-md border bg-surface-recessed">
      {children}
    </div>
  );
}

export function Positioning() {
  return (
    <StoryCard>
      <StoryRow
        label="Short selection"
        hint="Centered above the selection rect"
      >
        <MenuStage>
          <TimelineSelectionMenu
            selection={mockSelection("token", {
              left: 200,
              top: 120,
              width: 60,
              height: 18,
            })}
            {...handlers}
          />
        </MenuStage>
      </StoryRow>
      <StoryRow label="Long selection" hint="Anchor centered on a wide rect">
        <MenuStage>
          <TimelineSelectionMenu
            selection={mockSelection(
              "a much longer multi-word run of selected agent prose",
              { left: 80, top: 130, width: 360, height: 20 },
            )}
            {...handlers}
          />
        </MenuStage>
      </StoryRow>
      <StoryRow
        label="Near top edge"
        hint="Radix flips below when there is no room above"
      >
        <MenuStage>
          <TimelineSelectionMenu
            selection={mockSelection("near the top", {
              left: 200,
              top: 4,
              width: 90,
              height: 18,
            })}
            {...handlers}
          />
        </MenuStage>
      </StoryRow>
      <StoryRow
        label="Near right edge"
        hint="Radix clamps horizontally to stay on screen"
      >
        <MenuStage>
          <TimelineSelectionMenu
            selection={mockSelection("right edge", {
              left: 1180,
              top: 120,
              width: 80,
              height: 18,
            })}
            {...handlers}
          />
        </MenuStage>
      </StoryRow>
    </StoryCard>
  );
}

export function CompactViewport() {
  // On a compact viewport the Popover renders as a bottom drawer (see
  // responsive-overlay). Narrow the Ladle canvas to observe it.
  return (
    <StoryCard>
      <StoryRow
        label="Compact (drawer)"
        hint="Resize the canvas below ~640px to see the drawer"
      >
        <div className="w-[360px]">
          <MenuStage>
            <TimelineSelectionMenu
              selection={mockSelection("selected on mobile", {
                left: 120,
                top: 120,
                width: 140,
                height: 18,
              })}
              {...handlers}
            />
          </MenuStage>
        </div>
      </StoryRow>
    </StoryCard>
  );
}

export function Interactive() {
  const [log, setLog] = useState<string[]>([]);
  const [selection, setSelection] = useState<MessageProseSelection | null>(
    mockSelection("interactive selection", {
      left: 200,
      top: 120,
      width: 150,
      height: 18,
    }),
  );

  const push = (entry: string) => setLog((prev) => [entry, ...prev].slice(0, 6));

  return (
    <StoryCard>
      <StoryRow
        label="Click actions / Escape"
        hint="Buttons log; Escape or outside-click dismisses"
      >
        <div className="flex flex-col gap-3">
          <MenuStage>
            <TimelineSelectionMenu
              selection={selection}
              onAddToChat={(text) => push(`Add to chat: "${text}"`)}
              onReplyInSideChat={(text) => push(`Reply in side chat: "${text}"`)}
              onDismiss={() => {
                push("Dismissed");
                setSelection(null);
              }}
            />
          </MenuStage>
          <button
            type="button"
            className="w-fit rounded-md border px-2 py-1 text-xs"
            onClick={() =>
              setSelection(
                mockSelection("interactive selection", {
                  left: 200,
                  top: 120,
                  width: 150,
                  height: 18,
                }),
              )
            }
          >
            Re-open menu
          </button>
          <ul className="text-xs text-muted-foreground">
            {log.length === 0 ? <li>No events yet</li> : null}
            {log.map((entry, index) => (
              <li key={index}>{entry}</li>
            ))}
          </ul>
        </div>
      </StoryRow>
    </StoryCard>
  );
}
