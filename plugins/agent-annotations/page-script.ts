interface PageBridge {
  postMessage(data: unknown): void;
}

interface AnnotationPageState {
  active: boolean;
  count: number;
}

interface AnnotationController {
  activate(): AnnotationPageState;
  deactivate(): AnnotationPageState;
  state(): AnnotationPageState;
  setTheme(theme: Record<string, string>): void;
  clear(): AnnotationPageState;
}

interface PinnedAnnotation {
  id: string;
  number: number;
  comment: string;
  element: Element;
  pin: HTMLElement;
  outline: HTMLElement;
}

export const ANNOTATION_CONTROLLER_KEY = "__bbAgentAnnotations";

export const THEME_TOKENS = [
  "canvas",
  "ink",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "muted-foreground",
  "border",
  "ring",
  "state-hover",
  "font-sans",
  "font-mono",
  "radius",
] as const;

function installAgentAnnotations(
  bb: PageBridge | null,
  theme: Record<string, string>,
): AnnotationPageState {
  const existing: AnnotationController | undefined = Reflect.get(
    globalThis,
    "__bbAgentAnnotations",
  );
  if (existing !== undefined) {
    existing.setTheme(theme);
    return existing.state();
  }

  const attributePrefix = "data-bb-annotation-";
  const attributeKeys = [
    "id",
    "class",
    "role",
    "aria-label",
    "name",
    "type",
    "href",
    "src",
    "alt",
    "placeholder",
    "title",
    "data-testid",
  ];
  const styleKeys = [
    "display",
    "position",
    "width",
    "height",
    "margin",
    "padding",
    "gap",
    "color",
    "background-color",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "border",
    "border-radius",
  ];
  const css = `
    .hover, .outline, .label, .pin, .editor { position: fixed; box-sizing: border-box; }
    .hover { display: none; pointer-events: none; border: 1.5px solid var(--bb-primary); border-radius: 4px; background: color-mix(in oklab, var(--bb-primary) 10%, transparent); }
    .outline { pointer-events: none; border: 1.5px dashed color-mix(in oklab, var(--bb-primary) 70%, transparent); border-radius: 4px; }
    .label { display: none; pointer-events: none; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 6px; border-radius: 6px; background: var(--bb-primary); color: var(--bb-primary-foreground); font: 500 11px/16px var(--bb-font-mono, ui-monospace, monospace); }
    .pin { pointer-events: auto; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 999px; background: var(--bb-primary); color: var(--bb-primary-foreground); font: 600 11px/20px var(--bb-font-sans, system-ui, sans-serif); text-align: center; box-shadow: 0 0 0 2px var(--bb-canvas), 0 1px 4px rgb(0 0 0 / 0.3); cursor: pointer; padding: 0; border: 0; }
    .pin:focus-visible { outline: 2px solid var(--bb-ring); outline-offset: 2px; }
    .editor { pointer-events: auto; width: 320px; padding: 10px; border: 1px solid var(--bb-border); border-radius: calc(var(--bb-radius, 0.5rem) + 4px); background: var(--bb-popover); color: var(--bb-popover-foreground); box-shadow: 0 12px 32px rgb(0 0 0 / 0.22); font: 400 13px/20px var(--bb-font-sans, system-ui, sans-serif); }
    .editor-title { margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--bb-muted-foreground); font: 500 11px/16px var(--bb-font-mono, ui-monospace, monospace); }
    textarea { box-sizing: border-box; display: block; width: 100%; min-height: 72px; resize: vertical; margin: 0; padding: 6px 8px; border: 1px solid var(--bb-border); border-radius: calc(var(--bb-radius, 0.5rem) - 2px); background: transparent; color: inherit; font: inherit; outline: none; }
    textarea:focus { border-color: var(--bb-ring); }
    .actions { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
    .hint { margin-right: auto; color: var(--bb-muted-foreground); font-size: 11px; }
    button { height: 28px; padding: 0 10px; border: 1px solid transparent; border-radius: calc(var(--bb-radius, 0.5rem) - 2px); font: 500 12px/16px var(--bb-font-sans, system-ui, sans-serif); cursor: pointer; }
    .cancel { background: transparent; color: inherit; }
    .cancel:hover { background: var(--bb-state-hover); }
    .save { background: var(--bb-primary); color: var(--bb-primary-foreground); }
    .save:disabled { opacity: 0.5; cursor: default; }
  `;

  const host = document.createElement("bb-agent-annotations");
  host.style.cssText =
    "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
  const root = host.attachShadow({ mode: "open" });
  if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in root) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } else {
    const style = document.createElement("style");
    style.textContent = css;
    root.append(style);
  }
  const hoverBox = part("div", "hover");
  const hoverLabel = part("div", "label");
  root.append(hoverBox, hoverLabel);

  let active = false;
  let hovered: Element | null = null;
  let editor: HTMLElement | null = null;
  let nextNumber = 1;
  let frame = 0;
  const annotations: PinnedAnnotation[] = [];

  function part(tagName: string, className: string): HTMLElement {
    const node = document.createElement(tagName);
    node.className = className;
    return node;
  }

  function setTheme(next: Record<string, string>): void {
    for (const [name, value] of Object.entries(next)) {
      host.style.setProperty(name, value);
    }
  }

  function state(): AnnotationPageState {
    return { active, count: annotations.length };
  }

  function post(message: unknown): void {
    bb?.postMessage(message);
  }

  function escapeIdentifier(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
  }

  function collapse(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  function elementName(element: Element): string {
    const id = element.id.length > 0 ? `#${element.id}` : "";
    const classes = Array.from(element.classList)
      .slice(0, 2)
      .map((name) => `.${name}`)
      .join("");
    const text = collapse(element.textContent ?? "");
    const label =
      element.getAttribute("aria-label") ??
      (text.length > 0 && text.length <= 40 ? text : "");
    const suffix = label.length > 0 ? ` "${label.slice(0, 40)}"` : "";
    return `${element.tagName.toLowerCase()}${id}${classes}${suffix}`.slice(
      0,
      200,
    );
  }

  function selectorFor(element: Element): string {
    const segments: string[] = [];
    let current: Element | null = element;
    while (
      current !== null &&
      current !== document.documentElement &&
      segments.length < 8
    ) {
      if (
        current.id.length > 0 &&
        document.querySelectorAll(`#${escapeIdentifier(current.id)}`).length ===
          1
      ) {
        segments.unshift(`#${escapeIdentifier(current.id)}`);
        break;
      }
      const tagName = current.tagName;
      const parent: Element | null = current.parentElement;
      const siblings =
        parent === null
          ? []
          : Array.from(parent.children).filter(
              (child) => child.tagName === tagName,
            );
      const position = siblings.indexOf(current) + 1;
      segments.unshift(
        siblings.length > 1
          ? `${tagName.toLowerCase()}:nth-of-type(${position})`
          : tagName.toLowerCase(),
      );
      current = parent;
    }
    return segments.join(" > ").slice(0, 2000);
  }

  function describe(element: Element) {
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    const attributes: Record<string, string> = {};
    for (const key of attributeKeys) {
      const value = element.getAttribute(key);
      if (value !== null && value.length > 0) {
        attributes[key] = value.slice(0, 400);
      }
    }
    const styles: Record<string, string> = {};
    for (const key of styleKeys) {
      const value = computed.getPropertyValue(key);
      if (value.length > 0) {
        styles[key] = value.slice(0, 400);
      }
    }
    const visibleText =
      element instanceof HTMLElement && typeof element.innerText === "string"
        ? element.innerText
        : (element.textContent ?? "");
    return {
      tagName: element.tagName.toLowerCase().slice(0, 64),
      name: elementName(element),
      selector: selectorFor(element),
      text: collapse(visibleText).slice(0, 160),
      attributes,
      rect: {
        x: Math.round(rect.left + scrollX),
        y: Math.round(rect.top + scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      styles,
    };
  }

  function place(node: HTMLElement, rect: DOMRect): void {
    node.style.left = `${rect.left}px`;
    node.style.top = `${rect.top}px`;
    node.style.width = `${rect.width}px`;
    node.style.height = `${rect.height}px`;
  }

  function showHover(element: Element | null): void {
    hovered = element;
    if (element === null) {
      hoverBox.style.display = "none";
      hoverLabel.style.display = "none";
      return;
    }
    const rect = element.getBoundingClientRect();
    place(hoverBox, rect);
    hoverBox.style.display = "block";
    hoverLabel.textContent = `${elementName(element)}  ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    hoverLabel.style.display = "block";
    hoverLabel.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - 324))}px`;
    hoverLabel.style.top = `${rect.top > 26 ? rect.top - 24 : rect.bottom + 4}px`;
  }

  function targetAt(x: number, y: number): Element | null {
    for (const element of document.elementsFromPoint(x, y)) {
      if (
        element === host ||
        element === document.documentElement ||
        element === document.body
      ) {
        continue;
      }
      return element;
    }
    return null;
  }

  function reposition(): void {
    for (const annotation of annotations) {
      const rect = annotation.element.getBoundingClientRect();
      const visible =
        annotation.element.isConnected && rect.width + rect.height > 0;
      annotation.pin.style.display = visible ? "block" : "none";
      annotation.pin.style.left = `${rect.left}px`;
      annotation.pin.style.top = `${rect.top}px`;
      annotation.outline.style.display = visible && active ? "block" : "none";
      place(annotation.outline, rect);
    }
    if (hovered !== null && editor === null) {
      showHover(hovered);
    }
  }

  function tick(): void {
    frame = 0;
    reposition();
    syncLoop();
  }

  function syncLoop(): void {
    const needed = active || annotations.length > 0;
    if (needed && frame === 0) {
      frame = requestAnimationFrame(tick);
    } else if (!needed && frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  function closeEditor(): void {
    editor?.remove();
    editor = null;
  }

  function commit(element: Element, comment: string): void {
    const trimmed = comment.trim();
    if (trimmed.length === 0) {
      return;
    }
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    element.setAttribute(`${attributePrefix}${id}`, "");
    const number = nextNumber;
    nextNumber += 1;
    const pin = part("button", "pin");
    pin.setAttribute("type", "button");
    pin.setAttribute("aria-label", `Edit annotation ${number}`);
    pin.textContent = String(number);
    pin.title = trimmed;
    const outline = part("div", "outline");
    root.append(outline, pin);
    const annotation = {
      id,
      number,
      comment: trimmed.slice(0, 4000),
      element,
      pin,
      outline,
    };
    annotations.push(annotation);
    pin.addEventListener("click", () => openEditor(element, annotation));
    closeEditor();
    showHover(null);
    reposition();
    syncLoop();
    post({
      type: "annotation",
      annotation: {
        id,
        number,
        comment: trimmed.slice(0, 4000),
        url: location.href.slice(0, 4096),
        title: document.title.slice(0, 1024),
        viewport: { width: innerWidth, height: innerHeight },
        element: describe(element),
      },
    });
    post({ type: "state", ...state() });
  }

  function remove(annotation: PinnedAnnotation): void {
    const index = annotations.indexOf(annotation);
    if (index < 0) return;
    annotation.element.removeAttribute(`${attributePrefix}${annotation.id}`);
    annotation.pin.remove();
    annotation.outline.remove();
    annotations.splice(index, 1);
    closeEditor();
    showHover(null);
    syncLoop();
    post({ type: "annotation-delete", id: annotation.id });
    post({ type: "state", ...state() });
  }

  function update(annotation: PinnedAnnotation, comment: string): void {
    const trimmed = comment.trim().slice(0, 4000);
    if (trimmed.length === 0) {
      return;
    }
    annotation.comment = trimmed;
    annotation.pin.title = trimmed;
    closeEditor();
    showHover(null);
    post({ type: "annotation-update", id: annotation.id, comment: trimmed });
  }

  function openEditor(
    element: Element,
    annotation: PinnedAnnotation | null = null,
  ): void {
    closeEditor();
    showHover(element);
    const rect = element.getBoundingClientRect();
    const panel = part("div", "editor");
    const title = part("div", "editor-title");
    title.textContent = elementName(element);
    const textarea = document.createElement("textarea");
    textarea.placeholder = "What should change?";
    textarea.rows = 3;
    textarea.maxLength = 4000;
    textarea.value = annotation?.comment ?? "";
    textarea.setAttribute("aria-label", "Annotation comment");
    const submit = () =>
      annotation === null
        ? commit(element, textarea.value)
        : update(annotation, textarea.value);
    const actions = part("div", "actions");
    const hint = part("span", "hint");
    hint.textContent = `${/Mac/.test(navigator.platform) ? "⌘↵" : "Ctrl+↵"} to ${annotation === null ? "add" : "save"}`;
    const cancel = part("button", "cancel");
    cancel.textContent = "Cancel";
    const save = part("button", "save");
    save.textContent = annotation === null ? "Add to prompt" : "Save changes";
    save.toggleAttribute("disabled", textarea.value.trim().length === 0);
    if (annotation !== null) {
      const deleteButton = part("button", "cancel");
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => remove(annotation));
      actions.append(deleteButton);
    }
    actions.append(hint, cancel, save);
    panel.append(title, textarea, actions);
    root.append(panel);
    editor = panel;
    const width = 320;
    const below = rect.bottom + 8;
    panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    panel.style.top = `${below + 160 < innerHeight ? below : Math.max(8, rect.top - 168)}px`;
    textarea.addEventListener("input", () => {
      save.toggleAttribute("disabled", textarea.value.trim().length === 0);
    });
    textarea.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditor();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        submit();
      }
    });
    cancel.addEventListener("click", () => closeEditor());
    save.addEventListener("click", submit);
    textarea.focus();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!active || editor !== null || event.target === host) {
      return;
    }
    showHover(targetAt(event.clientX, event.clientY));
  }

  function swallow(event: Event): void {
    if (!active || event.target === host) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onClick(event: MouseEvent): void {
    if (!active || event.target === host) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (editor !== null) {
      closeEditor();
      return;
    }
    const target = targetAt(event.clientX, event.clientY);
    if (target !== null) {
      openEditor(target);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!active || event.key !== "Escape" || event.target === host) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (editor !== null) {
      closeEditor();
      return;
    }
    deactivate();
    post({ type: "state", ...state() });
  }

  function activate(): AnnotationPageState {
    if (!host.isConnected) {
      document.documentElement.append(host);
    }
    if (!active) {
      active = true;
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerdown", swallow, true);
      window.addEventListener("mousedown", swallow, true);
      window.addEventListener("mouseup", swallow, true);
      window.addEventListener("click", onClick, true);
      window.addEventListener("keydown", onKeyDown, true);
      reposition();
      syncLoop();
    }
    return state();
  }

  function deactivate(): AnnotationPageState {
    if (active) {
      active = false;
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerdown", swallow, true);
      window.removeEventListener("mousedown", swallow, true);
      window.removeEventListener("mouseup", swallow, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKeyDown, true);
      closeEditor();
      showHover(null);
      reposition();
      syncLoop();
    }
    return state();
  }

  function clear(): AnnotationPageState {
    closeEditor();
    showHover(null);
    for (const annotation of annotations) {
      annotation.element.removeAttribute(`${attributePrefix}${annotation.id}`);
      annotation.pin.remove();
      annotation.outline.remove();
    }
    annotations.length = 0;
    nextNumber = 1;
    syncLoop();
    return state();
  }

  const controller: AnnotationController = {
    activate,
    deactivate,
    state,
    setTheme,
    clear,
  };
  Reflect.set(globalThis, "__bbAgentAnnotations", controller);
  setTheme(theme);
  return state();
}

function probeReactComponents(annotationId: string) {
  const element = document.querySelector(
    `[data-bb-annotation-${annotationId}]`,
  );
  if (element === null) {
    return null;
  }
  const fiberKey = Object.keys(element).find(
    (key) =>
      key.startsWith("__reactFiber$") ||
      key.startsWith("__reactInternalInstance$"),
  );
  if (fiberKey === undefined) {
    return { components: [] };
  }
  const components: Array<{ name: string; source: string | null }> = [];
  let fiber = Reflect.get(element, fiberKey);
  let visited = 0;
  while (fiber && components.length < 12 && visited < 500) {
    visited += 1;
    const type = fiber.type;
    const candidate =
      typeof type === "function"
        ? type
        : type !== null && typeof type === "object"
          ? (type.render ?? type.type ?? type)
          : null;
    const name =
      candidate === null
        ? null
        : (type.displayName ?? candidate.displayName ?? candidate.name);
    if (typeof name === "string" && name.length > 0) {
      components.push({ name: name.slice(0, 200), source: sourceOf(fiber) });
    }
    fiber = fiber.return;
  }
  return { components };

  function sourceOf(node: {
    _debugSource?: { fileName?: unknown; lineNumber?: unknown };
    _debugStack?: { stack?: unknown };
  }): string | null {
    const debugSource = node._debugSource;
    if (debugSource !== undefined && typeof debugSource.fileName === "string") {
      return `${debugSource.fileName}:${String(debugSource.lineNumber)}`.slice(
        0,
        1000,
      );
    }
    const stack = node._debugStack?.stack;
    if (typeof stack !== "string") {
      return null;
    }
    const frameLine = stack
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("at "))
      .find(
        (line) =>
          !/react-stack-top-frame|jsx-dev-runtime|jsx-runtime|react-dom|node_modules/.test(
            line,
          ),
      );
    const match = frameLine?.match(/\(?((?:https?|file):\/\/[^\s)]+)\)?$/);
    return (
      match?.[1]?.replace(/\?[^:]*(?=:\d+:\d+$)/, "").slice(0, 1000) ?? null
    );
  }
}

export function buildActivateExpression(theme: Record<string, string>): string {
  return `((install) => { install(bb, ${JSON.stringify(theme)}); return globalThis.${ANNOTATION_CONTROLLER_KEY}.activate(); })(${installAgentAnnotations.toString()})`;
}

export function buildControllerExpression(
  method: "deactivate" | "state" | "clear",
): string {
  return `globalThis.${ANNOTATION_CONTROLLER_KEY} ? globalThis.${ANNOTATION_CONTROLLER_KEY}.${method}() : { active: false, count: 0 }`;
}

export function buildReactProbeExpression(annotationId: string): string {
  if (!/^[a-z0-9]+$/.test(annotationId)) {
    throw new Error(`Invalid annotation id: ${annotationId}`);
  }
  return `(${probeReactComponents.toString()})(${JSON.stringify(annotationId)})`;
}
