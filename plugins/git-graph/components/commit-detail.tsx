import { experimental_Diff as Diff } from "@get-bb/plugin-sdk/app";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { CommitDetailOutput, FileChange } from "../contract.js";
import { formatDateTime } from "./format.js";
import { RefPills } from "./ref-pills.js";

const STATUS_CLASS: Record<FileChange["status"], string> = {
  added: "text-emerald-500",
  modified: "text-amber-500",
  deleted: "text-red-500",
  renamed: "text-sky-500",
  copied: "text-sky-500",
  "type-change": "text-fuchsia-500",
  unmerged: "text-red-600",
  unknown: "text-muted-foreground",
};

const STATUS_LETTER: Record<FileChange["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  "type-change": "T",
  unmerged: "U",
  unknown: "?",
};

export interface FilePatchState {
  path: string;
  patch: string;
  truncated: boolean;
}

export function CommitDetail({
  detail,
  onClose,
  onNavigateParent,
  onOpenFile,
  openFilePath,
  patch,
  patchLoading,
  patchError,
  onCopyHash,
}: {
  detail: CommitDetailOutput;
  onClose: () => void;
  onNavigateParent: (hash: string) => void;
  onOpenFile: (path: string) => void;
  openFilePath: string | null;
  patch: FilePatchState | null;
  patchLoading: boolean;
  patchError: string | null;
  onCopyHash: (hash: string) => void;
}) {
  const { commit } = detail;
  const committerDiffers =
    commit.committer.email !== commit.author.email ||
    commit.committer.date !== commit.author.date;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {commit.isMerge ? (
              <Badge variant="secondary" className="text-xs font-normal">
                Merge
              </Badge>
            ) : null}
            {commit.isRoot ? (
              <Badge variant="secondary" className="text-xs font-normal">
                Root
              </Badge>
            ) : null}
            <RefPills refs={commit.refs} maxVisible={null} />
          </div>
          <p
            className="truncate text-sm font-medium leading-snug"
            title={commit.message.split("\n", 1)[0] ?? ""}
          >
            {commit.message.split("\n", 1)[0] ?? ""}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={onClose}
          aria-label="Close commit details"
        >
          Close
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <dl className="space-y-2 text-xs">
          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">Commit</dt>
            <dd className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                className="truncate font-mono text-[11px] text-foreground underline-offset-2 hover:underline"
                onClick={() => onCopyHash(commit.hash)}
                title="Copy full hash"
              >
                {commit.hash}
              </button>
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">Author</dt>
            <dd className="min-w-0 break-words">
              {commit.author.name}{" "}
              <span className="text-muted-foreground">
                &lt;{commit.author.email}&gt;
              </span>
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">Date</dt>
            <dd title={commit.author.date}>
              {formatDateTime(commit.author.date)}
            </dd>
          </div>
          {committerDiffers ? (
            <div className="flex items-baseline gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">Committer</dt>
              <dd className="min-w-0 break-words">
                {commit.committer.name}{" "}
                <span className="text-muted-foreground">
                  ({formatDateTime(commit.committer.date)})
                </span>
              </dd>
            </div>
          ) : null}
          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">Tree</dt>
            <dd className="truncate font-mono text-[11px]">{commit.tree}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">Parents</dt>
            <dd className="min-w-0">
              {commit.parents.length === 0 ? (
                <span className="text-muted-foreground">
                  none (root commit)
                </span>
              ) : (
                <span className="flex flex-col gap-1">
                  {commit.parents.map((parent) => (
                    <button
                      key={parent.hash}
                      type="button"
                      className="truncate text-left font-mono text-[11px] text-foreground underline-offset-2 hover:underline"
                      onClick={() => onNavigateParent(parent.hash)}
                      title={parent.subject}
                    >
                      {parent.abbrev} {parent.subject}
                    </button>
                  ))}
                </span>
              )}
            </dd>
          </div>
        </dl>
        {commit.message.trim().length > 0 ? (
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 px-3 py-2 font-sans text-xs leading-5">
            {commit.message}
          </pre>
        ) : null}
        <div className="mt-4">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Changed files ({detail.files.length})
          </h3>
          {detail.filesNote !== null ? (
            <p className="mb-1.5 text-xs italic text-muted-foreground">
              {detail.filesNote}
            </p>
          ) : null}
          {detail.files.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No file changes recorded.
            </p>
          ) : (
            <ul className="space-y-px">
              {detail.files.map((file) => {
                const isOpen = openFilePath === file.path;
                return (
                  <li key={file.path}>
                    <button
                      type="button"
                      className={`flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-accent/50 ${isOpen ? "bg-accent" : ""}`}
                      onClick={() => onOpenFile(file.path)}
                    >
                      <span
                        className={`w-3 shrink-0 text-center font-mono font-semibold ${STATUS_CLASS[file.status]}`}
                        title={file.status}
                      >
                        {STATUS_LETTER[file.status]}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                        {file.path}
                      </span>
                      {file.oldPath !== null ? (
                        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                          ← {file.oldPath}
                        </span>
                      ) : null}
                    </button>
                    {isOpen ? (
                      <div className="mb-2 mt-1 overflow-hidden rounded-md border border-border">
                        {patchLoading ? (
                          <div className="space-y-2 p-3">
                            <Skeleton className="h-3 w-2/3" />
                            <Skeleton className="h-3 w-1/2" />
                          </div>
                        ) : patchError !== null ? (
                          <p className="p-3 text-xs text-red-500">
                            {patchError}
                          </p>
                        ) : patch !== null ? (
                          <>
                            {patch.truncated ? (
                              <p className="border-b border-border bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600">
                                Patch truncated at 1 MB.
                              </p>
                            ) : null}
                            <Diff patch={patch.patch} path={file.path} />
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
