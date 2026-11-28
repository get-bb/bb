// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ComposerEditorSlot } from "./ComposerEditorSlot";

afterEach(cleanup);

it("uses the scaled height in explicit compact mode without a container query", () => {
  const { container } = render(
    <ComposerEditorSlot
      editor={null}
      scrollContainerRef={{ current: null }}
      inputLocked={false}
      isCompactLayout
      minHeight={80}
      layout="thread"
      resolveMentionLink={undefined}
    />,
  );
  const editorScroll = container.querySelector<HTMLElement>(
    "[data-promptbox-editor-scroll]",
  );

  expect(editorScroll?.style.height).toBe("var(--compact-editor-height)");
  expect(editorScroll?.style.minHeight).toBe("var(--compact-editor-height)");
  expect(editorScroll?.style.maxHeight).toBe("var(--compact-editor-height)");
});
