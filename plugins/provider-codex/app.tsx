import { useMemo, useState } from "react";
import {
  definePluginApp,
  UrlLink,
  useBbNavigate,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { computerUseIcon } from "./src/computer-use-icon.js";
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
      className="flex min-w-0 flex-col gap-3"
      aria-busy={busy}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submitForm();
      }}
    >
      {payload ? (
        <>
          {payload.kind === "computer_use" ? (
            <>
              <header className="flex items-center gap-2 text-xs text-muted-foreground">
                <img
                  src={computerUseIcon}
                  alt=""
                  className="size-5 rounded object-contain"
                />
                <span>Computer Use</span>
              </header>
              <div className="min-w-0 space-y-2">
                <h3 className="break-words text-sm font-medium leading-5 text-foreground">
                  Allow Codex to use{" "}
                  <span
                    className="inline-flex items-center gap-1 align-bottom"
                    title={payload.app.id}
                  >
                    {payload.app.iconDataUrl ? (
                      <img
                        src={payload.app.iconDataUrl}
                        alt=""
                        className="size-5 shrink-0 object-contain"
                      />
                    ) : (
                      <Icon
                        name="AppWindow"
                        aria-hidden
                        className="size-4 shrink-0"
                      />
                    )}
                    {payload.app.name}
                  </span>
                  ?
                </h3>
                {payload.riskLevel === "high" ? (
                  <p className="text-xs font-medium text-destructive-text">
                    High risk
                  </p>
                ) : null}
                {payload.warning !== null ? (
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                    {payload.warning}
                  </p>
                ) : null}
              </div>
            </>
          ) : (
            <header className="min-w-0 space-y-0.5">
              <h3 className="whitespace-pre-wrap break-words text-sm font-semibold text-foreground">
                {payload.message}
              </h3>
              <p className="text-xs text-muted-foreground">
                <span>{payload.serverName}</span> requests information
              </p>
            </header>
          )}
          {payload.kind === "form" ? (
            <fieldset
              disabled={busy}
              aria-label="Form fields"
              className="max-h-[50dvh] min-w-0 space-y-4 overflow-y-auto overscroll-contain pb-2 pr-1"
              style={{
                maskImage:
                  "linear-gradient(to bottom, black calc(100% - 8px), transparent)",
              }}
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
              <div className="flex min-w-0 items-center gap-3 rounded-md border border-input p-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground">
                  <Icon name="Globe" className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="break-all text-sm font-medium text-foreground">
                    {new URL(payload.url).host}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    {payload.url}
                  </p>
                </div>
                <Icon
                  name="ArrowUpRight"
                  className="size-3 shrink-0"
                  aria-hidden
                />
              </div>
              {urlOpened && !busy ? (
                <UrlLink
                  href={payload.url}
                  className="text-sm text-primary underline"
                >
                  Open link again
                </UrlLink>
              ) : null}
            </div>
          ) : payload.kind === "unsupported" ? (
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {payload.reason}
            </p>
          ) : null}
          <footer
            className={`relative flex flex-wrap items-center justify-between gap-2 ${payload.kind === "form" ? "-mt-3 pt-2" : ""}`}
          >
            {payload.kind === "computer_use" &&
            payload.scopes.includes("always") ? (
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
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void respond({ action: "decline" })}
              >
                Decline
              </Button>
              {payload.kind === "computer_use" ? (
                payload.scopes.includes("session") ? (
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
                ) : null
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
                  <Icon name="ArrowUpRight" className="size-3" aria-hidden />
                </Button>
              ) : null}
            </div>
          </footer>
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
    experimental_hideHeader: true,
    component: CodexMcpElicitation,
  });
});
