import type { IDisposable, Terminal as XTermTerminal } from "@xterm/xterm";
import type { TrackedTerminalCommandBlock } from "./terminal-command-block-tracker";

const DECORATION_RENDERED_FLAG = "bbCommandBlockRendered";

export interface RegisterTerminalCommandBlockActionArgs {
  block: TrackedTerminalCommandBlock;
  label: string;
  onActivate: (block: TrackedTerminalCommandBlock) => void;
  terminal: XTermTerminal;
}

export function terminalCommandBlockActionTitle(
  block: TrackedTerminalCommandBlock,
): string {
  const exit =
    block.exitCode === null || block.exitCode === 0
      ? ""
      : ` (exit ${block.exitCode})`;
  return `Add "${block.command}"${exit} and its output to chat`;
}

function buildActionElement(
  args: RegisterTerminalCommandBlockActionArgs,
): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "pointer-events-auto absolute right-1 top-0 flex items-center gap-1 rounded border border-border bg-background/90 px-1.5 text-xs leading-tight text-muted-foreground opacity-40 transition-opacity hover:opacity-100 focus-visible:opacity-100";
  button.textContent = "Add to chat";
  button.title = terminalCommandBlockActionTitle(args.block);
  button.setAttribute(
    "aria-label",
    terminalCommandBlockActionTitle(args.block),
  );
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    args.onActivate(args.block);
  });
  return button;
}

export function registerTerminalCommandBlockAction(
  args: RegisterTerminalCommandBlockActionArgs,
): IDisposable | null {
  const decoration = args.terminal.registerDecoration({
    height: 1,
    marker: args.block.promptMarker,
    width: args.terminal.cols,
    x: 0,
  });
  if (decoration === undefined) {
    return null;
  }
  decoration.onRender((element) => {
    if (element.dataset[DECORATION_RENDERED_FLAG] === "true") {
      return;
    }
    element.dataset[DECORATION_RENDERED_FLAG] = "true";
    element.classList.add("pointer-events-none", "relative");
    element.append(buildActionElement(args));
  });
  return decoration;
}
