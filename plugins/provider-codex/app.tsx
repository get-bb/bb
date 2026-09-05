import { useMemo, useState } from "react";
import {
  definePluginApp,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import {
  codexComputerUsePermissionSchema,
  type CodexComputerUsePermissionResponse,
} from "./src/mcp-elicitation.js";

type SubmissionState =
  | { status: "ready" }
  | { status: "pending" }
  | { status: "failed"; message: string };

function CodexMcpElicitation({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = useMemo(
    () => codexComputerUsePermissionSchema.safeParse(interaction.payload),
    [interaction.payload],
  );
  const [submission, setSubmission] = useState<SubmissionState>({
    status: "ready",
  });
  const busy = submission.status === "pending";

  const respond = async (response: CodexComputerUsePermissionResponse) => {
    if (busy) return;
    setSubmission({ status: "pending" });
    try {
      await submit(response);
    } catch {
      setSubmission({
        status: "failed",
        message: "Could not send this response. Try again or stop the turn.",
      });
    }
  };

  const stopTurn = async () => {
    if (busy) return;
    setSubmission({ status: "pending" });
    try {
      await cancel();
    } catch {
      setSubmission({
        status: "failed",
        message: "Could not stop this turn. Try again.",
      });
    }
  };

  return (
    <div className="space-y-3" aria-busy={busy}>
      {parsed.success ? (
        <>
          <div className="min-w-0 space-y-1">
            <p className="break-words text-sm font-medium text-foreground">
              {parsed.data.app.name}
            </p>
            <p className="break-all font-mono text-xs text-muted-foreground">
              {parsed.data.app.id}
            </p>
            {parsed.data.message !== interaction.title ? (
              <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {parsed.data.message}
              </p>
            ) : null}
            <p
              className={`text-xs font-medium ${parsed.data.riskLevel === "high" ? "text-destructive-text" : "text-muted-foreground"}`}
            >
              {parsed.data.riskLevel === "high" ? "High risk" : "Low risk"}
            </p>
            {parsed.data.warning !== null ? (
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                {parsed.data.warning}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {parsed.data.scopes.includes("session") ? (
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void respond({ action: "accept", persist: "session" })
                }
              >
                Allow for this session
              </Button>
            ) : null}
            {parsed.data.scopes.includes("always") ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void respond({ action: "accept", persist: "always" })
                }
              >
                Always allow
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void respond({ action: "decline" })}
            >
              Decline
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void respond({ action: "cancel" })}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground" role="alert">
          This app permission request could not be displayed.
        </p>
      )}
      {submission.status === "failed" ? (
        <p className="text-sm text-destructive-text" role="alert">
          {submission.message}
        </p>
      ) : null}
      {busy ? (
        <p className="text-xs text-muted-foreground" role="status">
          Sending response…
        </p>
      ) : null}
      {!parsed.success || submission.status === "failed" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void stopTurn()}
        >
          Stop turn
        </Button>
      ) : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.pendingInteraction({
    id: "mcp-elicitation",
    component: CodexMcpElicitation,
  });
});
