import { useMemo, useState } from "react";
import {
  definePluginApp,
  UrlLink,
  useBbNavigate,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { QuestionForm } from "@/components/ui/question-form";
import {
  CODEX_ASYNC_QUESTION_RENDERER_ID,
  asyncQuestionPayloadSchema,
  buildAsyncQuestionFormQuestions,
} from "./src/async-question-form.js";
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

function AsyncQuestionInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = useMemo(
    () => asyncQuestionPayloadSchema.safeParse(interaction.payload),
    [interaction.payload],
  );
  const [busy, setBusy] = useState(false);
  if (!parsed.success) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This question could not be displayed.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void cancel().catch(() => {})}
        >
          Dismiss
        </Button>
      </div>
    );
  }
  return (
    <QuestionForm
      key={interaction.id}
      draftKey={`${interaction.threadId}:${interaction.id}`}
      questions={buildAsyncQuestionFormQuestions(parsed.data.questions)}
      disabled={busy}
      cancelDisabled={busy}
      onSubmit={(answers) => {
        setBusy(true);
        return submit({ answers }).finally(() => setBusy(false));
      }}
      onCancel={cancel}
    />
  );
}

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
          {payload.kind === "computer_use" &&
          (payload.riskLevel === "high" || payload.warning !== null) ? (
            <div
              className={`flex min-w-0 gap-2 rounded-md border px-2.5 py-2 text-xs ${payload.riskLevel === "high" ? "border-surface-destructive-border bg-surface-destructive text-destructive-text" : "border-border bg-surface-raised text-muted-foreground"}`}
            >
              <Icon
                name="AlertTriangle"
                aria-hidden
                className="mt-px size-3.5 shrink-0"
              />
              <div className="min-w-0 space-y-0.5">
                {payload.riskLevel === "high" ? (
                  <p className="font-medium">High risk</p>
                ) : null}
                {payload.warning !== null ? (
                  <p className="whitespace-pre-wrap break-words text-foreground">
                    {payload.warning}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          {payload.kind === "computer_use" ? (
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative shrink-0">
                {payload.app.iconDataUrl ? (
                  <img
                    src={payload.app.iconDataUrl}
                    alt=""
                    className="size-9 object-contain"
                  />
                ) : (
                  <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface-raised text-muted-foreground">
                    <Icon name="AppWindow" aria-hidden className="size-4" />
                  </span>
                )}
                <img
                  src={computerUseIcon}
                  alt=""
                  className="absolute -bottom-0.5 -right-0.5 size-4 rounded-[4px] ring-2 ring-surface-recessed"
                />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {payload.app.name}
                </p>
                <p className="flex min-w-0 gap-1 text-xs text-muted-foreground">
                  <span className="shrink-0">Computer Use</span>
                  <span aria-hidden>·</span>
                  <span className="truncate">{payload.app.id}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  Requested by MCP server{" "}
                  <span className="font-mono">{payload.serverName}</span>
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-raised text-muted-foreground">
                <Icon name="Plug02" aria-hidden className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {payload.serverName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {payload.kind === "tool_approval"
                    ? "MCP server · tool call approval"
                    : "MCP server"}
                </p>
              </div>
            </div>
          )}
          {payload.kind !== "computer_use" &&
          payload.message !== interaction.title ? (
            <p className="whitespace-pre-wrap break-words text-sm text-foreground">
              {payload.message}
            </p>
          ) : null}
          {payload.kind === "form" ? (
            <fieldset
              disabled={busy}
              aria-label="Form fields"
              className="min-w-0 space-y-4"
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
              <div className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-surface-raised px-2.5 py-2">
                <Icon
                  name="Globe"
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div className="min-w-0 text-xs">
                  <p className="break-all font-medium text-foreground">
                    {new URL(payload.url).host}
                  </p>
                  <p className="break-all text-muted-foreground">
                    {payload.url}
                  </p>
                </div>
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
          ) : payload.kind === "tool_approval" ? (
            <div className="min-w-0 space-y-2 rounded-md border border-border bg-surface-raised px-2.5 py-2 text-xs">
              {payload.toolName !== null ? (
                <p className="break-words font-mono font-medium text-foreground">
                  {payload.toolName}
                </p>
              ) : null}
              {payload.toolDescription !== null ? (
                <p className="whitespace-pre-wrap break-words text-muted-foreground">
                  {payload.toolDescription}
                </p>
              ) : null}
              {payload.params.length > 0 ? (
                <dl
                  aria-label="Tool arguments"
                  className="grid min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1"
                >
                  {payload.params.map((param) => (
                    <div key={param.name} className="contents">
                      <dt className="truncate text-muted-foreground">
                        {param.label}
                      </dt>
                      <dd className="min-w-0 whitespace-pre-wrap break-all font-mono text-foreground">
                        {param.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-muted-foreground">No arguments</p>
              )}
              {payload.omittedParamCount > 0 ? (
                <p className="text-muted-foreground">
                  {payload.omittedParamCount} more{" "}
                  {payload.omittedParamCount === 1 ? "argument" : "arguments"}{" "}
                  not shown
                </p>
              ) : null}
            </div>
          ) : payload.kind === "unsupported" ? (
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {payload.reason}
            </p>
          ) : null}
          <footer
            className={`flex flex-wrap items-center justify-between gap-2 ${payload.kind === "form" ? "sticky -bottom-3 z-10 -mx-3 -mb-3 border-t border-border-hairline bg-surface-recessed-solid px-3 pb-3 pt-2.5" : "mt-1"}`}
          >
            {(payload.kind === "computer_use" ||
              payload.kind === "tool_approval") &&
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
              ) : payload.kind === "tool_approval" ? (
                <>
                  {payload.scopes.includes("session") ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void respond({ action: "accept", persist: "session" })
                      }
                    >
                      Allow for this session
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void respond({ action: "accept" })}
                  >
                    Allow
                  </Button>
                </>
              ) : payload.kind === "form" ? (
                <Button type="submit" size="sm" disabled={busy}>
                  {payload.fields.length === 0 ? "Accept" : "Submit response"}
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
    id: CODEX_ASYNC_QUESTION_RENDERER_ID,
    component: AsyncQuestionInteraction,
  });
  app.slots.pendingInteraction({
    id: "mcp-elicitation",
    component: CodexMcpElicitation,
  });
});
