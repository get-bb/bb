// @vitest-environment jsdom
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedDestinationChooser } from "./SharedDestinationChooser";

const { useThreadsMock } = vi.hoisted(() => ({ useThreadsMock: vi.fn() }));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThreads: useThreadsMock,
}));

const projects = [
  { id: "project-a", name: "Project A" },
  { id: "project-b", name: "Project B" },
];
const recentThread = makeThreadListEntry({
  id: "thread-recent",
  projectId: "project-a",
  title: "Recently active",
  updatedAt: 20,
});
const olderThread = makeThreadListEntry({
  id: "thread-older",
  projectId: "project-a",
  title: "Older activity",
  updatedAt: 10,
});
const otherProjectThread = makeThreadListEntry({
  id: "thread-project-b",
  projectId: "project-b",
  title: "Project B thread",
  updatedAt: 30,
});

function renderChooser(projectId = "project-a") {
  const onAddToThread = vi.fn();
  const onProjectChange = vi.fn();
  const onNewThread = vi.fn();
  const view = render(
    <SharedDestinationChooser
      projectId={projectId}
      projects={projects}
      onProjectChange={onProjectChange}
      onAddToThread={onAddToThread}
      onNewThread={onNewThread}
    />,
  );
  return { ...view, onAddToThread, onProjectChange, onNewThread };
}

beforeEach(() => {
  useThreadsMock.mockImplementation(({ projectId }: { projectId: string }) => ({
    data:
      projectId === "project-b"
        ? [otherProjectThread]
        : [olderThread, recentThread],
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }));
});

afterEach(() => cleanup());

describe("SharedDestinationChooser", () => {
  it("defaults to the most recently updated thread and waits for Add to chat", () => {
    const { onAddToThread } = renderChooser();

    expect(
      screen.getByRole("button", { name: "Recently active" }),
    ).toBeTruthy();
    expect(onAddToThread).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));

    expect(onAddToThread).toHaveBeenCalledWith("thread-recent");
  });

  it("uses the user's thread choice and selects from the newly chosen project's list", () => {
    const { onAddToThread, onProjectChange, rerender } = renderChooser();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Recently active" })[0]!,
    );
    fireEvent.click(screen.getByRole("option", { name: "Older activity" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
    expect(onAddToThread).toHaveBeenCalledWith("thread-older");
    onAddToThread.mockClear();
    rerender(
      <SharedDestinationChooser
        projectId="project-b"
        projects={projects}
        onProjectChange={onProjectChange}
        onAddToThread={onAddToThread}
        onNewThread={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Project B thread" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
    expect(onAddToThread).toHaveBeenCalledWith("thread-project-b");
  });

  it("does not confirm while the thread list failed or has no valid selection", () => {
    useThreadsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      refetch: vi.fn(),
    });
    const { rerender } = renderChooser();
    expect(
      (screen.getByRole("button", { name: "Add to chat" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    useThreadsMock.mockReturnValue({
      data: [],
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    });
    rerender(
      <SharedDestinationChooser
        projectId="project-a"
        projects={projects}
        onProjectChange={vi.fn()}
        onAddToThread={vi.fn()}
        onNewThread={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Add to chat" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
