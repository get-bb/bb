// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { makeSidebarBootstrapResponse } from "@/test/fixtures/projects";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";
import {
  COMPOSER_STARTERS,
  ComposerStarterRows,
  composerStarterAccessibleName,
} from "./ComposerStarterRows";

vi.mock("@/components/onboarding/onboarding-telemetry", () => ({
  recordTelemetryEvent: vi.fn(),
}));

const promptDraft = getPromptDraftAccessor({
  kind: "plugin-new-thread",
  key: "composer-starter-rows-test",
});

function navigationWithThreads(threadCount: number) {
  const navigation = makeSidebarBootstrapResponse();
  return {
    ...navigation,
    personalProject: {
      ...navigation.personalProject,
      threads: Array.from({ length: threadCount }, (_, index) =>
        makeThreadListEntry({ id: `thr_${index}` }),
      ),
    },
  };
}

interface ArrangeArgs {
  isProjectless?: boolean;
  isSubmitting?: boolean;
  threadCount?: number | null;
  text?: string;
}

function arrange({
  isProjectless = false,
  isSubmitting = false,
  threadCount = 0,
  text = "",
}: ArrangeArgs = {}) {
  promptDraft.setTextAndMentions(text, []);
  const focus = vi.fn();
  const submit = vi.fn((event: { preventDefault: () => void }) =>
    event.preventDefault(),
  );
  render(
    <form onSubmit={submit}>
      <ComposerStarterRows
        promptDraft={promptDraft}
        focus={focus}
        isProjectless={isProjectless}
        isSubmitting={isSubmitting}
        sidebarNavigation={
          threadCount === null ? undefined : navigationWithThreads(threadCount)
        }
      />
    </form>,
  );
  return { focus, submit };
}

function starterButtons() {
  return COMPOSER_STARTERS.map((starter) =>
    screen.queryByRole("button", {
      name: composerStarterAccessibleName(starter),
    }),
  );
}

afterEach(() => {
  cleanup();
  promptDraft.clear();
  vi.clearAllMocks();
});

describe("ComposerStarterRows", () => {
  it("renders every starter when the composer is empty, a project is selected, and no thread exists", () => {
    arrange();

    expect(screen.getByText("Try asking")).toBeTruthy();
    expect(starterButtons().every((button) => button !== null)).toBe(true);
    expect(
      screen.getByRole("button", {
        name: "Fill the message box: Explain this codebase",
      }),
    ).toBeTruthy();
  });

  it.each<[string, ArrangeArgs]>([
    ["a thread already exists", { threadCount: 1 }],
    ["the first thread is being created", { isSubmitting: true }],
    ["threads have not loaded", { threadCount: null }],
    ["the composer has text", { text: "Hello" }],
  ])("renders nothing when %s", (_label, args) => {
    arrange(args);

    expect(screen.queryByText("Try asking")).toBeNull();
    expect(starterButtons().every((button) => button === null)).toBe(true);
  });

  it("offers only the starters that need no project when no project is selected", () => {
    arrange({ isProjectless: true });

    const visible = COMPOSER_STARTERS.filter(
      (starter) =>
        screen.queryByRole("button", {
          name: composerStarterAccessibleName(starter),
        }) !== null,
    ).map((starter) => starter.label);
    expect(visible).toEqual(["Make bb yours"]);
  });

  it("fills the composer draft and focuses it without submitting", () => {
    const { focus, submit } = arrange();
    const starter = COMPOSER_STARTERS[1]!;

    fireEvent.click(
      screen.getByRole("button", {
        name: composerStarterAccessibleName(starter),
      }),
    );

    expect(promptDraft.getCurrent().text).toBe(starter.prompt);
    expect(promptDraft.getCurrent().mentions).toEqual([]);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it("disappears once the composer has text", () => {
    arrange();
    expect(screen.getByText("Try asking")).toBeTruthy();

    act(() => {
      promptDraft.setTextAndMentions("Fix the build", []);
    });

    expect(screen.queryByText("Try asking")).toBeNull();
  });

  it("records each shown row once, and a click with the same suggestion ID", () => {
    const navigation = navigationWithThreads(0);
    const props = {
      promptDraft,
      focus: vi.fn(),
      isProjectless: true,
      isSubmitting: false,
      sidebarNavigation: navigation,
    };
    const { rerender } = render(<ComposerStarterRows {...props} />);
    rerender(<ComposerStarterRows {...props} isProjectless={false} />);

    const shown = vi
      .mocked(recordTelemetryEvent)
      .mock.calls.map(([event]) => event)
      .filter((event) => event.name === "suggestion_shown");
    expect(
      shown.map((event) =>
        event.name === "suggestion_shown" ? event.properties.kind : null,
      ),
    ).toEqual(["make_bb_yours", "explain_codebase", "fix_todo"]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Fill the message box: Fix a small TODO",
      }),
    );

    const fixTodoShown = shown.find(
      (event) =>
        event.name === "suggestion_shown" &&
        event.properties.kind === "fix_todo",
    );
    expect(vi.mocked(recordTelemetryEvent).mock.calls.at(-1)?.[0]).toEqual({
      name: "suggestion_accepted",
      properties: {
        surface: "starter_row",
        kind: "fix_todo",
        suggestion_analytics_id:
          fixTodoShown?.name === "suggestion_shown"
            ? fixTodoShown.properties.suggestion_analytics_id
            : "missing",
      },
    });
  });

  it("renders and records rows on origins without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: crypto.getRandomValues.bind(crypto),
      randomUUID: undefined,
    });
    try {
      arrange();

      expect(screen.getByText("Try asking")).toBeTruthy();
      const ids = vi
        .mocked(recordTelemetryEvent)
        .mock.calls.map(([event]) =>
          event.name === "suggestion_shown"
            ? event.properties.suggestion_analytics_id
            : null,
        );
      expect(ids).toHaveLength(3);
      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f-]{36}$/u);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
