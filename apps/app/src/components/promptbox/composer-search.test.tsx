// @vitest-environment jsdom

import { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  experimental_ComposerRoot as ComposerRoot,
  experimental_useComposerRenderer as useComposerRenderer,
  type ExperimentalComposerEditor,
} from "@get-bb/plugin-sdk/app";
import { ComposerRendererTestHost } from "@/test/fixtures/composer-renderer";
import {
  composerSearchQueries,
  setComposerSearchResults,
  testTypeaheadConfig,
} from "@/test/fixtures/composer-search";

vi.mock("@/hooks/usePromptMentions", async () =>
  (await import("@/test/fixtures/composer-search")).fakePromptMentionsModule(),
);
vi.mock("@/hooks/useCommandSuggestions", async () =>
  (
    await import("@/test/fixtures/composer-search")
  ).fakeCommandSuggestionsModule(),
);

afterEach(cleanup);

function TriggerProbe() {
  const { input } = useComposerRenderer();
  return (
    <output>
      {`${input.mentionTriggers.join(" ")}|${input.commandTriggers.join(" ")}`}
    </output>
  );
}

const EDITOR: ExperimentalComposerEditor = {
  state: {
    layout: "expanded",
    isRunning: false,
    isSubmitting: false,
    isSubmittingBlocked: false,
    submittingBlockedReason: null,
    isAttaching: false,
    attachmentError: null,
  },
  insertAtCursor: () => false,
  focus: () => false,
  focusEnd: () => {},
  acceptsThreadDrop: () => false,
  insertDroppedThreads: () => {},
  openPopup: () => false,
  closePopup: () => false,
  isPopupOpen: () => false,
};

function EditorProbe() {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rootRef}>
      <ComposerRoot rootRef={rootRef} editor={EDITOR} />
      <textarea aria-label="Message" />
    </div>
  );
}

describe("composer search", () => {
  it("never hands a composer a command trigger that is also a mention trigger", () => {
    render(
      <ComposerRendererTestHost
        typeahead={testTypeaheadConfig({
          mentionTriggers: ["@", "$"],
          commandTriggers: ["/", "$"],
        })}
      >
        <TriggerProbe />
      </ComposerRendererTestHost>,
    );

    expect(screen.getByRole("status").textContent).toBe("@ $|/");
  });

  it("starts loading commands when focus enters the composer", () => {
    setComposerSearchResults();
    render(
      <ComposerRendererTestHost
        typeahead={testTypeaheadConfig({ commandTriggers: ["/"] })}
      >
        <EditorProbe />
      </ComposerRendererTestHost>,
    );
    expect(composerSearchQueries.commandPrefetch).toHaveBeenLastCalledWith(
      false,
    );

    fireEvent.focusIn(screen.getByRole("textbox"));

    expect(composerSearchQueries.commandPrefetch).toHaveBeenLastCalledWith(
      true,
    );
  });
});
