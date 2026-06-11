import { useId, useState, type FormEvent } from "react";
import {
  jsonValueSchema,
  workflowSandboxValues,
  type AvailableModel,
  type Host,
  type JsonValue,
  type ProviderInfo,
  type WorkflowSandbox,
} from "@bb/domain";
import type { HostDaemonWorkflowListing } from "@bb/host-daemon-contract";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import {
  OptionPicker,
  type PickerOption,
} from "@/components/pickers/OptionPicker";
import { useSystemExecutionOptions } from "@/hooks/queries/system-queries";

export interface WorkflowRunDialogTarget {
  workflow: HostDaemonWorkflowListing;
}

/**
 * Everything a launch needs beyond the project context the opener already
 * holds. `undefined` override fields fall through to the workflow meta
 * default, then server policy — the dialog never fills policy defaults
 * itself (the server owns them and 422s anything out of bounds).
 */
export interface WorkflowRunLaunchInput {
  args: JsonValue | undefined;
  budgetOutputTokens: number | undefined;
  /** Per-dialog-open idempotency key so a retried launch converges on one run. */
  clientRequestId: string;
  /** Explicit host, set only when the project offers a real choice. */
  hostId: string | undefined;
  model: string | undefined;
  providerId: string | undefined;
  sandbox: WorkflowSandbox | undefined;
  workflowName: string;
}

interface WorkflowRunDialogSharedProps {
  /** All known hosts — display source for the host picker (multi-source projects only). */
  hosts: Host[];
  /**
   * Distinct ids of hosts holding a local-path source for the project,
   * derived synchronously from the project's sources (never from the async
   * hosts query, so the host-select gate cannot race a slow hosts fetch).
   * The host select renders only when there is more than one (single-source
   * projects need no host prompt).
   */
  sourceHostIds: string[];
  /** Initial host selection — the project's default source host. */
  defaultHostId: string | null;
  pending: boolean;
  /** Server launch failure (policy/validation 422s included), rendered inline. */
  errorMessage: string | null;
  onLaunch: (input: WorkflowRunLaunchInput) => void;
}

interface WorkflowRunDialogProps extends WorkflowRunDialogSharedProps {
  target: WorkflowRunDialogTarget | null;
  onOpenChange: (open: boolean) => void;
}

export function WorkflowRunDialog({
  target,
  onOpenChange,
  ...shared
}: WorkflowRunDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target ? (
          <WiredWorkflowRunDialogContent
            key={target.workflow.name}
            workflow={target.workflow}
            {...shared}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface WiredWorkflowRunDialogContentProps
  extends WorkflowRunDialogSharedProps {
  workflow: HostDaemonWorkflowListing;
}

/**
 * Wires the composer's provider/model source (`useSystemExecutionOptions`)
 * to the presentational content. Provider selection lives here because the
 * model list re-queries per effective provider.
 */
function WiredWorkflowRunDialogContent({
  workflow,
  ...props
}: WiredWorkflowRunDialogContentProps) {
  const [providerOverride, setProviderOverride] = useState("");
  const effectiveProviderId = providerOverride || workflow.defaultProvider || "";
  const executionOptionsQuery = useSystemExecutionOptions({
    ...(effectiveProviderId ? { providerId: effectiveProviderId } : {}),
  });

  return (
    <WorkflowRunDialogContent
      {...props}
      models={
        effectiveProviderId ? (executionOptionsQuery.data?.models ?? []) : []
      }
      onProviderOverrideChange={setProviderOverride}
      providerOverride={providerOverride}
      providers={executionOptionsQuery.data?.providers ?? []}
      workflow={workflow}
    />
  );
}

export interface WorkflowRunDialogContentProps
  extends WorkflowRunDialogSharedProps {
  workflow: HostDaemonWorkflowListing;
  /** Provider catalog (the composer's source). */
  providers: ProviderInfo[];
  /** Models for the effective provider; empty while no provider is known. */
  models: AvailableModel[];
  /** "" = workflow default (meta `defaultProvider`, else server policy). */
  providerOverride: string;
  onProviderOverrideChange: (providerId: string) => void;
}

interface ParsedLaunchFields {
  args: JsonValue | undefined;
  budgetOutputTokens: number | undefined;
}

type ParseLaunchFieldsResult =
  | { ok: true; fields: ParsedLaunchFields }
  | { ok: false; message: string };

function parseLaunchFields(
  argsText: string,
  budgetText: string,
): ParseLaunchFieldsResult {
  let args: JsonValue | undefined;
  const trimmedArgs = argsText.trim();
  if (trimmedArgs.length > 0) {
    try {
      args = jsonValueSchema.parse(JSON.parse(trimmedArgs));
    } catch {
      return { ok: false, message: "Args must be valid JSON." };
    }
  }

  let budgetOutputTokens: number | undefined;
  const trimmedBudget = budgetText.trim();
  if (trimmedBudget.length > 0) {
    const parsed = Number(trimmedBudget);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return {
        ok: false,
        message: "Budget must be a positive whole number of output tokens.",
      };
    }
    budgetOutputTokens = parsed;
  }

  return { ok: true, fields: { args, budgetOutputTokens } };
}

export function WorkflowRunDialogContent({
  workflow,
  hosts,
  sourceHostIds,
  defaultHostId,
  providers,
  models,
  providerOverride,
  onProviderOverrideChange,
  pending,
  errorMessage,
  onLaunch,
}: WorkflowRunDialogContentProps) {
  const argsFieldId = useId();
  const budgetFieldId = useId();
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [argsText, setArgsText] = useState("");
  const [model, setModel] = useState("");
  const [sandbox, setSandbox] = useState<"" | WorkflowSandbox>("");
  const [budgetText, setBudgetText] = useState("");
  const [hostId, setHostId] = useState(
    defaultHostId ?? sourceHostIds[0] ?? "",
  );
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );

  // The M5 exit criterion: single-source projects get no host prompt.
  const showHostPicker = sourceHostIds.length > 1;
  // The hosts query feeds display names only; the gate above never waits on it.
  const sourceHosts = hosts.filter((host) => sourceHostIds.includes(host.id));

  const providerOptions: PickerOption<string>[] = [
    {
      value: "",
      label: workflow.defaultProvider
        ? `Default (${workflow.defaultProvider})`
        : "Default (server policy)",
    },
    ...providers.map((provider) => ({
      value: provider.id,
      label: provider.displayName,
    })),
  ];

  const modelOptions: PickerOption<string>[] = [
    {
      value: "",
      label: workflow.defaultModel
        ? `Default (${workflow.defaultModel})`
        : "Provider default",
    },
    ...models.map((availableModel) => ({
      value: availableModel.model,
      label: availableModel.displayName,
    })),
  ];

  const sandboxOptions: PickerOption<"" | WorkflowSandbox>[] = [
    {
      value: "",
      label: workflow.defaultSandbox
        ? `Default (${workflow.defaultSandbox})`
        : "Default (server policy)",
    },
    ...workflowSandboxValues.map((value) => ({
      value,
      label: value,
      ...(value === "danger-full-access"
        ? {
            tone: "warning" as const,
            description:
              "Needs a per-project allowance — the server rejects it otherwise.",
          }
        : {}),
    })),
  ];

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const parsed = parseLaunchFields(argsText, budgetText);
    if (!parsed.ok) {
      setValidationMessage(parsed.message);
      return;
    }
    setValidationMessage(null);

    onLaunch({
      args: parsed.fields.args,
      budgetOutputTokens: parsed.fields.budgetOutputTokens,
      clientRequestId,
      hostId: showHostPicker && hostId ? hostId : undefined,
      model: model || undefined,
      providerId: providerOverride || undefined,
      sandbox: sandbox || undefined,
      workflowName: workflow.name,
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Run {workflow.name}</DialogTitle>
        <DialogDescription>{workflow.description}</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1">
          <label
            htmlFor={argsFieldId}
            className="text-xs font-medium text-muted-foreground"
          >
            Args (JSON)
          </label>
          <Textarea
            id={argsFieldId}
            value={argsText}
            rows={4}
            spellCheck={false}
            disabled={pending}
            onChange={(event) => {
              setArgsText(event.target.value);
              if (validationMessage) {
                setValidationMessage(null);
              }
            }}
            placeholder={'{"topic": "…"}'}
            className="resize-y font-mono text-xs leading-5"
          />
          <p className="text-xs text-muted-foreground">
            Leave empty to launch without args.
          </p>
        </div>

        <div className="grid grid-cols-[80px_1fr] items-center gap-x-3 gap-y-1">
          {showHostPicker ? (
            <>
              <span className="text-xs font-medium text-muted-foreground">
                Host
              </span>
              <OptionPicker
                label="Host"
                value={hostId}
                options={sourceHosts.map((host) => ({
                  value: host.id,
                  label: host.name,
                }))}
                onChange={setHostId}
              />
            </>
          ) : null}
          <span className="text-xs font-medium text-muted-foreground">
            Provider
          </span>
          <OptionPicker
            label="Provider"
            value={providerOverride}
            options={providerOptions}
            onChange={(value) => {
              setModel("");
              onProviderOverrideChange(value);
            }}
          />
          <span className="text-xs font-medium text-muted-foreground">
            Model
          </span>
          <OptionPicker
            label="Model"
            value={model}
            options={modelOptions}
            onChange={setModel}
          />
          <span className="text-xs font-medium text-muted-foreground">
            Sandbox
          </span>
          <OptionPicker
            label="Sandbox"
            value={sandbox}
            options={sandboxOptions}
            onChange={setSandbox}
          />
          <label
            htmlFor={budgetFieldId}
            className="text-xs font-medium text-muted-foreground"
          >
            Budget
          </label>
          <Input
            id={budgetFieldId}
            value={budgetText}
            inputMode="numeric"
            autoComplete="off"
            disabled={pending}
            onChange={(event) => {
              setBudgetText(event.target.value);
              if (validationMessage) {
                setValidationMessage(null);
              }
            }}
            placeholder="Output tokens (policy default)"
            className="h-8 max-w-60 text-xs"
          />
        </div>

        {validationMessage ? (
          <p className="text-sm text-destructive">{validationMessage}</p>
        ) : null}
        {errorMessage && !validationMessage ? (
          <p className="text-sm text-destructive">{errorMessage}</p>
        ) : null}

        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {pending ? "Launching…" : "Run workflow"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
