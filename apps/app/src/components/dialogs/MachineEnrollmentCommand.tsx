import { useClipboardCopy } from "@/lib/clipboard";
import { useEffect, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { sdk } from "@/lib/sdk";

export function MachineEnrollmentCommand({
  id,
  scope,
  onRegenerate,
  onExpired,
}: {
  id: string;
  scope: "launch" | "thread";
  onRegenerate?: () => Promise<void>;
  onExpired?: () => void;
}) {
  const [command, setCommand] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining =
    expiresAt === null
      ? null
      : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const expired = remaining === 0;
  useEffect(() => {
    if (expired) onExpired?.();
  }, [expired, onExpired]);
  const { copy, copied } = useClipboardCopy({
    text: expired ? "" : (command ?? ""),
  });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setCommand(null);
    setExpiresAt(null);
    setRegenerating(false);
    setError(null);
    const poll = async () => {
      try {
        const result = await sdk.hosts.experimental_enrollmentCommand({
          id,
          scope,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setCommand(result.command);
          setExpiresAt(
            (previous) =>
              result.expiresAt ??
              (previous !== null && previous <= Date.now() ? previous : null),
          );
          setNow(Date.now());
        }
      } catch {
        if (!controller.signal.aborted) setCommand(null);
      }
      if (!controller.signal.aborted)
        timer = setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, scope]);
  if (command === null && !expired) return null;
  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted/30">
      {expired ? (
        <div className="space-y-1 p-3">
          <p className="text-sm font-medium">Code expired</p>
          <p className="text-xs text-subtle-foreground">
            {onRegenerate
              ? "Generate a new command to connect this machine."
              : "Restart machine setup to generate a new command."}
          </p>
        </div>
      ) : (
        <pre className="whitespace-pre-wrap break-all p-3 font-mono text-xs">
          {command}
        </pre>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
        <span className="text-xs text-subtle-foreground">
          {!expired && remaining !== null
            ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
            : ""}
        </span>
        {expired ? (
          onRegenerate && (
            <Button
              variant="outline"
              size="sm"
              disabled={regenerating}
              onClick={async () => {
                setRegenerating(true);
                setError(null);
                try {
                  await onRegenerate();
                } catch {
                  setError("Could not generate a new command. Try again.");
                  setRegenerating(false);
                }
              }}
            >
              {regenerating ? "Generating…" : "Generate new command"}
            </Button>
          )
        ) : (
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy command"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="px-3 pb-3 text-xs text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}
