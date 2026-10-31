import { getHTMLFromFragment } from "@tiptap/core";
import Table from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";

export const TightTaskList = TaskList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tight: {
        default: true,
        parseHTML: (element) =>
          element.getAttribute("data-tight") === "true" ||
          !element.querySelector("p"),
        renderHTML: (attributes) => ({
          "data-tight": attributes.tight ? "true" : null,
        }),
      },
    };
  },
});

interface TableMarkdownState {
  out: string;
  inTable: boolean;
  write(value: string): void;
  ensureNewLine(): void;
  closeBlock(node: ProseMirrorNode): void;
  render(node: ProseMirrorNode, parent: ProseMirrorNode, index: number): void;
  renderInline(node: ProseMirrorNode): void;
}

function tableChildren(node: ProseMirrorNode): readonly ProseMirrorNode[] {
  return node.content.content;
}

function hasMergedCell(node: ProseMirrorNode): boolean {
  return node.attrs.colspan > 1 || node.attrs.rowspan > 1;
}

function isMarkdownTable(node: ProseMirrorNode): boolean {
  const [header, ...body] = tableChildren(node);
  if (!header) return false;
  if (
    tableChildren(header).some(
      (cell) =>
        cell.type.name !== "tableHeader" ||
        hasMergedCell(cell) ||
        cell.childCount > 1,
    )
  ) {
    return false;
  }
  return !body.some((row) =>
    tableChildren(row).some(
      (cell) =>
        cell.type.name === "tableHeader" ||
        hasMergedCell(cell) ||
        cell.childCount > 1,
    ),
  );
}

function renderTableCell(
  state: TableMarkdownState,
  cell: ProseMirrorNode,
): void {
  const content = cell.firstChild;
  if (!content) return;
  const start = state.out.length;
  if (content.type.name === "image") state.render(content, cell, 0);
  else if (content.childCount > 0) state.renderInline(content);
  state.out =
    state.out.slice(0, start) + state.out.slice(start).replaceAll("|", "\\|");
}

export const MarkdownTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: TableMarkdownState, node: ProseMirrorNode) {
          if (!isMarkdownTable(node)) {
            state.write(
              getHTMLFromFragment(Fragment.from(node), node.type.schema),
            );
            state.closeBlock(node);
            return;
          }

          state.inTable = true;
          node.forEach((row, _offset, rowIndex) => {
            state.write("| ");
            row.forEach((cell, _cellOffset, cellIndex) => {
              if (cellIndex > 0) state.write(" | ");
              renderTableCell(state, cell);
            });
            state.write(" |");
            state.ensureNewLine();
            if (rowIndex === 0) {
              state.write(
                `| ${Array.from({ length: row.childCount }, () => "---").join(" | ")} |`,
              );
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {},
      },
    };
  },
});
