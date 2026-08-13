import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";

export interface SerialSendBarProps {
  connected: boolean;
  busy: boolean;
  review(data: string): Promise<string | null>;
  send(data: string, sendToken: string): Promise<boolean>;
}

export function SerialSendBar({ connected, busy, review, send }: SerialSendBarProps): React.JSX.Element {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<{ data: string; sendToken: string } | null>(null);
  const command = value.startsWith("~") ? value.slice(1) : null;
  const prepare = (data: string): void => {
    void review(data).then((sendToken) => {
      if (sendToken) setPending({ data, sendToken });
    });
  };

  return (
    <div className="border-t border-border bg-card p-2" data-state={pending ? "confirming" : "idle"}>
      {pending !== null ? (
        <div className="mb-2 rounded-md border border-border bg-muted/30 p-2 text-xs">
          <p className="font-medium text-foreground">Send these bytes to the device?</p>
          <code className="mt-1 block max-h-20 overflow-auto whitespace-pre-wrap break-all font-mono text-muted-foreground">{pending.data}</code>
          <div className="mt-2 flex gap-2">
            <Button
              disabled={busy}
              onClick={() => void send(pending.data, pending.sendToken).then((sent) => {
                if (sent) {
                  setPending(null);
                  setValue("");
                }
              })}
              size="sm"
            >
              <Icon name="Sent" />
              Confirm send
            </Button>
            <Button disabled={busy} onClick={() => setPending(null)} size="sm" variant="outline">
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input
          aria-label="Serial command"
          className="h-8 font-mono text-xs"
          disabled={!connected || busy || pending !== null}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && command !== null && command.length > 0) {
              event.preventDefault();
              prepare(command);
            }
          }}
          placeholder="~AT+PING"
          value={value}
        />
        <Button
          disabled={!connected || busy || command === null || command.length === 0 || pending !== null}
          onClick={() => command !== null && prepare(command)}
          size="sm"
          variant="outline"
        >
          Review
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Only <code className="font-mono">~</code>-prefixed input can send; all other text is inert.
      </p>
    </div>
  );
}
