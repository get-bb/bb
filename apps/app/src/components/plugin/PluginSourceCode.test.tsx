// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectionAddToChatContext } from "@/components/thread/SelectionAddToChatContext";
import { PluginSourceCode } from "./PluginSourceCode";

const bbSourceCode = vi.hoisted(() => ({
  lastProps: null as Record<string, unknown> | null,
}));

vi.mock("@/components/code/BbSourceCode", async () => {
  const React = await import("react");
  return {
    default: (props: Record<string, unknown>) => {
      bbSourceCode.lastProps = props;
      return React.createElement(
        "div",
        { "data-testid": "bb-source-code" },
        "bb source",
      );
    },
  };
});

const CONTENT = "const a = 1;\nconst b = 2;\n";

beforeEach(() => {
  bbSourceCode.lastProps = null;
});

afterEach(() => {
  cleanup();
});

describe("experimental_SourceCode", () => {
  it("resolves presentation defaults for BB's renderer", async () => {
    render(<PluginSourceCode content={CONTENT} path="src/app.ts" />);

    await screen.findByTestId("bb-source-code");
    expect(bbSourceCode.lastProps?.overflow).toBe("scroll");
    expect(bbSourceCode.lastProps?.highlightedLines).toBeNull();
  });

  it("offers Add to chat only inside a thread", async () => {
    const addToChat = vi.fn();
    const { unmount } = render(
      <PluginSourceCode content={CONTENT} path="src/app.ts" />,
    );
    await screen.findByTestId("bb-source-code");
    expect(bbSourceCode.lastProps?.onSelectionAddToChat).toBeUndefined();
    unmount();

    render(
      <SelectionAddToChatContext.Provider value={addToChat}>
        <PluginSourceCode content={CONTENT} path="src/app.ts" />
      </SelectionAddToChatContext.Provider>,
    );
    await screen.findByTestId("bb-source-code");
    expect(bbSourceCode.lastProps?.onSelectionAddToChat).toBe(addToChat);
  });
});
