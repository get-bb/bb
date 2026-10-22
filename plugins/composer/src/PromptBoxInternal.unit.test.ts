// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { ComposerMention } from "@get-bb/plugin-sdk/app";
import {
  arePromptEditorValuesEqual,
  suppressPromptEditorAnchorActivation,
} from "./PromptBoxInternal";

function dispatchThroughEditorTarget({
  eventName,
  target,
}: {
  eventName: "auxclick" | "click";
  target: HTMLElement;
}) {
  const editorRoot = document.createElement("div");
  editorRoot.append(target);
  document.body.append(editorRoot);

  let suppressed = false;
  editorRoot.addEventListener(eventName, (event) => {
    suppressed = suppressPromptEditorAnchorActivation(event);
  });

  const event = new MouseEvent(eventName, {
    bubbles: true,
    cancelable: true,
  });
  const defaultAllowed = target.dispatchEvent(event);

  editorRoot.remove();
  return { defaultAllowed, event, suppressed };
}

describe("suppressPromptEditorAnchorActivation", () => {
  it("cancels anchor clicks inside the prompt editor", () => {
    const anchor = document.createElement("a");
    anchor.href = "https://example.com";
    anchor.textContent = "https://example.com";

    const result = dispatchThroughEditorTarget({
      eventName: "click",
      target: anchor,
    });

    expect(result.suppressed).toBe(true);
    expect(result.event.defaultPrevented).toBe(true);
    expect(result.defaultAllowed).toBe(false);
  });

  it("cancels auxiliary anchor clicks inside the prompt editor", () => {
    const anchor = document.createElement("a");
    anchor.href = "https://example.com";
    anchor.textContent = "https://example.com";

    const result = dispatchThroughEditorTarget({
      eventName: "auxclick",
      target: anchor,
    });

    expect(result.suppressed).toBe(true);
    expect(result.event.defaultPrevented).toBe(true);
    expect(result.defaultAllowed).toBe(false);
  });

  it("does not cancel ordinary prompt editor clicks", () => {
    const span = document.createElement("span");
    span.textContent = "plain prompt text";

    const result = dispatchThroughEditorTarget({
      eventName: "click",
      target: span,
    });

    expect(result.suppressed).toBe(false);
    expect(result.event.defaultPrevented).toBe(false);
    expect(result.defaultAllowed).toBe(true);
  });
});

describe("arePromptEditorValuesEqual", () => {
  it("compares cloned mention values without serializing the prompt text", () => {
    const mention: ComposerMention = {
      from: 4,
      to: 10,
      kind: "path",
      source: "workspace",
      entryKind: "file",
      path: "src/a.ts",
      label: "a.ts",
    };
    const left = { text: "see @a.ts", mentions: [mention] };

    expect(
      arePromptEditorValuesEqual(left, {
        text: left.text,
        mentions: [{ ...mention }],
      }),
    ).toBe(true);
    expect(
      arePromptEditorValuesEqual(left, {
        text: left.text,
        mentions: [{ ...mention, path: "src/b.ts" }],
      }),
    ).toBe(false);
  });

  it("treats a mention with reordered keys as the same mention", () => {
    const mention: ComposerMention = {
      from: 0,
      to: 5,
      kind: "plugin",
      pluginId: "sample",
      icon: null,
      provider: "people",
      id: "alice",
      label: "Alice",
    };
    const reordered: ComposerMention = {
      label: "Alice",
      id: "alice",
      provider: "people",
      icon: null,
      pluginId: "sample",
      kind: "plugin",
      to: 5,
      from: 0,
    };

    expect(
      arePromptEditorValuesEqual(
        { text: "Alice", mentions: [mention] },
        { text: "Alice", mentions: [reordered] },
      ),
    ).toBe(true);
  });
});
