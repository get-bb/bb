import { useState } from "react";
import { QueryClient, useQuery } from "@tanstack/react-query";
import {
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { automationResultRpcContract } from "./src/results.js";
import type { automationRpcContract } from "./src/rpc.js";

const queryClient = new QueryClient();
const unavailableMessages = {
  dirty_worktree: "Commit the changes you want to publish first.",
  detached_head: "Create a local branch before publishing.",
  default_branch: "Move your changes to a task branch before publishing.",
  no_changes: "There are no committed changes to publish.",
  repository_unavailable:
    "A GitHub repository is required to publish this result.",
  base_unavailable: "The base branch is not available locally.",
};

export function AutomationResultAction({
  threadId,
  projectId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof automationResultRpcContract>();
  const automations = useRpc<typeof automationRpcContract>();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const query = useQuery(
    {
      queryKey: ["automation-result", threadId],
      queryFn: () => rpc.call("automation_result", { threadId }),
      staleTime: 30_000,
    },
    queryClient,
  );
  useRealtime("automations", () => {
    void query.refetch();
  });
  const result = query.data?.result;
  if (!result) return null;
  const inspection = result.inspection;
  async function publish() {
    if (inspection.status !== "ready" || pending) return;
    setPending(true);
    setError(null);
    try {
      const published = await rpc.call("automation_publish", {
        threadId,
        snapshot: inspection.snapshot,
        title: title.trim() || result!.name,
        body,
      });
      setUrl(published.url);
    } catch (cause) {
      setError(
        `Publication did not finish. The branch may already be pushed. ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setPending(false);
    }
  }
  async function pause() {
    setPending(true);
    try {
      await automations.call("automations_pause", {
        projectId,
        automationId: result!.automationId,
      });
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) void query.refetch();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Review local job result"
        >
          {isCompactViewport ? "Result" : "Review result"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <p className="text-sm font-medium">Review your job result</p>
        {inspection.status === "ready" ? (
          <>
            <p className="break-words text-xs text-muted-foreground">
              {inspection.snapshot.repo} · {inspection.snapshot.branch} →{" "}
              {inspection.snapshot.baseBranch}
              <br />
              Commit {inspection.snapshot.commit.slice(0, 12)}
            </p>
            <Input
              aria-label="Pull request title"
              placeholder={result.name}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={pending}
            />
            <Textarea
              aria-label="Pull request description"
              placeholder="Describe the changes you reviewed"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={pending}
            />
            {url ? (
              <a
                className="text-sm underline"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                Open draft pull request
              </a>
            ) : (
              <Button
                className="w-full"
                onClick={() => void publish()}
                disabled={pending || body.trim().length === 0}
              >
                {pending ? "Working…" : "Push and open draft PR"}
              </Button>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {unavailableMessages[inspection.reason]}
          </p>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Keep local
          </Button>
          <Button
            variant="ghost"
            onClick={() => void pause()}
            disabled={pending}
          >
            Stop this job
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
