import { useState } from "react";
import { AnimatedDisclosureBody } from "./AnimatedBody";
import { useHosts } from "@/hooks/queries/host-queries";
import { useResumeHost } from "@/hooks/mutations/host-mutations";
import type { SystemMachineProvider } from "@bb/server-contract";
import {
  MachineIcon,
  type MachineLabelHost,
} from "@/components/machines/MachineLabel";
import { useSystemMachineProviders } from "@/hooks/queries/machine-provider-queries";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
  PromptStackHoverChevron,
  useDisclosureFocusHandoff,
} from "@bb/shared-ui/prompt-stack-disclosure";
import {
  BannerActionSlot,
  PromptBannerActionButton,
} from "./prompt-banner-actions";
import {
  PromptStackCard,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PROMPT_STACK_INLAY_INSET_CLASS,
  PROMPT_STACK_INLAY_SEGMENT_CLASS,
} from "./PromptStackCard";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

const MACHINE_STATUS_TOGGLE_ID = "machine-status-toggle";
const MACHINE_STATUS_BODY_ID = "machine-status-body";

export function ThreadMachineStatus({ hostId }: { hostId: string }) {
  const hosts = useHosts();
  const { providers } = useSystemMachineProviders();
  const resume = useResumeHost();
  const host = hosts.data?.find((candidate) => candidate.id === hostId);
  if (!host || host.machineProviderId === null) return null;
  const phase = host.lifecycle.phase;
  if (phase !== "suspending" && phase !== "suspended" && phase !== "resuming")
    return null;
  return (
    <ThreadMachineStatusBanner
      host={host}
      provider={providers?.find(
        (provider) => provider.id === host.machineProviderId,
      )}
      phase={phase}
      error={
        resume.error
          ? getMutationErrorMessage({
              error: resume.error,
              fallbackMessage: "Could not resume the machine.",
            })
          : null
      }
      onResume={() => resume.mutate(hostId)}
    />
  );
}

export function ThreadMachineStatusBanner({
  host,
  provider,
  phase,
  error,
  onResume,
}: {
  host: MachineLabelHost;
  provider: SystemMachineProvider | undefined;
  phase: "suspending" | "suspended" | "resuming";
  error: string | null;
  onResume: () => void;
}) {
  const phaseWord =
    phase === "resuming"
      ? "resuming…"
      : phase === "suspending"
        ? "pausing…"
        : "paused";
  const status = `Machine is ${phaseWord}`;
  const detail = error && phase !== "resuming" ? error : null;
  const [isExpanded, setIsExpanded] = useState(false);
  const focus = useDisclosureFocusHandoff(isExpanded, () =>
    setIsExpanded((current) => !current),
  );
  const expandable = detail !== null;
  return (
    <PromptStackCard
      ariaLabel="Machine status"
      className="overflow-hidden"
      style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
    >
      <div
        className={cn(
          "flex items-center gap-0.5 text-xs text-muted-foreground",
          PROMPT_STACK_INLAY_INSET_CLASS,
        )}
      >
        {expandable ? (
          <button
            type="button"
            id={MACHINE_STATUS_TOGGLE_ID}
            aria-expanded={isExpanded}
            aria-controls={MACHINE_STATUS_BODY_ID}
            aria-label={`${status}. ${detail}`}
            ref={focus.triggerRef}
            onClick={focus.onTriggerClick}
            className={cn(
              "flex min-w-0 flex-1 cursor-pointer items-center justify-start gap-1.5 text-left text-xs transition-colors",
              PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
              PROMPT_STACK_INLAY_SEGMENT_CLASS,
              "hover:bg-state-hover",
              isExpanded ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <MachineIcon host={host} machineProvider={provider} />
            <span className="min-w-0 truncate">{status}</span>
            <PromptStackHoverChevron isExpanded={isExpanded} />
          </button>
        ) : (
          <div
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-xs",
              PROMPT_STACK_INLAY_SEGMENT_CLASS,
            )}
            role="status"
          >
            <MachineIcon host={host} machineProvider={provider} />
            <span className="min-w-0 truncate">{status}</span>
          </div>
        )}
        {phase === "suspended" ? (
          <BannerActionSlot hideInTiny={false}>
            <PromptBannerActionButton onClick={onResume}>
              {expandable ? "Retry" : "Resume"}
            </PromptBannerActionButton>
          </BannerActionSlot>
        ) : null}
      </div>
      {expandable ? (
        <AnimatedDisclosureBody
          collapsedBorder="reserve"
          id={MACHINE_STATUS_BODY_ID}
          labelledBy={MACHINE_STATUS_TOGGLE_ID}
          isExpanded={isExpanded}
          collapseLabel="Collapse machine status"
          collapseRef={focus.collapseRef}
          onCollapse={focus.onCollapseClick}
        >
          <p
            role="alert"
            className="px-3 pb-2 pt-1.5 text-xs leading-relaxed text-muted-foreground"
          >
            {detail}
          </p>
        </AnimatedDisclosureBody>
      ) : null}
    </PromptStackCard>
  );
}
