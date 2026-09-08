import { useClipboardCopy } from "@/lib/clipboard";
import { useEffect, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { sdk } from "@/lib/sdk";

export function MachineEnrollmentCommand({
  id,
  scope,
}: {
  id: string;
  scope: "launch" | "thread";
}) {
  const [command, setCommand] = useState<string | null>(null);
  const { copy, copied } = useClipboardCopy({ text: command ?? "" });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setCommand(null);
    const poll = async () => {
      try {
        const result = await sdk.hosts.experimental_enrollmentCommand({
          id,
          scope,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setCommand(result.command);
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
  if (command === null) return null;
  return (
    <div className="space-y-2 p-3">
      <p className="text-sm">Run on the target machine:</p>
      <pre className="whitespace-pre-wrap break-all rounded-md border border-border p-3 font-mono text-xs">
        {command}
      </pre>
      <Button variant="outline" size="sm" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy command"}
      </Button>
    </div>
  );
}
