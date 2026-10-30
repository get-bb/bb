import {
  createContext,
  isValidElement,
  useContext,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { CodeCopy } from "../guides/guide-blocks";

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

export function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeText(node.props.children);
  }
  return "";
}

type CodeBlockProps = ComponentProps<"pre"> & { icon?: string };

export function CodeBlock({
  children,
  title,
  icon: _icon,
  ...props
}: CodeBlockProps) {
  return (
    <div className="gd-code">
      <div className="gd-code-bar">
        <span className="gd-code-label">
          {codeBlockLabel(title, codeLanguage(children))}
        </span>
        <CodeCopy text={nodeText(children).replace(/\n$/u, "")} />
      </div>
      <pre {...props}>{children}</pre>
    </div>
  );
}

interface TabsState {
  active: string;
  ids: (value: string) => { tab: string; panel: string };
}

const TabsContext = createContext<TabsState | null>(null);

export function Tabs({
  items,
  children,
}: {
  items: readonly string[];
  children: ReactNode;
}) {
  const [active, setActive] = useState(items[0] ?? "");
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
