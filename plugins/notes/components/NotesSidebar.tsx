import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ancestorsOf,
  filterTree,
  joinPath,
  nameError,
  parentOf,
  type TreeNode,
} from "../lib/notes-tree.js";

export type DraftKind = "file" | "directory";

export interface Draft {
  kind: DraftKind;
  /** Folder the new entry goes into, "" for the notes root. */
  directory: string;
}

export interface NotesSidebarProps {
  nodes: readonly TreeNode[];
  activePath: string | null;
  isLoading: boolean;
  error: string | null;
  truncated: boolean;
  onOpen: (path: string) => void;
  onCreate: (kind: DraftKind, path: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (node: TreeNode) => void;
}

export function NotesSidebar({
  nodes,
  activePath,
  isLoading,
  error,
  truncated,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: NotesSidebarProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const filtered = useMemo(() => filterTree(nodes, query), [nodes, query]);

  // Reveal the open note by expanding everything above it.
  useEffect(() => {
    if (activePath === null) return;
    setCollapsed((current) => {
      const ancestors = ancestorsOf(activePath);
      if (!ancestors.some((ancestor) => current.has(ancestor))) return current;
      const next = new Set(current);
      for (const ancestor of ancestors) next.delete(ancestor);
      return next;
    });
  }, [activePath]);

  const isExpanded = (path: string): boolean =>
    filtered.expand.has(path) || !collapsed.has(path);

  const toggle = (path: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const startDraft = (kind: DraftKind): void => {
    // Add beside the open note when there is one, so "New note" lands in the
    // folder the user is already working in rather than at the root.
    const directory =
      activePath === null ? "" : parentOf(activePath);
    setDraft({ kind, directory });
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(directory);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
        <div className="relative min-w-0 flex-1">
          <Icon
            name="Search"
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search notes"
            aria-label="Search notes"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <SidebarAction
          label="New note"
          icon="Plus"
          onClick={() => startDraft("file")}
        />
        <SidebarAction
          label="New folder"
          icon="FolderPlus"
          onClick={() => startDraft("directory")}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {error !== null ? (
          <p className="px-3 py-2 text-xs text-destructive">{error}</p>
        ) : null}

        {draft !== null && draft.directory === "" ? (
          <DraftRow
            draft={draft}
            depth={0}
            onCancel={() => setDraft(null)}
            onCommit={(name) => {
              setDraft(null);
              onCreate(draft.kind, joinPath(draft.directory, name));
            }}
          />
        ) : null}

        {filtered.nodes.map((node) => (
          <Row
            key={node.path}
            node={node}
            depth={0}
            activePath={activePath}
            draft={draft}
            renaming={renaming}
            isExpanded={isExpanded}
            onToggle={toggle}
            onOpen={onOpen}
            onDelete={onDelete}
            onStartRename={setRenaming}
            onCancelRename={() => setRenaming(null)}
            onCommitRename={(from, name) => {
              setRenaming(null);
              const next = joinPath(parentOf(from), name);
              if (next !== from) onRename(from, next);
            }}
            onAddInto={(directory, kind) => {
              setDraft({ kind, directory });
              setCollapsed((current) => {
                const next = new Set(current);
                next.delete(directory);
                return next;
              });
            }}
            onCancelDraft={() => setDraft(null)}
            onCommitDraft={(directory, kind, name) => {
              setDraft(null);
              onCreate(kind, joinPath(directory, name));
            }}
          />
        ))}

        {!isLoading && filtered.nodes.length === 0 && draft === null ? (
          <p className="px-3 py-2 text-xs text-subtle-foreground">
            {query.trim() === ""
              ? "No notes yet. Use New note to add one."
              : "No notes match that search."}
          </p>
        ) : null}

        {truncated ? (
          <p className="px-3 py-2 text-xs text-subtle-foreground">
            Showing the first results only — this folder has a lot of files.
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  draft: Draft | null;
  renaming: string | null;
  isExpanded: (path: string) => boolean;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onDelete: (node: TreeNode) => void;
  onStartRename: (path: string) => void;
  onCancelRename: () => void;
  onCommitRename: (from: string, name: string) => void;
  onAddInto: (directory: string, kind: DraftKind) => void;
  onCancelDraft: () => void;
  onCommitDraft: (
    directory: string,
    kind: DraftKind,
    name: string,
  ) => void;
}

function Row(props: RowProps) {
  const { node, depth, activePath, draft, renaming } = props;
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  if (renaming === node.path) {
    return (
      <NameInput
        initialValue={node.name}
        indent={indent}
        label={`Rename ${node.name}`}
        onCancel={props.onCancelRename}
        onCommit={(name) => props.onCommitRename(node.path, name)}
      />
    );
  }

  if (node.kind === "file") {
    const isActive = node.path === activePath;
    return (
      <div className="group/row relative flex items-center">
        <button
          type="button"
          onClick={() => props.onOpen(node.path)}
          style={indent}
          aria-current={isActive ? "true" : undefined}
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 pr-14 text-left text-xs",
            isActive
              ? "bg-state-active text-foreground"
              : "text-foreground/85 hover:bg-state-hover",
          )}
        >
          <Icon
            name="FileText"
            className="size-3.5 shrink-0 text-subtle-foreground"
            aria-hidden
          />
          <span className="truncate">{node.name}</span>
        </button>
        <RowActions
          onRename={() => props.onStartRename(node.path)}
          onDelete={() => props.onDelete(node)}
        />
      </div>
    );
  }

  const expanded = props.isExpanded(node.path);
  return (
    <>
      <div className="group/row relative flex items-center">
        <button
          type="button"
          onClick={() => props.onToggle(node.path)}
          style={indent}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 pr-20 text-left text-xs text-foreground/85 hover:bg-state-hover"
        >
          <Icon
            name={expanded ? "ChevronDown" : "ChevronRight"}
            className="size-3 shrink-0 text-subtle-foreground"
            aria-hidden
          />
          <Icon
            name={expanded ? "FolderOpen" : "Folder"}
            className="size-3.5 shrink-0 text-subtle-foreground"
            aria-hidden
          />
          <span className="truncate font-medium">{node.name}</span>
        </button>
        <RowActions
          onAddNote={() => props.onAddInto(node.path, "file")}
          onAddFolder={() => props.onAddInto(node.path, "directory")}
          onRename={() => props.onStartRename(node.path)}
          onDelete={() => props.onDelete(node)}
        />
      </div>

      {expanded ? (
        <>
          {draft !== null && draft.directory === node.path ? (
            <DraftRow
              draft={draft}
              depth={depth + 1}
              onCancel={props.onCancelDraft}
              onCommit={(name) =>
                props.onCommitDraft(draft.directory, draft.kind, name)
              }
            />
          ) : null}
          {node.children.map((child) => (
            <Row {...props} key={child.path} node={child} depth={depth + 1} />
          ))}
        </>
      ) : null}
    </>
  );
}

function DraftRow({
  draft,
  depth,
  onCancel,
  onCommit,
}: {
  draft: Draft;
  depth: number;
  onCancel: () => void;
  onCommit: (name: string) => void;
}) {
  return (
    <NameInput
      initialValue=""
      indent={{ paddingLeft: `${depth * 12 + 8}px` }}
      label={draft.kind === "file" ? "New note name" : "New folder name"}
      onCancel={onCancel}
      onCommit={onCommit}
    />
  );
}

/**
 * Inline name entry for creating and renaming.
 *
 * Commits on Enter and cancels on Escape or blur. Blur-cancels rather than
 * blur-commits so clicking away from a half-typed name does not create a
 * file the user did not mean to name that.
 */
function NameInput({
  initialValue,
  indent,
  label,
  onCancel,
  onCommit,
}: {
  initialValue: string;
  indent: { paddingLeft: string };
  label: string;
  onCancel: () => void;
  onCommit: (name: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const problem = nameError(value);

  return (
    <div style={indent} className="py-1 pr-2">
      <Input
        ref={inputRef}
        value={value}
        aria-label={label}
        aria-invalid={value !== "" && problem !== null}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (!committedRef.current) onCancel();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (problem !== null) return;
            committedRef.current = true;
            onCommit(value.trim());
          }
        }}
        className="h-6 text-xs"
      />
      {value !== "" && problem !== null ? (
        <p className="pt-0.5 text-[0.6875rem] text-destructive">{problem}</p>
      ) : null}
    </div>
  );
}

function RowActions({
  onAddNote,
  onAddFolder,
  onRename,
  onDelete,
}: {
  onAddNote?: () => void;
  onAddFolder?: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute right-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
      {onAddNote !== undefined ? (
        <SidebarAction label="New note here" icon="Plus" onClick={onAddNote} />
      ) : null}
      {onAddFolder !== undefined ? (
        <SidebarAction
          label="New folder here"
          icon="FolderPlus"
          onClick={onAddFolder}
        />
      ) : null}
      <SidebarAction label="Rename" icon="Edit" onClick={onRename} />
      <SidebarAction label="Delete" icon="Trash2" onClick={onDelete} />
    </div>
  );
}

function SidebarAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-subtle-foreground hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Icon name={icon} className="size-3.5" aria-hidden />
    </button>
  );
}
