import { useMemo, useState } from "react";
import {
  definePluginApp,
  UrlLink,
  useBbNavigate,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import {
  codexMcpElicitationSchema,
  validateCodexMcpFormContent,
  type CodexMcpElicitationResponse,
} from "./src/mcp-elicitation.js";
import {
  CodexMcpElicitationField,
  type CodexMcpFormDraftValue,
} from "./src/mcp-elicitation-fields.js";

type SubmissionState =
  | { status: "ready" }
  | { status: "pending" }
  | { status: "failed"; message: string };

function CodexMcpElicitation({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const navigate = useBbNavigate();
  const parsed = useMemo(
    () => codexMcpElicitationSchema.safeParse(interaction.payload),
    [interaction.payload],
  );
  const payload = parsed.success ? parsed.data : null;
  const [submission, setSubmission] = useState<SubmissionState>({
    status: "ready",
  });
  const [drafts, setDrafts] = useState<Map<string, CodexMcpFormDraftValue>>(
    () =>
      payload?.kind === "form"
        ? new Map<string, CodexMcpFormDraftValue>(
            payload.fields.flatMap((field) =>
              field.defaultValue === null
                ? []
                : [
                    [
                      field.name,
                      typeof field.defaultValue === "number"
                        ? String(field.defaultValue)
                        : field.defaultValue,
                    ],
                  ],
            ),
          )
        : new Map(),
  );
  const [formErrors, setFormErrors] = useState<{
    fields: Map<string, string>;
    formError: string | null;
  }>({ fields: new Map(), formError: null });
  const [urlOpened, setUrlOpened] = useState(false);
  const busy = submission.status === "pending";

  const respond = async (response: CodexMcpElicitationResponse) => {
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

  const submitForm = () => {
    if (busy || payload?.kind !== "form") return;
    const content = Object.fromEntries(
      payload.fields.flatMap<[string, CodexMcpFormDraftValue | number]>(
        (field) => {
          const value = drafts.get(field.name);
          if (value === undefined) return [];
          if (field.kind === "number" || field.kind === "integer") {
            if (typeof value === "string" && value.trim() === "") return [];
            return [[field.name, Number(value)]];
          }
          return [[field.name, value]];
        },
      ),
    );
    const result = validateCodexMcpFormContent(payload.fields, content);
    if (!result.success) {
      setSubmission({ status: "ready" });
      setFormErrors({
        fields: new Map(Object.entries(result.errors)),
        formError: result.formError,
      });
      return;
    }
    setFormErrors({ fields: new Map(), formError: null });
    void respond({ action: "accept", content: result.data });
  };

  const openRequestedUrl = () => {
    if (busy || payload?.kind !== "url") return;
    if (!urlOpened) {
      try {
        if (!navigate.openUrl(payload.url)) {
          setSubmission({
            status: "failed",
            message:
              "Could not open this link. Try again or decline the request.",
          });
          return;
        }
      } catch {
        setSubmission({
          status: "failed",
          message:
            "Could not open this link. Try again or decline the request.",
        });
        return;
      }
      setUrlOpened(true);
    }
    void respond({ action: "accept" });
  };

  return (
    <form
      className="space-y-4"
      aria-busy={busy}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submitForm();
      }}
    >
      {payload ? (
        <>
          <div className="min-w-0 space-y-1">
            <p className="break-words text-xs text-muted-foreground">
              MCP server:{" "}
              <span className="font-medium text-foreground">
                {payload.serverName}
              </span>
            </p>
            {payload.message !== interaction.title ? (
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                {payload.message}
              </p>
            ) : null}
          </div>
          {payload.kind === "computer_use" ? (
            <div className="min-w-0 space-y-1">
              <p className="break-words text-sm font-medium text-foreground">
                {payload.app.name}
              </p>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {payload.app.id}
              </p>
              <p
                className={`text-xs font-medium ${payload.riskLevel === "high" ? "text-destructive-text" : "text-muted-foreground"}`}
              >
                {payload.riskLevel === "high" ? "High risk" : "Low risk"}
              </p>
              {payload.warning !== null ? (
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                  {payload.warning}
                </p>
              ) : null}
            </div>
          ) : payload.kind === "form" ? (
            <fieldset
              disabled={busy}
              className="max-h-[50dvh] min-w-0 space-y-4 overflow-y-auto overscroll-contain"
            >
              {payload.fields.map((field) => (
                <CodexMcpElicitationField
                  key={field.name}
                  field={field}
                  value={drafts.get(field.name)}
                  error={formErrors.fields.get(field.name)}
                  disabled={busy}
                  onChange={(value) => {
                    setDrafts((current) => {
                      const next = new Map(current);
                      if (value === undefined) next.delete(field.name);
                      else next.set(field.name, value);
                      return next;
                    });
                    setFormErrors((current) => {
                      const next = new Map(current.fields);
                      next.delete(field.name);
                      return { ...current, fields: next };
                    });
                  }}
                />
              ))}
              {formErrors.formError ? (
                <p role="alert" className="text-sm text-destructive-text">
                  {formErrors.formError}
                </p>
              ) : null}
            </fieldset>
          ) : payload.kind === "url" ? (
            <div className="space-y-2">
              <p className="break-all font-mono text-xs text-foreground">
                {payload.url}
              </p>
              <p className="text-sm text-muted-foreground">
                {urlOpened
                  ? "The link was opened. Your response still needs to be sent."
                  : "Complete any remaining steps on the destination page after opening this link."}
              </p>
              {urlOpened && !busy ? (
                <UrlLink
                  href={payload.url}
                  className="text-sm text-primary underline"
                >
                  Open link again
                </UrlLink>
              ) : null}
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {payload.reason}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {payload.kind === "computer_use" ? (
              <>
                {payload.scopes.includes("session") ? (
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
                {payload.scopes.includes("always") ? (
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
              </>
            ) : payload.kind === "form" ? (
              <Button type="submit" size="sm" disabled={busy}>
                Submit response
              </Button>
            ) : payload.kind === "url" ? (
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={openRequestedUrl}
              >
                {urlOpened
                  ? "Retry response"
                  : `Open ${new URL(payload.url).host}`}
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
          This request could not be displayed.
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
      {!payload || submission.status === "failed" ? (
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
    </form>
  );
}

export default definePluginApp((app) => {
  app.slots.pendingInteraction({
    id: "mcp-elicitation",
    component: CodexMcpElicitation,
  });
});
