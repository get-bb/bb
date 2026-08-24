import { useState } from "react";
import type { Host } from "@bb/domain";
import type {
  CliSkillMachineStatus,
  SystemCliSkillsStatusResponse,
  SystemInstallCliSkillsResponse,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { appToast } from "@/components/ui/app-toast";
import { InstallCliSkillsDialog } from "@/components/settings/InstallCliSkillsDialog";
import { useInstallCliSkills } from "@/hooks/mutations/settings-mutations";
import { useHosts } from "@/hooks/queries/host-queries";
import { useCliSkillsStatus } from "@/hooks/queries/system-queries";

const CLI_SKILLS_SETTING_LABEL = "bb CLI skills";

interface CliSkillsSettingsSectionContentProps {
  /** False while no machine is connected, so nothing could receive the files. */
  hasConnectedMachine: boolean;
  onOpenPicker: () => void;
  pending: boolean;
  /** Summary badge for the row; null while unknown or still loading. */
  statusBadge: string | null;
}

function installDescription(hasConnectedMachine: boolean): string {
  return hasConnectedMachine
    ? "Install them into ~/.agents/skills and ~/.claude/skills so agents outside bb can use the bb CLI."
    : "Connect a machine to install them into ~/.agents/skills and ~/.claude/skills.";
}

/**
 * One badge for the whole row. With several machines the interesting fact is
 * how many are current, so a mixed fleet reports the shortfall rather than
 * claiming either extreme.
 */
export function summarizeMachineStatuses(
  statuses: readonly CliSkillMachineStatus[],
): string | null {
  const known = statuses.filter((status) => status !== "unknown");
  if (known.length === 0) return null;
  const installed = known.filter((status) => status === "installed").length;
  if (installed === known.length) {
    return known.length > 1
      ? `Installed on ${known.length} machines`
      : "Installed";
  }
  if (installed > 0) {
    return `Installed on ${installed} of ${known.length} machines`;
  }
  return known.some((status) => status === "outdated")
    ? "Out of date"
    : "Not installed";
}

export function CliSkillsSettingsSectionContent({
  hasConnectedMachine,
  onOpenPicker,
  pending,
  statusBadge,
}: CliSkillsSettingsSectionContentProps) {
  return (
    <SettingsSection title="Skills">
      <SettingsWithControl
        label={CLI_SKILLS_SETTING_LABEL}
        {...(statusBadge === null ? {} : { labelBadge: statusBadge })}
        description={installDescription(hasConnectedMachine)}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasConnectedMachine || pending}
          onClick={onOpenPicker}
          aria-label={`Install ${CLI_SKILLS_SETTING_LABEL}`}
        >
          {pending ? "Installing…" : "Install"}
        </Button>
      </SettingsWithControl>
    </SettingsSection>
  );
}

/**
 * Report the per-machine outcome. The route installs machines independently,
 * so a partial success is a real outcome and both halves get surfaced.
 */
function reportInstallResults(result: SystemInstallCliSkillsResponse): void {
  const installed = result.results.filter((entry) => entry.ok);
  const failed = result.results.filter((entry) => !entry.ok);
  if (installed.length > 0) {
    appToast.success(
      `Installed the bb CLI skills on ${installed
        .map((entry) => entry.hostName)
        .join(", ")}`,
    );
  }
  for (const entry of failed) {
    appToast.error(`${entry.hostName}: ${entry.errorMessage}`);
  }
}

function statusByHostId(
  status: SystemCliSkillsStatusResponse | undefined,
): ReadonlyMap<string, CliSkillMachineStatus> {
  return new Map(
    (status?.machines ?? []).map((machine) => [machine.hostId, machine.status]),
  );
}

/**
 * Publish bb's built-in CLI skills to chosen machines' global agent skill roots
 * so agents running outside bb can drive it. Gated on a connected machine, not
 * on whether this browser can reach a daemon itself (it cannot when bb is open
 * remotely) — the install runs server-side over each machine's daemon session.
 */
export function CliSkillsSettingsSection() {
  const hostsQuery = useHosts();
  const statusQuery = useCliSkillsStatus();
  const installCliSkills = useInstallCliSkills();
  const [pickerOpen, setPickerOpen] = useState(false);
  const hosts: readonly Host[] = hostsQuery.data ?? [];
  const statuses = statusByHostId(statusQuery.data);

  return (
    <>
      <CliSkillsSettingsSectionContent
        hasConnectedMachine={hosts.some((host) => host.status === "connected")}
        pending={installCliSkills.isPending}
        statusBadge={summarizeMachineStatuses([...statuses.values()])}
        onOpenPicker={() => setPickerOpen(true)}
      />
      <InstallCliSkillsDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        hosts={hosts}
        statusByHostId={statuses}
        pending={installCliSkills.isPending}
        onCancel={() => setPickerOpen(false)}
        onInstall={(hostIds) =>
          installCliSkills.mutate(
            { hostIds },
            {
              onSuccess: (result) => {
                setPickerOpen(false);
                reportInstallResults(result);
                void statusQuery.refetch();
              },
            },
          )
        }
      />
    </>
  );
}
