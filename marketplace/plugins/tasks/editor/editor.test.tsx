// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createEditorExtensions } from "./extensions.js";
import { TasksEditor } from "./tasks-editor.js";

afterEach(cleanup);

function roundTrip(markdown: string): string {
  const editor = new Editor({
    extensions: createEditorExtensions(),
    content: markdown,
  });
  try {
    return editor.storage.markdown.getMarkdown() as string;
  } finally {
    editor.destroy();
  }
}

describe("markdown round-trip", () => {
  const cases: Array<[string, string]> = [
    ["paragraphs", "First paragraph.\n\nSecond paragraph."],
    ["headings", "# Title\n\n## Section\n\n### Subsection"],
    ["marks", "Some **bold**, *italic*, ~~struck~~, and `inline code` text."],
    ["bullet list", "- one\n- two\n- three"],
    ["ordered list", "1. first\n2. second"],
    ["nested bullets", "- parent\n  - child"],
    ["task list", "- [ ] open task\n- [x] done task"],
    ["code block", "```ts\nconst answer = 42;\n```"],
    ["blockquote", "> quoted wisdom"],
    ["link", "Read the [bb guide](https://example.com/guide)."],
    ["image", "![diagram](https://example.com/diagram.png)"],
    ["mention", "Blocked on [TSK-42](bbtask://TSK-42) for review."],
    [
      "mixed document",
      "## Plan\n\nShip the **editor** with `tiptap`.\n\n- [x] parse\n- [ ] serialize\n\n> Notes on [TSK-7](bbtask://TSK-7)\n\n```\nplain code\n```",
    ],
  ];
  it.each(cases)("preserves %s", (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });
});

describe("mention extension", () => {
  it("parses a bbtask link into a pill node and serializes it back", () => {
    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: "Ping [TSK-42](bbtask://TSK-42) today.",
    });
    const findMentions = () => {
      const found: Array<Record<string, unknown>> = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "taskMention")
          found.push(node.attrs as Record<string, unknown>);
      });
      return found;
    };
    try {
      expect(findMentions()).toEqual([{ key: "TSK-42", label: "TSK-42" }]);
      const pill = editor.view.dom.querySelector(
        '[data-task-mention="TSK-42"]',
      );
      expect(pill?.classList.contains("bb-tasks-mention")).toBe(true);
      expect(pill?.textContent).toBe("TSK-42");
      // A regular link must still parse as a link mark, not a mention.
      editor.commands.setContent("[docs](https://example.com)");
      expect(findMentions()).toEqual([]);
      expect(editor.storage.markdown.getMarkdown()).toBe(
        "[docs](https://example.com)",
      );
    } finally {
      editor.destroy();
    }
  });

  it("suggests and inserts mentions from the mentionItems prop", async () => {
    let instance: Editor | null = null;
    const onChange = vi.fn();
    const screen = render(
      <TasksEditor
        value=""
        onChange={onChange}
        mentionItems={(query) =>
          Promise.resolve(
            [
              { id: "1", key: "TSK-42", title: "Round-trip review" },
              { id: "2", key: "TSK-7", title: "Detail panel" },
            ].filter((item) => item.key.toLowerCase().includes(query.toLowerCase())),
          )
        }
        onEditorReady={(editor) => {
          instance = editor;
        }}
      />,
    );
    expect(instance).not.toBeNull();
    instance!.chain().focus().insertContent("@").run();
    const option = await screen.findByText("Round-trip review");
    fireEvent.click(option.closest("button")!);
    // The command inserts the pill plus a trailing space to keep typing.
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("[TSK-42](bbtask://TSK-42) "),
    );
    expect(
      screen.container.querySelector('[data-task-mention="TSK-42"]'),
    ).toBeTruthy();
  });

  it("stays inert without a mentionItems prop", async () => {
    let instance: Editor | null = null;
    const screen = render(
      <TasksEditor
        value=""
        onChange={() => undefined}
        onEditorReady={(editor) => {
          instance = editor;
        }}
      />,
    );
    instance!.chain().focus().insertContent("@").run();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("TasksEditor component", () => {
  it("renders checklists and reports checkbox toggles as markdown", async () => {
    const onChange = vi.fn();
    const screen = render(
      <TasksEditor value={"- [ ] write tests"} onChange={onChange} />,
    );
    const checkbox = screen.container.querySelector<HTMLInputElement>(
      'ul[data-type="taskList"] input[type="checkbox"]',
    );
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox!);
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("- [x] write tests"),
    );
  });

  it("renders read-only without a toolbar or editable surface", () => {
    const screen = render(
      <TasksEditor
        value={"**Done** deal"}
        onChange={() => undefined}
        readOnly
        variant="comment"
      />,
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
    const surface = screen.container.querySelector(".tiptap");
    expect(surface?.getAttribute("contenteditable")).toBe("false");
    expect(surface?.querySelector("strong")?.textContent).toBe("Done");
    expect(
      screen.container.querySelector('[data-variant="comment"]'),
    ).toBeTruthy();
  });

  it("replaces the document when the value prop changes externally", async () => {
    const onChange = vi.fn();
    const screen = render(
      <TasksEditor value={"original"} onChange={onChange} />,
    );
    screen.rerender(<TasksEditor value={"replaced"} onChange={onChange} />);
    await screen.findByText("replaced");
    // Echoing our own onChange output back must not reset the document.
    expect(onChange).not.toHaveBeenCalled();
  });
});
