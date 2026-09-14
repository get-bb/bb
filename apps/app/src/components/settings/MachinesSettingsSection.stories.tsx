import type { Host, MachineLifecycle } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { MachineRowContent } from "./MachinesSettingsSection";
import { SettingsRowList } from "@/components/ui/settings-section";
import {
  MANUAL_MACHINE_PROVIDER,
  MODAL_MACHINE_PROVIDER,
} from "../../../.ladle/machine-story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "settings/Machines",
};

const noop = () => {};
const now = Date.parse("2026-09-09T12:00:00Z");

function lifecycle(
  overrides: Partial<MachineLifecycle> = {},
): MachineLifecycle {
  return {
    phase: "active",
    suspendedAt: null,
    message: null,
    pendingLog: "",
    teardown: null,
    ...overrides,
  };
}

function sandbox(overrides: Partial<Host> = {}): Host {
  return makeHost({
    id: "host_sandbox",
    name: "Modal sandbox 3f9a",
    type: "ephemeral",
    machineProviderId: MODAL_MACHINE_PROVIDER.id,
    ...overrides,
  });
}

function Row({
  host,
  machineProvider = MODAL_MACHINE_PROVIDER,
  ...overrides
}: {
  host: Host;
  machineProvider?: typeof MODAL_MACHINE_PROVIDER | null;
} & Partial<Parameters<typeof MachineRowContent>[0]>) {
  return (
    <div className="min-w-0 flex-1">
      <SettingsRowList>
        <MachineRowContent
          host={host}
          isPrimary={false}
          isThisMachine={false}
          showPrimaryBadge={false}
          platformLabel={null}
          projectCount={0}
          now={now}
          onRename={noop}
          onRemove={noop}
          onRetryUpdate={noop}
          onSuspend={noop}
          onResume={noop}
          onRetryCleanup={noop}
          lifecycleActionPending={false}
          retryUpdatePending={false}
          machineProvider={machineProvider}
          {...overrides}
        />
      </SettingsRowList>
    </div>
  );
}

export function Rows() {
  return (
    <StoryCard labelWidth="220px" className="max-w-4xl">
      <StoryRow
        label="this machine"
        hint="the machine bb itself runs on, labeled by a laptop icon and its name"
      >
        <Row
          host={makeHost({
            id: "host_local",
            name: "Michael's MacBook Pro",
            machineProviderId: null,
          })}
          machineProvider={null}
          isPrimary
          isThisMachine
          showPrimaryBadge
          platformLabel="macOS"
          projectCount={1}
        />
      </StoryRow>
      <StoryRow
        label="manually paired"
        hint="labeled by a laptop icon and its name; the plugin owns nothing at runtime, so there is no suspend action"
      >
        <Row
          host={makeHost({
            id: "host_build",
            name: "michael-build-box",
            machineProviderId: MANUAL_MACHINE_PROVIDER.id,
            maxPermissionMode: "auto",
          })}
          machineProvider={MANUAL_MACHINE_PROVIDER}
          projectCount={2}
        />
      </StoryRow>
      <StoryRow
        label="provider-made, running"
        hint="a live sandbox labeled by its provider icon and host name, without a separate kind chip"
      >
        <Row host={sandbox({ name: "Modal sandbox 0af2" })} projectCount={1} />
      </StoryRow>
      <StoryRow
        label="pausing"
        hint="the phase replaces the connection word, and the provider's own progress follows it"
      >
        <Row
          host={sandbox({
            name: "Modal sandbox 91c4",
            lifecycle: lifecycle({
              phase: "suspending",
              message: "Saving the sandbox filesystem",
            }),
          })}
        />
      </StoryRow>
      <StoryRow
        label="paused"
        hint="suspended and disconnected; resuming is offered in the row menu"
      >
        <Row
          host={sandbox({
            status: "disconnected",
            lastSeenAt: now - 3 * 7 * 24 * 60 * 60_000,
            lifecycle: lifecycle({
              phase: "suspended",
              suspendedAt: now - 3 * 7 * 24 * 60 * 60_000,
            }),
          })}
        />
      </StoryRow>
      <StoryRow
        label="removing"
        hint="removal is under way and the machine is still reachable"
      >
        <Row
          host={sandbox({
            name: "Modal sandbox 7c11",
            lifecycle: lifecycle({ phase: "removing" }),
          })}
        />
      </StoryRow>
      <StoryRow
        label="cleanup failed"
        hint="teardown gave up, so the dot turns destructive; why it failed is on the machine page, and removal stays in the row menu"
      >
        <Row
          host={sandbox({
            name: "Modal sandbox 55de",
            status: "disconnected",
            lastSeenAt: now - 3 * 7 * 24 * 60 * 60_000,
            lifecycle: lifecycle({
              phase: "removing",

              teardown: { status: "failed", attempt: 3 },
            }),
          })}
        />
      </StoryRow>
    </StoryCard>
  );
}
