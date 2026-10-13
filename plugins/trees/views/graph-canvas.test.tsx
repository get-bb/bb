// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../src/model";
import type { NodeDraft } from "./node-draft-card";
import { GraphCanvas, NODE_HEIGHT, NODE_WIDTH } from "./graph-canvas";
import { DRAFT_HEIGHT } from "./node-draft-card";

afterEach(() => {
  cleanup();
});

function node(overrides: Partial<TreeNode>): TreeNode {
  return {
    id: "trn_1",
    projectId: "trp_1",
    title: "Parent",
    kind: "markdown",
    state: "ready",
    artifactFile: "01_parent.md",
    artifactPath: "/Trees/p/01_parent.md",
    summary: "",
    summaryStatus: "idle",
    summaryProblem: null,
    instruction: "",
    contextMode: "all_parents",
    handoff: "summary",
    baseBranch: null,
    customBrief: "",
    contextIncludes: [],
    workspace: { kind: "tree" },
    threadId: null,
    dependsOn: [],
    x: 0,
    y: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const parent = node({});
const child = node({
  id: "trn_2",
  title: "Child",
  artifactFile: "02_child.md",
  x: 0,
  y: 300,
});

function setup(
  overrides: {
    nodes?: TreeNode[];
    selectedNodeId?: string | null;
    draft?: NodeDraft | null;
  } = {},
) {
  const handlers = {
    onSelect: vi.fn(),
    onMove: vi.fn(),
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onDraftOpen: vi.fn(),
    onDraftCancel: vi.fn(),
    onDraftSubmit: vi.fn(),
  };
  render(
    <GraphCanvas
      nodes={overrides.nodes ?? [parent, child]}
      now={Date.parse("2026-09-22T12:00:00.000Z")}
      selectedNodeId={overrides.selectedNodeId ?? null}
      draft={overrides.draft ?? null}
      busy={false}
      {...handlers}
    />,
  );
  return handlers;
}

function cardOf(title: string): HTMLElement {
  const card = screen.getByRole("button", { name: title }).parentElement;
  if (card === null) throw new Error(`no card for ${title}`);
  return card;
}

function canvas(): HTMLElement {
  const card = cardOf("Parent");
  const surface = card.parentElement;
  if (surface === null) throw new Error("no canvas surface");
  return surface;
}

function viewport(): HTMLElement {
  const surface = canvas().parentElement?.parentElement;
  if (surface === undefined || surface === null) {
    throw new Error("no canvas viewport");
  }
  return surface;
}

function centerOf(target: TreeNode): { clientX: number; clientY: number } {
  return {
    clientX: target.x + NODE_WIDTH / 2,
    clientY: target.y + NODE_HEIGHT / 2,
  };
}

describe("GraphCanvas", () => {
  it("draws one card per task and one edge per dependency", () => {
    setup({ nodes: [parent, node({ ...child, dependsOn: [parent.id] })] });
    expect(screen.getByRole("button", { name: "Parent" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Child" })).toBeDefined();
    expect(document.querySelectorAll("svg path")).toHaveLength(1);
  });

  it("selects a task on a press that did not drag, without any click event", () => {
    const handlers = setup();
    const card = cardOf("Parent");
    fireEvent.pointerDown(card, {
      pointerId: 1,
      button: 0,
      ...centerOf(parent),
    });
    fireEvent.pointerUp(canvas(), { pointerId: 1, ...centerOf(parent) });
    expect(handlers.onSelect).toHaveBeenCalledWith(parent.id);
    expect(handlers.onMove).not.toHaveBeenCalled();
  });

  it("selects a task once when a click follows the press", () => {
    const handlers = setup();
    const card = cardOf("Parent");
    fireEvent.pointerDown(card, {
      pointerId: 1,
      button: 0,
      ...centerOf(parent),
    });
    fireEvent.pointerUp(canvas(), { pointerId: 1, ...centerOf(parent) });
    fireEvent.click(screen.getByRole("button", { name: "Parent" }));
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  });

  it("selects a task from the keyboard", () => {
    const handlers = setup();
    fireEvent.keyDown(screen.getByRole("button", { name: "Parent" }), {
      key: "Enter",
    });
    expect(handlers.onSelect).toHaveBeenCalledWith(parent.id);
  });

  it("moves a task to where it was dropped", () => {
    const handlers = setup();
    const card = cardOf("Parent");
    fireEvent.pointerDown(card, {
      pointerId: 1,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      clientX: 210,
      clientY: 90,
    });
    fireEvent.pointerUp(canvas(), { pointerId: 1, clientX: 210, clientY: 90 });
    expect(handlers.onMove).toHaveBeenCalledWith({
      nodeId: parent.id,
      x: 200,
      y: 80,
    });
  });

  it("does not select a task when the click follows a real drag", () => {
    const handlers = setup();
    const card = cardOf("Parent");
    fireEvent.pointerDown(card, {
      pointerId: 1,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      clientX: 210,
      clientY: 90,
    });
    fireEvent.pointerUp(canvas(), { pointerId: 1, clientX: 210, clientY: 90 });
    fireEvent.click(screen.getByRole("button", { name: "Parent" }));
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  /*
   * The handle under a task is both a link source and a create button, so the
   * press that does not travel has to read as the second one and nothing else.
   */
  it("opens a draft for a dependent task when the handle is pressed without dragging", () => {
    const handlers = setup();
    const handle = screen.getByRole("button", {
      name: /New task depending on Parent/u,
    });
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: NODE_HEIGHT,
    });
    fireEvent.pointerUp(canvas(), { pointerId: 1, ...centerOf(parent) });
    expect(handlers.onDraftOpen).toHaveBeenCalledWith({
      anchor: "child",
      nodeId: parent.id,
    });
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(handlers.onConnect).not.toHaveBeenCalled();
  });

  it.each([
    ["New parent task for Parent", "parent"],
    ["New task beside Parent", "sibling"],
  ])("opens a %s draft without selecting the task", (label, anchor) => {
    const handlers = setup();
    const handle = screen.getByRole("button", { name: label });
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0 });
    fireEvent.click(handle);
    expect(handlers.onDraftOpen).toHaveBeenCalledWith({
      anchor,
      nodeId: parent.id,
    });
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("offers the first task at the centre of an empty tree", () => {
    const handlers = setup({ nodes: [] });
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect(handlers.onDraftOpen).toHaveBeenCalledWith({ anchor: "canvas" });
    expect(screen.queryByRole("dialog", { name: "New task" })).toBeNull();
  });

  /*
   * A draft outlives the tree it was opened in. Anchored to a task that is no
   * longer there it has nowhere to sit, and an empty tree that answered with
   * neither a card nor a button would have no way left to add anything.
   */
  it("still invites a first task when a draft anchor has vanished", () => {
    const handlers = setup({
      nodes: [],
      draft: { anchor: "child", nodeId: "trn_gone" },
    });
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect(handlers.onDraftOpen).toHaveBeenCalledWith({ anchor: "canvas" });
  });

  it("submits nothing but the task itself, leaving the row to the layout", () => {
    const handlers = setup({ nodes: [], draft: { anchor: "canvas" } });
    fireEvent.change(screen.getByLabelText("New task title"), {
      target: { value: "Spec" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(handlers.onDraftSubmit).toHaveBeenCalledWith({
      title: "Spec",
      kind: "agent",
    });
  });

  /*
   * The draft's place on the canvas shows the relationship being drawn, not
   * where the task will end up, so it is the drawing that has to be right.
   */
  it.each([
    ["child" as const, { left: "0px", top: `${NODE_HEIGHT + 32}px` }],
    ["sibling" as const, { left: `${NODE_WIDTH + 32}px`, top: "0px" }],
  ])("draws a %s draft beside the task it grew from", (anchor, expected) => {
    setup({ draft: { anchor, nodeId: parent.id } });
    const card = screen.getByRole("dialog", {
      name: "New task",
    }).parentElement!;
    expect([card.style.left, card.style.top]).toEqual([
      expected.left,
      expected.top,
    ]);
  });

  /*
   * There is no room above a task already on the top row, so the canvas slides
   * down to make the preview readable until the layout makes it real.
   */
  it("makes room above the top row for a parent draft", () => {
    setup({ draft: { anchor: "parent", nodeId: parent.id } });
    const card = screen.getByRole("dialog", {
      name: "New task",
    }).parentElement!;
    expect(card.style.top).toBe("0px");

    const shifted = cardOf("Parent").parentElement!;
    expect(shifted.style.transform).toBe(`translateY(${DRAFT_HEIGHT + 32}px)`);
  });

  /*
   * A select would open a native popup over the canvas to offer one of two
   * words, and hide the other until it did.
   */
  it("offers both kinds on the card, with the current one marked", () => {
    setup({ draft: { anchor: "child", nodeId: parent.id } });
    const note = screen.getByRole("radio", { name: "Note" });
    const agent = screen.getByRole("radio", { name: "Agent" });
    expect((note as HTMLInputElement).checked).toBe(true);
    expect((agent as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("combobox")).toBeNull();

    fireEvent.click(agent);
    expect((agent as HTMLInputElement).checked).toBe(true);
    expect((note as HTMLInputElement).checked).toBe(false);
  });

  it("names the dependency a draft will create", () => {
    setup({ draft: { anchor: "child", nodeId: parent.id } });
    expect(screen.getByText("Depends on Parent")).toBeDefined();
  });

  /*
   * A disabled button that fills the card is most of what made the draft look
   * like a form, so there is nothing to submit until the task has a name.
   */
  it("offers nothing to submit until the task is named", () => {
    const handlers = setup({ draft: { anchor: "child", nodeId: parent.id } });
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();

    fireEvent.change(screen.getByLabelText("New task title"), {
      target: { value: "   " },
    });
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();

    fireEvent.change(screen.getByLabelText("New task title"), {
      target: { value: "Next" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(handlers.onDraftSubmit).toHaveBeenCalledTimes(1);
  });

  it("creates a dependency when the handle is dropped on another task", () => {
    const handlers = setup();
    const handle = screen.getByRole("button", {
      name: /New task depending on Parent/u,
    });
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: NODE_HEIGHT,
    });
    fireEvent.pointerMove(canvas(), { pointerId: 1, ...centerOf(child) });
    fireEvent.pointerUp(canvas(), { pointerId: 1, ...centerOf(child) });
    expect(handlers.onConnect).toHaveBeenCalledWith({
      parentId: parent.id,
      childId: child.id,
    });
    expect(handlers.onMove).not.toHaveBeenCalled();
  });

  it("creates nothing when the handle is dropped on empty canvas", () => {
    const handlers = setup();
    const handle = screen.getByRole("button", {
      name: /New task depending on Parent/u,
    });
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: NODE_HEIGHT,
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      clientX: 600,
      clientY: 600,
    });
    fireEvent.pointerUp(canvas(), { pointerId: 1, clientX: 600, clientY: 600 });
    expect(handlers.onConnect).not.toHaveBeenCalled();
  });

  it("creates nothing when the handle is dragged back onto its own task", () => {
    const handlers = setup();
    const handle = screen.getByRole("button", {
      name: /New task depending on Parent/u,
    });
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: NODE_HEIGHT,
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      clientX: 140,
      clientY: 60,
    });
    fireEvent.pointerUp(canvas(), { pointerId: 1, ...centerOf(parent) });
    expect(handlers.onConnect).not.toHaveBeenCalled();
    expect(handlers.onDraftOpen).not.toHaveBeenCalled();
  });

  it("offers edge removal only around the selected task", () => {
    const linked = node({ ...child, dependsOn: [parent.id] });
    const { onDisconnect } = setup({
      nodes: [parent, linked],
      selectedNodeId: linked.id,
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove the dependency from Parent to Child",
      }),
    );
    expect(onDisconnect).toHaveBeenCalledWith({
      parentId: parent.id,
      childId: linked.id,
    });

    cleanup();
    setup({ nodes: [parent, linked], selectedNodeId: null });
    expect(
      screen.queryByRole("button", { name: /Remove the dependency/u }),
    ).toBeNull();
  });

  it("ignores pointer events from a second pointer mid-drag", () => {
    const handlers = setup();
    const card = cardOf("Parent");
    fireEvent.pointerDown(card, {
      pointerId: 1,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 2,
      clientX: 400,
      clientY: 400,
    });
    fireEvent.pointerUp(canvas(), { pointerId: 2, clientX: 400, clientY: 400 });
    expect(handlers.onMove).not.toHaveBeenCalled();
  });

  it("ignores a non-primary mouse button", () => {
    const handlers = setup();
    const card = cardOf("Parent");
    fireEvent.pointerDown(card, {
      pointerId: 1,
      button: 2,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      clientX: 210,
      clientY: 90,
    });
    fireEvent.pointerUp(canvas(), { pointerId: 1, clientX: 210, clientY: 90 });
    expect(handlers.onMove).not.toHaveBeenCalled();
  });

  it("pans the view when empty canvas is dragged", () => {
    const handlers = setup();
    const view = viewport();
    view.scrollLeft = 100;
    view.scrollTop = 100;
    fireEvent.pointerDown(canvas(), {
      pointerId: 1,
      button: 0,
      clientX: 500,
      clientY: 500,
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      clientX: 470,
      clientY: 440,
    });
    fireEvent.pointerUp(canvas(), { pointerId: 1, clientX: 470, clientY: 440 });
    expect(view.scrollLeft).toBe(130);
    expect(view.scrollTop).toBe(160);
    expect(handlers.onMove).not.toHaveBeenCalled();
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("pans instead of moving a task while space is held", () => {
    const handlers = setup();
    const view = viewport();
    view.scrollLeft = 0;
    view.scrollTop = 0;
    fireEvent.keyDown(document.body, { code: "Space" });
    fireEvent.pointerDown(cardOf("Parent"), {
      pointerId: 1,
      button: 0,
      ...centerOf(parent),
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      clientX: centerOf(parent).clientX - 40,
      clientY: centerOf(parent).clientY - 20,
    });
    fireEvent.pointerUp(canvas(), { pointerId: 1, ...centerOf(parent) });
    expect(view.scrollLeft).toBe(40);
    expect(view.scrollTop).toBe(20);
    expect(handlers.onMove).not.toHaveBeenCalled();
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("moves a task again once space is released", () => {
    const handlers = setup();
    fireEvent.keyDown(document.body, { code: "Space" });
    fireEvent.keyUp(document.body, { code: "Space" });
    fireEvent.pointerDown(cardOf("Parent"), {
      pointerId: 1,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      clientX: 210,
      clientY: 90,
    });
    fireEvent.pointerUp(canvas(), { pointerId: 1, clientX: 210, clientY: 90 });
    expect(handlers.onMove).toHaveBeenCalledWith({
      nodeId: parent.id,
      x: 200,
      y: 80,
    });
  });

  it("pans with the middle button without disturbing a task", () => {
    const handlers = setup();
    const view = viewport();
    view.scrollLeft = 0;
    view.scrollTop = 0;
    fireEvent.pointerDown(cardOf("Parent"), {
      pointerId: 1,
      button: 1,
      ...centerOf(parent),
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      clientX: centerOf(parent).clientX - 15,
      clientY: centerOf(parent).clientY - 25,
    });
    fireEvent.pointerUp(canvas(), { pointerId: 1, ...centerOf(parent) });
    expect(view.scrollLeft).toBe(15);
    expect(view.scrollTop).toBe(25);
    expect(handlers.onMove).not.toHaveBeenCalled();
  });

  it("leaves a dependency removal clickable on the canvas", () => {
    const linked = node({ ...child, dependsOn: [parent.id] });
    const { onDisconnect } = setup({
      nodes: [parent, linked],
      selectedNodeId: linked.id,
    });
    const remove = screen.getByRole("button", {
      name: "Remove the dependency from Parent to Child",
    });
    fireEvent.pointerDown(remove, { pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas(), { pointerId: 1 });
    fireEvent.click(remove);
    expect(onDisconnect).toHaveBeenCalledWith({
      parentId: parent.id,
      childId: linked.id,
    });
  });
});
