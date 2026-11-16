import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Textarea } from "@bb/shared-ui/textarea";
import type { TimelineViewDelegationWorkRow } from "@bb/thread-view";
import { sdk } from "@/lib/sdk";

export function SubagentActionControls({
  row,
}: {
  row: TimelineViewDelegationWorkRow;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<"tell" | "cancel" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (row.childRef === null) return null;
  const childRef = row.childRef;

  const run = async (kind: "tell" | "cancel") => {
    setPending(kind);
    setMessage(null);
    try {
      if (kind === "tell") {
        const result = await sdk.threads.subagents.tell({
          threadId: row.threadId,
          childRef,
          text,
        });
        setMessage(`Message ${result.messageId} accepted`);
        setText("");
      } else {
        await sdk.threads.subagents.cancel({
          threadId: row.threadId,
          childRef,
        });
        setMessage(`Subagent ${childRef} cancelled`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border p-2">
      <Textarea
        aria-label={`Message subagent ${childRef}`}
        className="min-h-16 text-xs"
        maxLength={64_000}
        placeholder="Message this subagent"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={
            pending !== null || row.status !== "pending" || text.trim() === ""
          }
          onClick={() => void run("tell")}
        >
          Message
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending !== null || row.status !== "pending"}
          onClick={() => void run("cancel")}
        >
          Cancel subagent
        </Button>
      </div>
      {message && (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
