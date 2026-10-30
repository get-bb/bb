import {
  createContext,
  isValidElement,
  useContext,
  useId,
  useRef,
  useSyncExternalStore,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { CodeCopy } from "../guides/guide-blocks";
import { CALLOUT_TONES, isCalloutTone } from "./remark-docs";

const TERMINAL = "Terminal";

const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  bash: TERMINAL,
  console: TERMINAL,
  sh: TERMINAL,
  shell: TERMINAL,
  shellscript: TERMINAL,
  zsh: TERMINAL,
  powershell: "PowerShell",
  ps1: "PowerShell",
  css: "CSS",
  diff: "Diff",
  html: "HTML",
  javascript: "JavaScript",
  js: "JavaScript",
  json: "JSON",
  jsonc: "JSON",
  jsx: "JSX",
  markdown: "Markdown",
  md: "Markdown",
  mdx: "MDX",
  plaintext: "Text",
  text: "Text",
  toml: "TOML",
  ts: "TypeScript",
  tsx: "TSX",
  typescript: "TypeScript",
  yaml: "YAML",
  yml: "YAML",
};

export function codeBlockLabel(
  title: string | undefined,
  language: string | undefined,
): string {
  if (title !== undefined && title.trim().length > 0) return title.trim();
  if (language === undefined) return "Text";
  return LANGUAGE_LABELS[language] ?? language;
}

function codeLanguage(children: ReactNode): string | undefined {
  if (!isValidElement<{ className?: unknown }>(children)) return undefined;
  const { className } = children.props;
  if (typeof className !== "string") return undefined;
  return /(?:^|\s)language-(\S+)/u.exec(className)?.[1];
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeText(node.props.children);
  }
  return "";
}

export function shellCopyText(text: string): string {
  const lines = text.split("\n");
  if (!lines.some((line) => /^\s*\$ /u.test(line))) return text;
  const commands: string[] = [];
  let continues = false;
  for (const line of lines) {
    const prompt = /^\s*\$ (.*)$/u.exec(line);
    if (prompt) {
      commands.push(prompt[1]!);
      continues = prompt[1]!.endsWith("\\");
    } else if (continues) {
      commands.push(line);
      continues = line.endsWith("\\");
    }
  }
  return commands.join("\n");
}

export function codeCopyText(text: string, language: string | undefined) {
  const trimmed = text.replace(/\n$/u, "");
  return language !== undefined && LANGUAGE_LABELS[language] === TERMINAL
    ? shellCopyText(trimmed)
    : trimmed;
}

type CodeBlockProps = ComponentProps<"pre"> & { icon?: string };

export function CodeBlock({
  children,
  title,
  icon: _icon,
  ...props
}: CodeBlockProps) {
  const language = codeLanguage(children);
  return (
    <div className="gd-code">
      <div className="gd-code-bar">
        <span className="gd-code-label">{codeBlockLabel(title, language)}</span>
        <CodeCopy text={codeCopyText(nodeText(children), language)} />
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}

const TAB_STORAGE_PREFIX = "bb-docs-tab:";
const TAB_PARAM = "tab";
const chosenTabs = new Map<string, string>();
const tabListeners = new Set<() => void>();

function tabKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, "-");
}

export function tabGroupKey(items: readonly string[], group?: string): string {
  return group ?? items.map(tabKey).join("|");
}

export function resolveTab(
  items: readonly string[],
  search: string,
  stored: string | null,
): string | undefined {
  const requested = new URLSearchParams(search).get(TAB_PARAM);
  const fromUrl =
    requested === null
      ? undefined
      : items.find((item) => tabKey(item) === tabKey(requested));
  return (
    fromUrl ?? (stored !== null && items.includes(stored) ? stored : undefined)
  );
}

function storedTab(group: string): string | null {
  try {
    return window.localStorage.getItem(`${TAB_STORAGE_PREFIX}${group}`);
  } catch {
    return null;
  }
}

function storeTab(group: string, value: string) {
  try {
    window.localStorage.setItem(`${TAB_STORAGE_PREFIX}${group}`, value);
  } catch {
    return;
  }
}

function chooseTab(group: string, value: string) {
  chosenTabs.set(group, value);
  storeTab(group, value);
  const url = new URL(window.location.href);
  url.searchParams.set(TAB_PARAM, tabKey(value));
  window.history.replaceState(window.history.state, "", url);
  for (const listener of tabListeners) listener();
}

function subscribeTabs(listener: () => void) {
  tabListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    tabListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function useTabChoice(items: readonly string[], group: string) {
  const remembered = useSyncExternalStore(
    subscribeTabs,
    () =>
      chosenTabs.get(group) ??
      resolveTab(items, window.location.search, storedTab(group)) ??
      null,
    () => null,
  );
  const active =
    remembered !== null && items.includes(remembered)
      ? remembered
      : (items[0] ?? "");
  return [active, (value: string) => chooseTab(group, value)] as const;
}

interface TabsState {
  active: string;
  ids: (value: string) => { tab: string; panel: string };
}

const TabsContext = createContext<TabsState | null>(null);

export function Tabs({
  items,
  group,
  children,
}: {
  items: readonly string[];
  group?: string;
  children: ReactNode;
}) {
  const [active, setActive] = useTabChoice(items, tabGroupKey(items, group));
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const ids = (value: string) => {
    const index = items.indexOf(value);
    return { tab: `${baseId}-tab-${index}`, panel: `${baseId}-panel-${index}` };
  };
  const select = (index: number) => {
    const value = items[(index + items.length) % items.length];
    if (value === undefined) return;
    setActive(value);
    listRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [items.indexOf(value)]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = items.indexOf(active);
    const next =
      event.key === "ArrowRight"
        ? current + 1
        : event.key === "ArrowLeft"
          ? current - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    select(next);
  };
  return (
    <div className="docs-tabs">
      <div
        ref={listRef}
        role="tablist"
        className="docs-tabs-list"
        onKeyDown={onKeyDown}
      >
        {items.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            id={ids(item).tab}
            aria-controls={ids(item).panel}
            aria-selected={item === active}
            tabIndex={item === active ? 0 : -1}
            onClick={() => setActive(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <TabsContext.Provider value={{ active, ids }}>
        {children}
      </TabsContext.Provider>
    </div>
  );
}

export function Tab({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  const tabs = useContext(TabsContext);
  if (tabs === null) {
    throw new Error(`<Tab value="${value}"> must be inside <Tabs>`);
  }
  const { tab, panel } = tabs.ids(value);
  return (
    <div
      role="tabpanel"
      id={panel}
      aria-labelledby={tab}
      className="docs-tab-panel"
      hidden={tabs.active !== value}
    >
      {children}
    </div>
  );
}

export function Callout({
  type,
  children,
}: {
  type: string;
  children: ReactNode;
}) {
  if (!isCalloutTone(type)) {
    throw new Error(`Unknown callout type "${type}"`);
  }
  return (
    <aside className="docs-callout" data-tone={type}>
      <p className="docs-callout-label">{CALLOUT_TONES[type]}</p>
      {children}
    </aside>
  );
}

export function CalloutTitle({ children }: { children: ReactNode }) {
  return <p className="docs-callout-title">{children}</p>;
}

export function CalloutDescription({ children }: { children: ReactNode }) {
  return <div className="docs-callout-body">{children}</div>;
}
