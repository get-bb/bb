import { useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp02Icon,
  AttachmentIcon,
  BotIcon,
  Cancel01Icon,
  File01Icon,
  Notification02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { TasksEditor } from "../../editor/tasks-editor.js";
import { useTasksQuery, useTasksRpc } from "../../shell/data.js";
import type { Attachment, Comment, TaskThread } from "../../shared/contract.js";
import {
  formatFileSize,
  formatRelativeTime,
  splitSystemBody,
  useNowTick,
} from "./time.js";

const PLUGIN_HTTP_BASE = "/api/v1/plugins/tasks/http";
const TOKEN_URL = "/api/v1/plugins/tasks/token";

// The plugin HTTP token is stable across requests (rotation is an explicit
// admin action), so one fetch per page load is enough.
let tokenPromise: Promise<string> | null = null;

async function fetchPluginToken(): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) {
    throw new Error(`token request failed with status ${response.status}`);
  }
  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("token" in payload) ||
    typeof payload.token !== "string"
  ) {
    throw new Error("token request returned an unexpected payload");
  }
  return payload.token;
}

function pluginToken(): Promise<string> {
  tokenPromise ??= fetchPluginToken().catch((error: unknown) => {
    tokenPromise = null;
    throw error;
  });
  return tokenPromise;
}

async function uploadCommentAttachment(
  commentId: string,
  file: File,
): Promise<void> {
  const token = await pluginToken();
  const mime = file.type || "application/octet-stream";
  const query = new URLSearchParams({
    commentId,
    fileName: file.name,
    mime,
  });
  const response = await fetch(
    `${PLUGIN_HTTP_BASE}/attachments/upload?${query.toString()}`,
    {
      method: "POST",
      headers: { "x-bb-plugin-token": token, "Content-Type": mime },
      body: file,
    },
  );
  if (!response.ok) {
    throw new Error(`upload of ${file.name} failed (${response.status})`);
  }
}

function attachmentDownloadUrl(attachmentId: string): string {
  return `${PLUGIN_HTTP_BASE}/attachments/download?attachmentId=${encodeURIComponent(attachmentId)}`;
}

interface FeedEntry {
  comment: Comment;
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

function isRunning(thread: TaskThread): boolean {
  return thread.liveStatus === "starting" || thread.liveStatus === "working";
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

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const url = attachmentDownloadUrl(attachment.id);
  if (attachment.isImage) {
    return (
      <figure className="m-0 flex flex-col">
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={attachment.fileName}
            className="h-24 w-[150px] cursor-zoom-in rounded-md border border-border bg-muted object-cover hover:border-input"
          />
        </a>
        <figcaption className="mt-0.5 max-w-[150px] truncate text-2xs text-muted-foreground">
          {attachment.fileName}
        </figcaption>
      </figure>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
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

function CommentCard({
  entry,
  nowMs,
}: {
  entry: FeedEntry;
  nowMs: number;
}) {
  const { comment, attachments } = entry;
  const agent = comment.kind === "agent";
  return (
    <div className="relative mb-3.5 flex gap-2.5">
      {agent ? <AgentAvatar /> : <UserAvatar name={comment.authorName} />}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-baseline gap-1.5 text-xs">
          <span className="font-semibold">{comment.authorName}</span>
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
        />
        {attachments.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <AttachmentPreview key={attachment.id} attachment={attachment} />
            ))}
          </div>
        ) : null}
        {comment.kind === "user" && comment.notifiedCount > 0 ? (
          <div className="mt-1 flex items-center gap-1 text-2xs font-medium text-success">
            <HugeiconsIcon icon={Notification02Icon} className="size-2.5" />
            notified {comment.notifiedCount} working agent
            {comment.notifiedCount > 1 ? "s" : ""}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface ComposerProps {
  taskId: string;
  runningCount: number;
}

function CommentComposer({ taskId, runningCount }: ComposerProps) {
  const rpc = useTasksRpc();
  const [body, setBody] = useState("");
  const [notify, setNotify] = useState(true);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = body.trim().length > 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const { comment } = await rpc.call("createComment", {
        taskId,
        body: body.trim(),
        notify: notify && runningCount > 0,
      });
      for (const file of pendingFiles) {
        await uploadCommentAttachment(comment.id, file);
      }
      setBody("");
      setPendingFiles([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-3.5 rounded-lg border border-border bg-card px-3.5 pb-2.5 pt-3 shadow-2xs transition-colors focus-within:border-input focus-within:ring-1 focus-within:ring-ring">
      <TasksEditor
        value={body}
        onChange={setBody}
        variant="comment"
        placeholder="Leave a comment…"
        className="min-h-11"
      />
      {pendingFiles.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pendingFiles.map((file, index) => (
            <span
              key={`${file.name}-${index}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <HugeiconsIcon
                icon={File01Icon}
                className="size-3 text-muted-foreground"
              />
              <span className="max-w-40 truncate">{file.name}</span>
              <span className="text-2xs text-muted-foreground">
                {formatFileSize(file.size)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setPendingFiles((files) =>
                    files.filter((_, at) => at !== index),
                  )
                }
              >
                <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {error ? (
        <div className="mt-2 text-xs text-destructive">{error}</div>
      ) : null}
      <div className="mt-2 flex items-center gap-1.5">
        {runningCount > 0 ? (
          <label className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            <HugeiconsIcon icon={Notification02Icon} className="size-3" />
            <Switch
              checked={notify}
              onCheckedChange={setNotify}
              aria-label="Notify working agents"
            />
            Notify {runningCount} working agent{runningCount > 1 ? "s" : ""}
          </label>
        ) : (
          <span className="mr-auto" />
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            if (files.length > 0)
              setPendingFiles((current) => [...current, ...files]);
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

export interface TaskActivityProps {
  taskId: string;
  /** Task key like TSK-4; reserved for deep links from feed entries. */
  taskKey: string;
}

/** Activity feed + comment composer for the task detail page. */
export function TaskActivity({ taskId }: TaskActivityProps) {
  const feed = useActivityFeed(taskId);
  const threads = useTasksQuery(
    async (rpc) => (await rpc.call("listTaskThreads", { taskId })).taskThreads,
    ["threads:changed"],
    [taskId],
  );
  const nowMs = useNowTick();
  const runningCount = useMemo(
    () => (threads.data ?? []).filter(isRunning).length,
    [threads.data],
  );
  const entries = feed.data ?? [];

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
      <CommentComposer taskId={taskId} runningCount={runningCount} />
    </section>
  );
}

export default TaskActivity;
