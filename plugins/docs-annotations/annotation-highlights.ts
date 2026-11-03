import type { DocumentAnnotation } from "./contract.js";

type Boundary = { node: Text; offset: number };
type IndexedCharacter = { value: string; start: Boundary; end: Boundary };

const blockTags = new Set(
  "ADDRESS BLOCKQUOTE DD DIV DL DT FIGCAPTION FIGURE H1 H2 H3 H4 H5 H6 LI P PRE TD TH".split(
    " ",
  ),
);
const ignoredText =
  "button, input, textarea, script, style, [aria-hidden='true']";
let nextId = 0;
const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();

function normalizedIndex(root: Element) {
  const characters: IndexedCharacter[] = [];
  const append = (value: string, start: Boundary, end: Boundary) => {
    if (/\s/u.test(value)) {
      const previous = characters.at(-1);
      if (previous?.value === " ") previous.end = end;
      else characters.push({ value: " ", start, end });
      return;
    }
    characters.push({ value, start, end });
  };
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent && !node.parentElement?.closest(ignoredText)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let current: Node | null;
  while ((current = walker.nextNode())) nodes.push(current as Text);
  let previous: Text | undefined;
  const nearestBlock = (node: Text) => {
    for (
      let el = node.parentElement;
      el && el !== root;
      el = el.parentElement
    ) {
      if (blockTags.has(el.tagName)) return el;
    }
    return root;
  };
  for (const node of nodes) {
    if (previous && nearestBlock(previous) !== nearestBlock(node)) {
      append(
        " ",
        { node: previous, offset: previous.length },
        { node, offset: 0 },
      );
    }
    for (let offset = 0; offset < node.length; offset += 1) {
      append(
        node.data[offset]!,
        { node, offset },
        { node, offset: offset + 1 },
      );
    }
    previous = node;
  }
  return {
    characters,
    text: characters.map((character) => character.value).join(""),
  };
}

function findUniqueRange(root: Element, quote: string): Range | null {
  const needle = normalize(quote);
  if (!needle) return null;
  const { characters, text } = normalizedIndex(root);
  let match: Range | null = null;
  for (
    let index = text.indexOf(needle);
    index >= 0;
    index = text.indexOf(needle, index + 1)
  ) {
    if (match) return null;
    const first = characters[index];
    const last = characters[index + needle.length - 1];
    if (!first || !last) return null;
    match = document.createRange();
    match.setStart(first.start.node, first.start.offset);
    match.setEnd(last.end.node, last.end.offset);
  }
  return match;
}

function matches(range: Range, quote: string) {
  return (
    range.startContainer.isConnected &&
    range.endContainer.isConnected &&
    normalize(range.toString()) === normalize(quote)
  );
}

function contains(range: Range, x: number, y: number) {
  const rects = range.getClientRects();
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects.item(index);
    if (
      rect &&
      x >= rect.left - 1 &&
      x <= rect.right + 1 &&
      y >= rect.top - 1 &&
      y <= rect.bottom + 1
    ) {
      return true;
    }
  }
  return false;
}

export class AnnotationHighlights {
  private readonly names = {
    comment: `docs-annotations-${++nextId}`,
    pending: `docs-annotations-pending-${nextId}`,
    active: `docs-annotations-active-${nextId}`,
  };
  private readonly exact = new Map<string, Range>();
  private readonly resolved = new Map<string, Range>();
  private annotations: DocumentAnnotation[] = [];
  private pending: Range | null = null;
  private activeId: string | null = null;
  private hoveredId: string | null = null;
  private refreshFrame = 0;
  private readonly style = document.createElement("style");
  private readonly observer: MutationObserver;
  private readonly onClick: EventListener;
  private readonly onMove: EventListener;

  constructor(
    private readonly root: HTMLElement,
    private readonly onOpen: (id: string, range: Range) => void,
  ) {
    this.style.textContent = `
      ::highlight(${this.names.comment}) {
        background-color: color-mix(in oklab, var(--primary) 16%, transparent);
        text-decoration: underline 1.5px color-mix(in oklab, var(--primary) 70%, transparent);
        text-underline-offset: 3px;
      }
      ::highlight(${this.names.active}) {
        background-color: color-mix(in oklab, var(--primary) 30%, transparent);
        text-decoration: underline 2px var(--primary);
        text-underline-offset: 3px;
      }
      ::highlight(${this.names.pending}) {
        background-color: color-mix(in oklab, var(--primary) 22%, transparent);
      }
    `;
    document.head.append(this.style);
    this.observer = new MutationObserver(() => this.scheduleRefresh());
    this.observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    this.onMove = (rawEvent) => {
      const event = rawEvent as PointerEvent;
      const id = this.hitTest(event.clientX, event.clientY);
      if (id === this.hoveredId) return;
      this.hoveredId = id;
      root.style.cursor = id ? "pointer" : "";
      this.refresh();
    };
    this.onClick = (rawEvent) => {
      const event = rawEvent as MouseEvent;
      if (event.button !== 0 || !window.getSelection()?.isCollapsed) return;
      const target = event.target as Element | null;
      if (
        target?.closest(
          "a, button, input, textarea, [data-docs-annotation-card]",
        )
      )
        return;
      const id = this.hitTest(event.clientX, event.clientY);
      const range = id ? this.resolved.get(id) : undefined;
      if (id && range) this.onOpen(id, range);
    };
    root.addEventListener("pointermove", this.onMove, { passive: true });
    root.addEventListener("click", this.onClick);
  }

  update(annotations: DocumentAnnotation[]) {
    this.annotations = annotations;
    const ids = new Set(annotations.map((annotation) => annotation.id));
    for (const id of this.exact.keys()) if (!ids.has(id)) this.exact.delete(id);
    this.refresh();
  }

  pin(id: string, range: Range) {
    this.exact.set(id, range);
    this.refresh();
  }

  setPending(range: Range | null) {
    this.pending = range;
    this.refresh();
  }

  setActive(id: string | null) {
    this.activeId = id;
    this.refresh();
  }

  rangeFor(id: string) {
    return this.resolved.get(id) ?? null;
  }

  destroy() {
    this.observer.disconnect();
    cancelAnimationFrame(this.refreshFrame);
    this.root.removeEventListener("pointermove", this.onMove);
    this.root.removeEventListener("click", this.onClick);
    this.root.style.cursor = "";
    this.style.remove();
    if (typeof CSS !== "undefined" && "highlights" in CSS) {
      for (const name of Object.values(this.names)) CSS.highlights.delete(name);
    }
    this.exact.clear();
    this.resolved.clear();
  }

  private hitTest(x: number, y: number) {
    for (const [id, range] of this.resolved)
      if (contains(range, x, y)) return id;
    return null;
  }

  private scheduleRefresh() {
    if (this.refreshFrame) return;
    this.refreshFrame = requestAnimationFrame(() => {
      this.refreshFrame = 0;
      this.refresh();
    });
  }

  private refresh() {
    this.resolved.clear();
    for (const annotation of this.annotations) {
      const captured = this.exact.get(annotation.id);
      const range =
        captured && matches(captured, annotation.quote)
          ? captured
          : findUniqueRange(this.root, annotation.quote);
      if (range) {
        this.resolved.set(annotation.id, range);
        this.exact.set(annotation.id, range);
      }
    }
    if (
      typeof CSS === "undefined" ||
      !("highlights" in CSS) ||
      typeof Highlight === "undefined"
    )
      return;
    const emphasizedId = this.activeId ?? this.hoveredId;
    const normal = [...this.resolved]
      .filter(([id]) => id !== emphasizedId)
      .map(([, range]) => range);
    const emphasized = emphasizedId
      ? this.resolved.get(emphasizedId)
      : undefined;
    const set = (name: string, ranges: Range[]) => {
      if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
      else CSS.highlights.delete(name);
    };
    set(this.names.comment, normal);
    set(this.names.active, emphasized ? [emphasized] : []);
    set(
      this.names.pending,
      this.pending?.startContainer.isConnected ? [this.pending] : [],
    );
  }
}
