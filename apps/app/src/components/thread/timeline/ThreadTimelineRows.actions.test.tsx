import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

describe("ThreadTimelineRows actions", () => {
  it("renders send-to-main on assistant rows when the timeline supplies a handler", () => {
    const markup = renderToStaticMarkup(
      <ThreadTimelineRows
        timelineRows={[
          conversationRow({
            role: "assistant",
            text: "Use this answer in the main chat.",
          }),
        ]}
        threadRuntimeDisplayStatus="idle"
        onSendToMainMessage={() => undefined}
        workspaceRootPath={undefined}
      />,
    );

    expect(markup).toContain('aria-label="Send to main thread"');
  });
});
