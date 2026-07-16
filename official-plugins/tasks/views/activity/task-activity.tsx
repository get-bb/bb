import { useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp02Icon,
  AttachmentIcon,
  BotIcon,
  File01Icon,
  Notification02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@bb/shared-ui/button";
import { Switch } from "@bb/shared-ui/switch";
import { cn } from "@bb/shared-ui/lib/utils";
import { TasksEditor } from "../../editor/tasks-editor.js";
import { useBbNavigate } from "@bb/plugin-sdk/app";
import {
  useMentionItems,
  useTasksQuery,
  useTasksRpc,
} from "../../shell/data.js";
import {
  attachmentDownloadUrl,
  Lightbox,
  uploadAttachment,
} from "../detail/attachments.js";
import {
  AttachmentChip,
  stageFiles,
  type StagedAttachment,
} from "../../components/staged-attachments.js";
import type {
  Attachment,
  Comment,
  DisplayComment,
} from "../../shared/contract.js";
import {
  formatFileSize,
  formatRelativeTime,
  splitSystemBody,
  useNowTick,
} from "./time.js";
import { CommentAuthor } from "./comment-author.js";

interface FeedEntry {
  comment: DisplayComment;
  attachments: Attachment[];
}

function useActivityFeed(taskId: string) {
  return useTasksQuery<FeedEntry[]>(
    async (rpc) => {
      const { comments } = await rpc.call("listComments", { taskId });
      const attachments = await Promise.all(
        comments.map((comment) =>
          comment.kind === "system"
            ? Promise.resolve<Attachment[]>([])
            : rpc
                .call("listAttachments", { commentId: comment.id })
                .then((result) => result.attachments),
        ),
      );
      return comments.map((comment, index) => ({
        comment,
        attachments: attachments[index] ?? [],
      }));
    },
    // Attachment uploads publish tasks:changed, not comments:changed.
    ["comments:changed", "tasks:changed"],
    [taskId],
  );
}

export type AgentNotificationTarget =
  | { kind: "ready"; title: string }
  | { kind: "none" }
  | { kind: "unavailable" };

export function agentNotificationTarget(
  comments: readonly DisplayComment[],
): AgentNotificationTarget {
  let latest: DisplayComment | undefined;
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const comment = comments[index];
    if (comment?.kind === "agent") {
      latest = comment;
      break;
    }
  }
  if (!latest) return { kind: "none" };
  if (latest.threadId === null || latest.threadTitle === null) {
    return { kind: "unavailable" };
  }
  return { kind: "ready", title: latest.threadTitle };
}

function UserAvatar({ name }: { name: string }) {
  const initial = (name.trim()[0] ?? "S").toUpperCase();
  return (
    <span
      aria-hidden
      className="z-[1] mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full bg-attention text-2xs font-bold text-background outline outline-2 outline-background"
    >
      {initial}
    </span>
  );
}

function AgentAvatar() {
  return (
    <span
      aria-hidden
      className="z-[1] mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground outline outline-2 outline-background"
    >
      <HugeiconsIcon icon={BotIcon} className="size-3.5" />
    </span>
  );
}

function AttachmentPreview({
  attachment,
  onOpenImage,
}: {
  attachment: Attachment;
  onOpenImage: (attachment: Attachment) => void;
}) {
  const url = attachmentDownloadUrl(attachment.id);
  if (attachment.isImage) {
    return (
      <figure className="m-0 flex flex-col">
        <button
          type="button"
          aria-label={`View ${attachment.fileName}`}
          onClick={() => onOpenImage(attachment)}
        >
          <img
            src={url}
            alt={attachment.fileName}
            className="h-24 w-[150px] cursor-zoom-in rounded-md border border-border bg-muted object-cover hover:border-input"
          />
        </button>
        <figcaption className="mt-0.5 max-w-[150px] truncate text-2xs text-muted-foreground">
          {attachment.fileName}
        </figcaption>
      </figure>
    );
  }
  return (
    <a
      href={url}
      download={attachment.fileName}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-2xs hover:border-input"
    >
      <span className="flex size-6 items-center justify-center rounded-sm bg-secondary text-muted-foreground">
        <HugeiconsIcon icon={File01Icon} className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block truncate">{attachment.fileName}</span>
        <small className="block text-2xs text-muted-foreground">
          {formatFileSize(attachment.sizeBytes)}
        </small>
      </span>
    </a>
  );
}

function SystemEvent({ comment, nowMs }: { comment: Comment; nowMs: number }) {
  return (
    <div className="relative z-[1] my-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span
        aria-hidden
        className="mx-[7px] size-2 shrink-0 rounded-full border-2 border-muted bg-card"
      />
      <span className="min-w-0 truncate">
        {splitSystemBody(comment.body, comment.authorName).map(
          (segment, index) =>
            segment.bold ? (
              <span key={index} className="font-medium text-foreground/80">
                {segment.text}
              </span>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
        )}
        <span className="text-muted-foreground/70">
          {" · "}
          {formatRelativeTime(comment.createdAt, nowMs)}
        </span>
      </span>
    </div>
  );
}

function CommentCard({ entry, nowMs }: { entry: FeedEntry; nowMs: number }) {
  const { comment, attachments } = entry;
  const agent = comment.kind === "agent";
  const navigate = useBbNavigate();
  const [lightbox, setLightbox] = useState<Attachment | null>(null);
  return (
    <div className="relative mb-3.5 flex gap-2.5">
      {agent ? <AgentAvatar /> : <UserAvatar name={comment.authorName} />}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-1.5 text-xs">
          <CommentAuthor comment={comment} onOpenThread={navigate.toThread} />
          {agent && comment.presetName ? (
            <span className="rounded-sm bg-secondary px-1 py-px text-2xs font-semibold text-muted-foreground">
              {comment.presetName}
            </span>
          ) : null}
          <time className="text-2xs text-muted-foreground">
            {formatRelativeTime(comment.createdAt, nowMs)}
          </time>
        </div>
        <TasksEditor
          value={comment.body}
          onChange={() => {}}
          readOnly
          variant="comment"
          onOpenThread={(threadId) => navigate.toThread(threadId)}
        />
        {attachments.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <AttachmentPreview
                key={attachment.id}
                attachment={attachment}
                onOpenImage={setLightbox}
              />
            ))}
          </div>
        ) : null}
        {lightbox ? (
          <Lightbox attachment={lightbox} onClose={() => setLightbox(null)} />
        ) : null}
        {comment.kind === "user" && comment.notifiedCount > 0 ? (
          <div className="mt-1 flex items-center gap-1 text-2xs font-medium text-success">
            <HugeiconsIcon icon={Notification02Icon} className="size-2.5" />
            notified the last responding agent
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface ComposerProps {
  taskId: string;
  notificationTarget: AgentNotificationTarget;
}

function CommentComposer({ taskId, notificationTarget }: ComposerProps) {
  const rpc = useTasksRpc();
  const navigate = useBbNavigate();
  const mentionItems = useMentionItems();
  const [body, setBody] = useState("");
  const [notify, setNotify] = useState(true);
  const [pendingFiles, setPendingFiles] = useState<StagedAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const staged = pendingFiles.filter((entry) => entry.status === "staged");
  const canSend = !sending && (body.trim().length > 0 || staged.length > 0);

  const removeFile = (id: number) =>
    setPendingFiles((files) => files.filter((entry) => entry.id !== id));

  // Synchronous single-flight guard: double-activating Retry before React
  // re-renders must not upload (and attach) the same file twice.
  const retryingRef = useRef(new Set<number>());
  const retryUpload = async (entry: StagedAttachment) => {
    if (entry.owner === undefined || retryingRef.current.has(entry.id)) return;
    retryingRef.current.add(entry.id);
    setPendingFiles((files) =>
      files.map((candidate) =>
        candidate.id === entry.id ? { ...candidate, busy: true } : candidate,
      ),
    );
    try {
      await uploadAttachment(entry.file, entry.owner);
      removeFile(entry.id);
      setError(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setPendingFiles((files) =>
        files.map((candidate) =>
          candidate.id === entry.id
            ? { ...candidate, busy: false, error: message }
            : candidate,
        ),
      );
    } finally {
      retryingRef.current.delete(entry.id);
    }
  };

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    const text = body.trim();
    let comment: Comment;
    try {
      comment = (
        await rpc.call("createComment", {
          taskId,
          body: text,
          notify: notify && notificationTarget.kind === "ready",
          allowEmptyBody: text.length === 0,
        })
      ).comment;
    } catch (cause) {
      // Nothing posted: keep the draft and chips for another attempt.
      setError(cause instanceof Error ? cause.message : String(cause));
      setSending(false);
      return;
    }
    // The comment is now posted — clear the text so a later upload failure
    // can't double-post it. Failed uploads stay behind as retryable chips.
    setBody("");
    const failed: StagedAttachment[] = [];
    for (const entry of staged) {
      try {
        await uploadAttachment(entry.file, { commentId: comment.id });
      } catch (cause) {
        failed.push({
          ...entry,
          status: "failed",
          owner: { commentId: comment.id },
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    // Sent entries leave the tray (failures come back as retryable chips);
    // anything staged after send started is untouched.
    setPendingFiles((files) =>
      files.flatMap((entry) => {
        const failure = failed.find((candidate) => candidate.id === entry.id);
        if (failure) return [failure];
        return staged.some((candidate) => candidate.id === entry.id)
          ? []
          : [entry];
      }),
    );
    if (failed.length > 0) {
      setError(
        `The comment posted, but ${failed.length} attachment${failed.length > 1 ? "s" : ""} failed to upload — retry below.`,
      );
    }
    setSending(false);
  };

  return (
    <div className="mt-3.5 rounded-lg border border-border bg-card px-3.5 pb-2.5 pt-3 shadow-2xs transition-colors focus-within:border-input focus-within:ring-1 focus-within:ring-ring">
      <TasksEditor
        value={body}
        onChange={setBody}
        variant="comment"
        placeholder="Leave a comment… @-mention tasks and threads to link them"
        className="min-h-11"
        mentionItems={mentionItems}
        onOpenThread={(threadId) => navigate.toThread(threadId)}
      />
      {pendingFiles.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pendingFiles.map((entry) => (
            <AttachmentChip
              key={entry.id}
              entry={entry}
              onRemove={() => removeFile(entry.id)}
              onRetry={
                entry.status === "failed"
                  ? () => void retryUpload(entry)
                  : undefined
              }
            />
          ))}
        </div>
      ) : null}
      {error ? (
        <div className="mt-2 text-xs text-destructive">{error}</div>
      ) : null}
      <div className="mt-2 flex items-center gap-1.5">
        <AgentNotificationControl
          target={notificationTarget}
          checked={notify}
          onCheckedChange={setNotify}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            if (files.length > 0)
              setPendingFiles((current) => [...current, ...stageFiles(files)]);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Attach file"
          className="size-6.5 text-muted-foreground"
          onClick={() => fileInputRef.current?.click()}
        >
          <HugeiconsIcon icon={AttachmentIcon} className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon"
          aria-label="Comment"
          disabled={!canSend}
          className="size-6.5 rounded-md bg-foreground text-background hover:bg-foreground/90"
          onClick={() => void send()}
        >
          <HugeiconsIcon icon={ArrowUp02Icon} className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function AgentNotificationControl({
  target,
  checked,
  onCheckedChange,
}: {
  target: AgentNotificationTarget;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const enabled = target.kind === "ready";
  const label =
    target.kind === "ready"
      ? `Notify ${target.title}`
      : target.kind === "none"
        ? "No prior agent reply to notify"
        : "Latest responding agent can’t be notified";
  return (
    <label className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
      <HugeiconsIcon icon={Notification02Icon} className="size-3" />
      <Switch
        checked={enabled && checked}
        disabled={!enabled}
        onCheckedChange={onCheckedChange}
        aria-label="Notify last responding agent"
      />
      {label}
    </label>
  );
}

export interface TaskActivityProps {
  taskId: string;
  /** Task key like TSK-4; reserved for deep links from feed entries. */
  taskKey: string;
}

/** Activity feed + comment composer for the task detail page. */
export function TaskActivity({ taskId }: TaskActivityProps) {
  const feed = useActivityFeed(taskId);
  const nowMs = useNowTick();
  const entries = feed.data ?? [];
  const notificationTarget = useMemo(
    () => agentNotificationTarget(entries.map((entry) => entry.comment)),
    [entries],
  );

  return (
    <section aria-label="Activity">
      <div className="mt-6 border-t border-border-hairline" />
      <h2 className="pb-3 pt-4 text-sm font-semibold">Activity</h2>
      <div
        className={cn(
          "relative",
          entries.length > 0 &&
            "before:absolute before:bottom-1.5 before:left-[11px] before:top-1.5 before:w-px before:bg-border-hairline",
        )}
      >
        {feed.error ? (
          <div className="text-xs text-destructive">{feed.error}</div>
        ) : null}
        {entries.length === 0 && !feed.isLoading && !feed.error ? (
          <div className="text-xs text-muted-foreground">No activity yet.</div>
        ) : null}
        {entries.map((entry) =>
          entry.comment.kind === "system" ? (
            <SystemEvent
              key={entry.comment.id}
              comment={entry.comment}
              nowMs={nowMs}
            />
          ) : (
            <CommentCard key={entry.comment.id} entry={entry} nowMs={nowMs} />
          ),
        )}
      </div>
      <CommentComposer
        taskId={taskId}
        notificationTarget={notificationTarget}
      />
    </section>
  );
}

export default TaskActivity;
