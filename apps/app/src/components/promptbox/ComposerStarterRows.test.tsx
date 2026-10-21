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
import {
  COMPOSER_STARTERS,
  ComposerStarterRows,
  composerStarterAccessibleName,
} from "./ComposerStarterRows";

const mocks = vi.hoisted(() => ({
  useSystemConfig: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.useSystemConfig,
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
  flag?: boolean;
  isProjectless?: boolean;
  threadCount?: number | null;
  text?: string;
}

function arrange({
  flag = true,
  isProjectless = false,
  threadCount = 0,
  text = "",
}: ArrangeArgs = {}) {
  mocks.useSystemConfig.mockReturnValue({
    data: { featureFlags: { composerStarterRows: flag } },
  });
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
  it("renders every starter when the flag is on, the composer is empty, a project is selected, and no thread exists", () => {
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
    ["the flag is off", { flag: false }],
    ["no project is selected", { isProjectless: true }],
    ["a thread already exists", { threadCount: 1 }],
    ["threads have not loaded", { threadCount: null }],
    ["the composer has text", { text: "Hello" }],
  ])("renders nothing when %s", (_label, args) => {
    arrange(args);

    expect(screen.queryByText("Try asking")).toBeNull();
    expect(starterButtons().every((button) => button === null)).toBe(true);
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
});
