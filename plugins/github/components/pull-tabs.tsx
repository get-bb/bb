import { useMemo, useState, type ReactNode } from "react";
import {
  experimental_Diff as Diff,
  experimental_FileLink as FileLink,
  experimental_Icon as Icon,
  UrlLink,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  checkCounts,
  groupPullEvents,
  linearLinkback,
  openedAsDraft,
  pullEventText,
  type PullEventEntry,
} from "../app-logic.js";
import type { githubRpcContract } from "../server.js";
import { Markdown } from "./markdown-lite.js";
import { ChecksBar } from "./next-step.js";
import { formatCount } from "./pull-state.js";
import {
  Avatar,
  errorText,
  plural,
  relativeTime,
  SpinnerIcon,
  TEXT_BUTTON_CLASS,
  type IssueDetail,
  type PullCheck,
  type PullDetail,
  type PullFile,
  type ReviewThread,
} from "./shared.js";

export type DetailTab = "activity" | "files" | "checks";

const REVIEW_STATE_LABELS: Record<string, string> = {
  APPROVED: "approved these changes",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "reviewed",
  DISMISSED: "had a review dismissed",
  PENDING: "started a review",
};

const EVENT_ICON: Record<
  PullEventEntry["kind"],
  { icon: string; tone: string }
> = {
  ready: { icon: "GitPullRequestArrow", tone: "text-success" },
  draft: { icon: "GitPullRequestDraft", tone: "text-muted-foreground" },
  closed: { icon: "GitPullRequestClosed", tone: "text-destructive" },
  reopened: { icon: "GitPullRequestArrow", tone: "text-success" },
  merged: { icon: "GitMerge", tone: "text-pr-merged" },
  force_pushed: { icon: "GitBranch", tone: "text-muted-foreground" },
  commit: { icon: "Circle", tone: "text-muted-foreground" },
  base_changed: { icon: "GitBranch", tone: "text-muted-foreground" },
  head_deleted: { icon: "Trash2", tone: "text-muted-foreground" },
};

function EventLine({
  glyph,
  children,
  time,
}: {
  glyph: ReactNode;
  children: ReactNode;
  time: string;
}) {
  return (
    <div className="flex items-start gap-2 py-1 text-xs text-subtle-foreground">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {glyph}
      </span>
      <span className="min-w-0 flex-1">
        {children} · {time}
      </span>
    </div>
  );
}

function Who({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>;
}

function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="mt-1 mb-2.5 ml-6 min-w-0 rounded-lg border border-border px-3 py-2.5">
      {children}
    </div>
  );
}

function ReviewThreadCard({ thread }: { thread: ReviewThread }) {
  return (
    <div className="mt-1 mb-2.5 ml-6 min-w-0 overflow-hidden rounded-lg border border-border">
      <p className="flex items-center border-b border-border bg-surface-recessed px-3 py-1.5 font-mono text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{thread.path}</span>
        {thread.line === null ? null : (
          <span className="shrink-0">:{thread.line}</span>
        )}
      </p>
      {thread.diffHunk.length > 0 ? (
        <div className="border-b border-border">
          <Diff patch={thread.diffHunk} path={thread.path} />
        </div>
      ) : null}
      <div className="flex flex-col gap-3 p-3">
        {thread.comments.map((entry, index) => (
          <div key={index} className="min-w-0">
            <p className="mb-1 flex items-center gap-2 text-xs text-subtle-foreground">
              <Avatar login={entry.author} size="size-4" />
              <Who>{entry.author}</Who> · {relativeTime(entry.createdAt)}
            </p>
            <Markdown content={entry.body} className="text-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivityTimeline({ pull }: { pull: PullDetail }) {
  const entries = useMemo(() => {
    const list: Array<{ at: string; key: string; node: ReactNode }> = [];
    const asDraft = openedAsDraft(pull.events, pull.isDraft);
    list.push({
      at: pull.createdAt,
      key: "opened",
      node: (
        <EventLine
          glyph={
            <Icon
              name={asDraft ? "GitPullRequestDraft" : "GitPullRequest"}
              className="size-3.5 text-muted-foreground"
            />
          }
          time={relativeTime(pull.createdAt)}
        >
          <Who>{pull.author}</Who> opened this {asDraft ? "draft " : ""}pull
          request
        </EventLine>
      ),
    });
    for (const [index, event] of groupPullEvents(pull.events).entries()) {
      const icon = EVENT_ICON[event.kind];
      list.push({
        at: event.createdAt,
        key: `event:${index}`,
        node: (
          <EventLine
            glyph={
              <Icon name={icon.icon} className={`size-3.5 ${icon.tone}`} />
            }
            time={relativeTime(event.createdAt)}
          >
            <Who>{event.actor.length > 0 ? event.actor : "Someone"}</Who>{" "}
            {pullEventText(event)}
          </EventLine>
        ),
      });
    }
    for (const [index, comment] of pull.comments.entries()) {
      const linear = linearLinkback(comment.body);
      list.push({
        at: comment.createdAt,
        key: `comment:${index}`,
        node:
          linear !== null ? (
            <EventLine
              glyph={
                <Icon name="Link" className="size-3.5 text-muted-foreground" />
              }
              time={relativeTime(comment.createdAt)}
            >
              <Who>Linear</Who> linked <Who>{linear.key}</Who> {linear.title}
            </EventLine>
          ) : (
            <>
              <EventLine
                glyph={<Avatar login={comment.author} size="size-4" />}
                time={relativeTime(comment.createdAt)}
              >
                <Who>{comment.author}</Who> commented
              </EventLine>
              <Bubble>
                <Markdown content={comment.body} className="text-sm" />
              </Bubble>
            </>
          ),
      });
    }
    for (const [index, review] of pull.reviews.entries()) {
      if (review.body.length === 0 && review.state === "COMMENTED") continue;
      list.push({
        at: review.createdAt,
        key: `review:${index}`,
        node: (
          <>
            <EventLine
              glyph={<Avatar login={review.author} size="size-4" />}
              time={relativeTime(review.createdAt)}
            >
              <Who>{review.author}</Who>{" "}
              <span
                className={
                  review.state === "APPROVED"
                    ? "text-success"
                    : review.state === "CHANGES_REQUESTED"
                      ? "text-destructive"
                      : undefined
                }
              >
                {REVIEW_STATE_LABELS[review.state] ??
                  review.state.toLowerCase()}
              </span>
            </EventLine>
            {review.body.length > 0 ? (
              <Bubble>
                <Markdown content={review.body} className="text-sm" />
              </Bubble>
            ) : null}
          </>
        ),
      });
    }
    for (const [index, thread] of pull.reviewThreads.entries()) {
      const first = thread.comments[0];
      if (first === undefined) continue;
      list.push({
        at: first.createdAt,
        key: `thread:${index}`,
        node: (
          <>
            <EventLine
              glyph={<Avatar login={first.author} size="size-4" />}
              time={relativeTime(first.createdAt)}
            >
              <Who>{first.author}</Who> commented on{" "}
              <span className="font-mono">
                {thread.path}
                {thread.line === null ? "" : `:${thread.line}`}
              </span>
            </EventLine>
            <ReviewThreadCard thread={thread} />
          </>
        ),
      });
    }
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [pull]);
  return (
    <div className="flex flex-col">
      {entries.map((entry) => (
        <div key={entry.key} className="min-w-0">
          {entry.node}
        </div>
      ))}
    </div>
  );
}

export function IssueActivity({ issue }: { issue: IssueDetail }) {
  return (
    <div className="flex flex-col">
      {issue.comments.map((comment, index) => (
        <div key={index} className="min-w-0">
          <EventLine
            glyph={<Avatar login={comment.author} size="size-4" />}
            time={relativeTime(comment.createdAt)}
          >
            <Who>{comment.author}</Who> commented
          </EventLine>
          <Bubble>
            <Markdown content={comment.body} className="text-sm" />
          </Bubble>
        </div>
      ))}
    </div>
  );
}

const commentDrafts = new Map<string, string>();

export function CommentBox({
  kind,
  repo,
  number,
  onPosted,
}: {
  kind: "issue" | "pr";
  repo: string;
  number: number;
  onPosted: () => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const draftKey = `${kind}:${repo}#${number}`;
  const [text, setText] = useState(() => commentDrafts.get(draftKey) ?? "");
  const [posting, setPosting] = useState(false);
  const post = () => {
    const body = text.trim();
    if (body.length === 0 || posting) return;
    setPosting(true);
    (kind === "pr"
      ? rpc.call("commentPull", { repo, number, body })
      : rpc.call("commentIssue", { repo, number, body })
    )
      .then(
        () => {
          commentDrafts.delete(draftKey);
          setText("");
          onPosted();
        },
        (error: unknown) =>
          toast.error(`Couldn't comment on #${number}`, {
            description: errorText(error),
          }),
      )
      .finally(() => setPosting(false));
  };
  return (
    <div className="mt-3 flex flex-col gap-2">
      <Textarea
        value={text}
        rows={3}
        aria-label="Comment"
        placeholder="Leave a comment on GitHub"
        disabled={posting}
        onChange={(event) => {
          commentDrafts.set(draftKey, event.target.value);
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            post();
          }
        }}
      />
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS}
          disabled={posting || text.trim().length === 0}
          aria-keyshortcuts="Meta+Enter Control+Enter"
          onClick={post}
        >
          {posting ? <SpinnerIcon /> : null}
          {posting ? "Commenting…" : "Comment"}
        </Button>
      </div>
    </div>
  );
}

export function ActivitySkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-1">
      {[58, 42, 66].map((width) => (
        <div key={width} className="flex items-center gap-2 py-1">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-2.5" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  );
}

export function SectionError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-2 py-3 text-xs text-subtle-foreground">
      <Icon name="AlertCircle" className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={TEXT_BUTTON_CLASS}
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}

function FileName({ path }: { path: string }) {
  const slash = path.lastIndexOf("/");
  return (
    <span
      title={path}
      className="flex min-w-0 flex-1 items-baseline gap-1.5 font-mono"
    >
      <span className="min-w-0 truncate text-foreground">
        {path.slice(slash + 1)}
      </span>
      {slash < 0 ? null : (
        <span className="min-w-0 flex-1 truncate text-subtle-foreground @max-[35rem]/github:hidden">
          {path.slice(0, slash)}
        </span>
      )}
    </span>
  );
}

function FileRow({
  file,
  environmentId,
  url,
  defaultOpen,
}: {
  file: PullFile;
  environmentId: string | null;
  url: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border first:border-t-0">
      <div className="relative flex min-h-9 items-center gap-2 pr-3 pl-1.5 text-xs select-none">
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-subtle-foreground after:absolute after:inset-0 after:content-[''] hover:bg-state-hover hover:text-foreground max-md:pointer-coarse:size-9"
          aria-label={`${open ? "Collapse" : "Expand"} ${file.path}`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon
            name="ChevronDown"
            className={`size-3 transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
          />
        </button>
        {environmentId === null || file.status === "removed" ? (
          <FileName path={file.path} />
        ) : (
          <FileLink
            className="relative flex min-w-0 flex-1 hover:underline"
            target={{ kind: "workspace", environmentId, path: file.path }}
          >
            <FileName path={file.path} />
          </FileLink>
        )}
        {file.status === "modified" ? null : (
          <Badge variant="secondary" className="shrink-0 font-normal">
            {file.status}
          </Badge>
        )}
        <span className="flex shrink-0 gap-1.5 font-mono tabular-nums">
          <span className="text-diff-added">
            +{formatCount(file.additions)}
          </span>
          <span className="text-diff-removed">
            -{formatCount(file.deletions)}
          </span>
        </span>
      </div>
      {!open ? null : file.patch !== null ? (
        <div className="overflow-x-auto border-t border-border @min-[35rem]/github:max-h-96 @min-[35rem]/github:overflow-y-auto">
          <Diff patch={file.patch} path={file.path} />
        </div>
      ) : (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          This diff is too large to show here.{" "}
          <UrlLink href={`${url}/files`} className="underline">
            See it on GitHub
          </UrlLink>
        </p>
      )}
    </div>
  );
}

export function FilesTab({
  pull,
  environmentId,
}: {
  pull: PullDetail;
  environmentId: string | null;
}) {
  if (pull.files.length === 0) {
    return (
      <p className="py-3 text-xs text-subtle-foreground">
        {pull.changedFiles > 0
          ? `${plural(pull.changedFiles, "file")} changed; GitHub didn't list them.`
          : "No files changed."}
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {pull.files.map((file, index) => (
        <FileRow
          key={file.path}
          file={file}
          environmentId={environmentId}
          url={pull.url}
          defaultOpen={index === 0 && file.patch !== null}
        />
      ))}
    </div>
  );
}

export function FilesSkeleton({ count }: { count: number }) {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-lg border border-border"
    >
      {Array.from({ length: Math.max(1, Math.min(count, 6)) }, (_, index) => (
        <div
          key={index}
          className="flex h-9 items-center gap-2 border-t border-border px-3 first:border-t-0"
        >
          <Skeleton className="size-3 rounded-sm" />
          <Skeleton
            className="h-2.5"
            style={{ width: `${30 + ((index * 23) % 38)}%` }}
          />
          <span className="flex-1" />
          <Skeleton className="h-2.5 w-12" />
        </div>
      ))}
    </div>
  );
}

const CHECK_ROW_CLASS =
  "flex min-h-9 items-center gap-2 border-t border-border py-1.5 pr-2 pl-3 text-xs first:border-t-0 max-md:pointer-coarse:min-h-11";

function CheckRow({
  check,
  icon,
  tone,
}: {
  check: PullCheck;
  icon: string;
  tone: string;
}) {
  const body = (
    <>
      <Icon name={icon} className={`size-3.5 shrink-0 ${tone}`} />
      <span className="min-w-0 flex-1 font-mono break-words text-foreground">
        {check.name}
      </span>
      {check.required ? (
        <span className="shrink-0 text-subtle-foreground">Required</span>
      ) : null}
      {check.url.length > 0 ? (
        <Icon
          name="ExternalLink"
          className="size-3 shrink-0 text-subtle-foreground"
        />
      ) : null}
    </>
  );
  return check.url.length > 0 ? (
    <UrlLink
      href={check.url}
      className={`${CHECK_ROW_CLASS} hover:bg-state-hover`}
    >
      {body}
    </UrlLink>
  ) : (
    <div className={CHECK_ROW_CLASS}>{body}</div>
  );
}

function CheckBucket({
  label,
  icon,
  tone,
  checks,
}: {
  label: string;
  icon: string;
  tone: string;
  checks: readonly PullCheck[];
}) {
  const [open, setOpen] = useState(false);
  if (checks.length === 0) return null;
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`${CHECK_ROW_CLASS} w-full text-left hover:bg-state-hover`}
      >
        <Icon name={icon} className={`size-3.5 shrink-0 ${tone}`} />
        <span className="min-w-0 flex-1 text-foreground">{label}</span>
        <Icon
          name="ChevronDown"
          className={`size-3 shrink-0 text-subtle-foreground transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open
        ? checks.map((check) => (
            <CheckRow
              key={`${check.workflow ?? ""}/${check.name}`}
              check={check}
              icon={icon}
              tone={tone}
            />
          ))
        : null}
    </>
  );
}

export function ChecksTab({
  pull,
  rerunning,
  onRerun,
}: {
  pull: PullDetail;
  rerunning: boolean;
  onRerun: (() => void) | null;
}) {
  if (pull.checks.length === 0) {
    return (
      <p className="py-3 text-xs text-subtle-foreground">
        No checks ran on the latest commit.
      </p>
    );
  }
  const counts = checkCounts(pull.checks);
  const of = (status: PullCheck["status"]) =>
    pull.checks.filter((check) => check.status === status);
  return (
    <div className="flex flex-col gap-3">
      <ChecksBar checks={pull.checks} />
      <div className="overflow-hidden rounded-lg border border-border">
        {of("failure").map((check) => (
          <CheckRow
            key={`${check.workflow ?? ""}/${check.name}`}
            check={check}
            icon="CircleX"
            tone="text-destructive"
          />
        ))}
        {of("pending").map((check) => (
          <CheckRow
            key={`${check.workflow ?? ""}/${check.name}`}
            check={check}
            icon="Clock"
            tone="text-muted-foreground"
          />
        ))}
        <CheckBucket
          label={`${plural(counts.passed, "check")} passed`}
          icon="CircleCheck"
          tone="text-success"
          checks={of("success")}
        />
        <CheckBucket
          label={`${counts.skipped} skipped`}
          icon="Unavailable"
          tone="text-muted-foreground"
          checks={of("skipped")}
        />
      </div>
      {onRerun !== null && counts.failed > 0 ? (
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS}
            disabled={rerunning}
            aria-busy={rerunning ? true : undefined}
            onClick={onRerun}
          >
            {rerunning ? <SpinnerIcon /> : <Icon name="RotateCcw" />}
            {rerunning ? "Re-running…" : "Re-run failed checks"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ChecksSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <Skeleton className="h-1 w-full rounded-full" />
      <div className="overflow-hidden rounded-lg border border-border">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="flex h-9 items-center gap-2 border-t border-border px-3 first:border-t-0"
          >
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton
              className="h-2.5"
              style={{ width: `${30 + index * 14}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
