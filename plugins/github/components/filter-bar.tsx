import { useEffect, useMemo, useRef, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import {
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
  COARSE_POINTER_TEXT_BASE_CLASS,
} from "@/components/ui/coarse-pointer-sizing";
import {
  addQueryToken,
  buildSuggestions,
  NAMED_FILTERS,
  queryChips,
  removeQueryToken,
  type Item,
  type Suggestion,
  type SuggestionIcon,
} from "../app-logic.js";
import { Avatar, StateDot, type RepoInfo } from "./shared.js";

function FilterSuggestionIcon({ icon }: { icon: SuggestionIcon }) {
  if (icon.kind === "state") {
    return <StateDot kind={icon.itemKind} state={icon.state} />;
  }
  return <Avatar login={icon.login} size="size-4" />;
}

export function FilterInput({
  value,
  onChange,
  onClose,
  onExit,
  items,
  repos,
  kind,
  viewer,
  focusRequest,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onExit: () => boolean;
  items: Item[] | null;
  repos: RepoInfo[];
  kind: "issue" | "pr";
  viewer: string | null;
  focusRequest: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [highlight, setHighlight] = useState(0);
  const [navigated, setNavigated] = useState(false);

  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);

  const vocab = useMemo(() => {
    const users = new Set<string>();
    const labels = new Set<string>();
    const bases = new Set<string>();
    for (const item of items ?? []) {
      if (item.author.length > 0) users.add(item.author);
      for (const login of item.assignees) users.add(login);
      for (const label of item.labels) labels.add(label);
      if (item.pr !== null) bases.add(item.pr.baseRefName);
    }
    const sorted = (values: Set<string>) =>
      [...values].sort((a, b) => a.localeCompare(b));
    return {
      users: sorted(users),
      labels: sorted(labels),
      bases: sorted(bases),
      repos: repos.map((entry) => entry.repo),
    };
  }, [items, repos]);

  const upToCaret = value.slice(0, caret);
  const tokenStart = upToCaret.lastIndexOf(" ") + 1;
  const token = upToCaret.slice(tokenStart);
  const named = value.trim().length === 0;
  const suggestions = useMemo<Suggestion[]>(
    () =>
      named
        ? NAMED_FILTERS[kind].map((filter) => ({
            insert: `${filter.token} `,
            label: filter.label,
            hint: filter.token,
          }))
        : buildSuggestions(token, vocab, kind, viewer).slice(0, 8),
    [named, token, vocab, kind, viewer],
  );
  const active = Math.min(highlight, Math.max(0, suggestions.length - 1));
  const listId = `github-filter-suggestions-${kind}`;

  const syncCaret = () =>
    setCaret(inputRef.current?.selectionStart ?? value.length);

  const accept = (suggestion: Suggestion) => {
    const next = named
      ? addQueryToken(value, suggestion.insert.trim())
      : value.slice(0, tokenStart) + suggestion.insert + value.slice(caret);
    const position = named
      ? next.length
      : tokenStart + suggestion.insert.length;
    onChange(next);
    setCaret(position);
    setHighlight(0);
    setNavigated(false);
    setOpen(suggestion.insert.endsWith(":"));
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(position, position);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (open && suggestions.length > 0) {
        setOpen(false);
      } else if (value.trim().length === 0) {
        onClose();
      } else if (!onExit()) {
        inputRef.current?.blur();
      }
      return;
    }
    if (!open || suggestions.length === 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (suggestions.length > 0) setOpen(true);
        else onExit();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setNavigated(true);
      setHighlight((active + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setNavigated(true);
      setHighlight((active - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const suggestion = suggestions[active];
      if (suggestion === undefined) return;
      event.preventDefault();
      if (event.key === "Enter" && !navigated && !token.includes(":")) {
        setOpen(false);
        onExit();
        return;
      }
      accept(suggestion);
    }
  };

  const showList = open && suggestions.length > 0;
  const withIcons = suggestions.some((entry) => entry.icon !== undefined);
  return (
    <div className="relative flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md pl-2 focus-within:bg-state-hover max-md:pointer-coarse:h-10">
      <Icon
        name="Search"
        aria-hidden
        className="size-4 shrink-0 text-subtle-foreground"
      />
      <input
        ref={inputRef}
        value={value}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={`Filter ${kind === "pr" ? "pull requests" : "issues"}`}
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlight(0);
          setNavigated(false);
          setCaret(event.target.selectionStart ?? event.target.value.length);
        }}
        onSelect={syncCaret}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={kind === "pr" ? "Filter pull requests" : "Filter issues"}
        className={`h-full min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-subtle-foreground ${COARSE_POINTER_TEXT_BASE_CLASS}`}
        spellCheck={false}
        autoComplete="off"
      />
      <button
        type="button"
        className={`flex shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-state-hover hover:text-foreground ${COARSE_POINTER_ROW_ACTION_SIZE_CLASS}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClose}
        aria-label="Close the filter"
      >
        <Icon name="X" className="size-3.5" />
      </button>
      {showList ? (
        <div
          id={listId}
          role="listbox"
          aria-label={named ? "Filter by" : "Suggestions"}
          className="absolute top-full left-0 z-50 mt-1 max-h-72 w-full max-w-80 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {named ? (
            <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-subtle-foreground">
              Filter by
            </p>
          ) : null}
          {suggestions.map((suggestion, index) => (
            <div
              key={suggestion.insert}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={`flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs max-md:pointer-coarse:py-2.5 max-md:pointer-coarse:text-sm ${
                index === active
                  ? "bg-state-active text-foreground"
                  : "text-popover-foreground"
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                accept(suggestion);
              }}
              onMouseEnter={() => setHighlight(index)}
            >
              {withIcons ? (
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {suggestion.icon !== undefined ? (
                    <FilterSuggestionIcon icon={suggestion.icon} />
                  ) : null}
                </span>
              ) : null}
              <span className="min-w-0 truncate font-medium">
                {suggestion.label}
              </span>
              {suggestion.hint !== undefined ? (
                <span
                  className={`ml-auto min-w-0 truncate pl-3 text-xs text-muted-foreground ${named ? "font-mono" : ""}`}
                >
                  {suggestion.hint}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function FilterChips({
  query,
  viewer,
  count,
  noun,
  inset,
  onChange,
  onEmptied,
}: {
  query: string;
  viewer: string | null;
  count: number | null;
  noun: [singular: string, plural: string];
  inset: boolean;
  onChange: (query: string) => void;
  onEmptied: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chips = queryChips(query, viewer);
  if (chips.length === 0) return null;
  const remove = (index: number, position: number) => {
    onChange(removeQueryToken(query, index));
    requestAnimationFrame(() => {
      const buttons = ref.current?.querySelectorAll("button");
      if (buttons === undefined || buttons.length === 0) {
        onEmptied();
        return;
      }
      buttons[Math.min(position, buttons.length - 1)]?.focus();
    });
  };
  return (
    <div
      ref={ref}
      className={`flex flex-wrap items-center gap-1.5 px-3 pb-2 ${inset ? "pt-2" : ""}`}
    >
      {chips.map((chip, position) => (
        <span
          key={`${chip.index}:${chip.key}:${chip.value}`}
          className="inline-flex h-7 max-w-full items-center gap-1 rounded-md bg-state-hover pr-0.5 pl-2 text-xs text-foreground"
        >
          <span className="text-subtle-foreground">{chip.key}</span>
          <span className="min-w-0 truncate font-medium">{chip.value}</span>
          <button
            type="button"
            className="relative flex size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground after:absolute after:-inset-2 hover:bg-state-active hover:text-foreground"
            aria-label={`Remove "${chip.key} ${chip.value}"`}
            onClick={() => remove(chip.index, position)}
          >
            <Icon name="X" className="size-3" />
          </button>
        </span>
      ))}
      {count === null ? null : (
        <span className="pl-1 text-xs text-subtle-foreground tabular-nums">
          {count} {count === 1 ? noun[0] : noun[1]}
        </span>
      )}
    </div>
  );
}
