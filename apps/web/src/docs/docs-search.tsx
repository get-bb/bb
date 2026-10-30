import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStaticSearch } from "fumadocs-core/search/client";
import { useEffect, useRef, useState } from "react";

const DOCS_SEARCH_INDEX = "/docs/search.json";

function isSearchShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (
    event.key.toLowerCase() === "k" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

export function DocsSearch() {
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const [mac, setMac] = useState(true);
  const { search, onSearchChange, isLoading, data, error } = useStaticSearch({
    from: DOCS_SEARCH_INDEX,
  });
  const items = (data?.items ?? [])
    .flatMap((item) => (item.type === "table" ? [] : [item]))
    .slice(0, 8);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/u.test(navigator.platform));
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event)) return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => setActive(0), [search]);

  return (
    <div className="docs-search" role="search">
      <HugeiconsIcon
        icon={Search01Icon}
        className="docs-ic docs-search-icon"
        aria-hidden
      />
      <input
        ref={input}
        type="search"
        className="docs-search-input"
        placeholder="Search docs"
        aria-label="Search docs"
        aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, items.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && items[active]) {
            event.preventDefault();
            window.location.assign(items[active].url);
          } else if (event.key === "Escape") {
            onSearchChange("");
            input.current?.blur();
          }
        }}
      />
      {search.length === 0 ? (
        <kbd className="docs-search-kbd" aria-hidden>
          {mac ? "⌘K" : "Ctrl K"}
        </kbd>
      ) : null}
      {search.length > 0 ? (
        <ul className="docs-search-results" aria-busy={isLoading}>
          {error ? <li className="docs-search-empty">Search failed</li> : null}
          {!error && data && items.length === 0 ? (
            <li className="docs-search-empty">No results</li>
          ) : null}
          {items.map((item, index) => (
            <li key={item.id}>
              <a
                href={item.url}
                data-kind={item.type}
                className={index === active ? "active" : undefined}
              >
                {item.content}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
