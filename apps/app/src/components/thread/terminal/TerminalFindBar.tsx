import { useEffect, useRef, useState } from "react";
import type { ISearchOptions, SearchAddon } from "@xterm/addon-search";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";

function searchOptions(caseSensitive: boolean): ISearchOptions {
  const styles = getComputedStyle(document.documentElement);
  const match = styles.getPropertyValue("--ansi-3").trim();
  const active = styles.getPropertyValue("--foreground").trim();
  return {
    caseSensitive,
    decorations: {
      matchBorder: match,
      matchOverviewRuler: match,
      activeMatchBorder: active,
      activeMatchColorOverviewRuler: active,
    },
  };
}

function resultLabel(
  query: string,
  results: { resultIndex: number; resultCount: number },
): string {
  if (query === "") return "";
  if (results.resultCount === 0) return "No results";
  if (results.resultIndex < 0) return `${results.resultCount}+ results`;
  return `${results.resultIndex + 1} of ${results.resultCount}`;
}

export function TerminalFindBar({
  addon,
  focusRequest,
  onClose,
}: {
  addon: SearchAddon;
  focusRequest: number;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState({ resultIndex: -1, resultCount: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const find = (previous: boolean) => {
    const options = searchOptions(caseSensitive);
    if (previous) addon.findPrevious(query, options);
    else addon.findNext(query, options);
  };
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);
  useEffect(() => {
    const subscription = addon.onDidChangeResults(setResults);
    return () => subscription.dispose();
  }, [addon]);
  useEffect(() => {
    addon.findNext(query, {
      ...searchOptions(caseSensitive),
      incremental: true,
    });
  }, [addon, query, caseSensitive]);

  return (
    <div
      role="search"
      aria-label="Find in terminal"
      className="flex items-center gap-2 border-b border-border bg-sidebar p-2 text-xs"
      onKeyDown={(event) => {
        if (
          event.key === "Escape" ||
          (event.key === "Enter" && event.target === inputRef.current)
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") onClose();
          else find(event.shiftKey);
        }
      }}
    >
      <input
        ref={inputRef}
        aria-label="Find in terminal"
        className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 font-mono"
        aria-label="Match case"
        aria-pressed={caseSensitive}
        onClick={() => setCaseSensitive(!caseSensitive)}
      >
        Aa
      </Button>
      <span role="status" className="shrink-0 text-muted-foreground">
        {resultLabel(query, results)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label="Previous match"
        disabled={!query}
        onClick={() => find(true)}
      >
        <Icon name="ChevronUp" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label="Next match"
        disabled={!query}
        onClick={() => find(false)}
      >
        <Icon name="ChevronDown" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label="Close terminal find"
        onClick={onClose}
      >
        <Icon name="X" />
      </Button>
    </div>
  );
}
