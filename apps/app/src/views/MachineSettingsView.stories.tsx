import type { Host, MachineLifecycle } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { MachineSettingsHeader } from "./MachineSettingsView";
import {
  MANUAL_MACHINE_PROVIDER,
  MODAL_MACHINE_PROVIDER,
} from "../../.ladle/machine-story-fixtures";
import { StoryCard, StoryRow } from "../../.ladle/story-card";

export default {
  title: "settings/Machine page",
};

const noop = () => {};
const now = Date.parse("2026-09-09T12:00:00Z");
const WEEKS_AGO = now - 3 * 7 * 24 * 60 * 60_000;

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
    machineProviderId: MODAL_MACHINE_PROVIDER.id,
    createdAt: now - 4 * 24 * 60 * 60_000,
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
} & Partial<Parameters<typeof MachineSettingsHeader>[0]>) {
  return (
    <div className="min-w-0 flex-1">
      <MachineSettingsHeader
        host={host}
        machineProvider={machineProvider}
        platformLabel={null}
        now={now}
        isPrimary={false}
        isThisMachine={false}
        showPrimaryBadge={false}
        lifecycleNotice={null}
        lifecycleActionPending={false}
        onSuspend={noop}
        onResume={noop}
        onRetryCleanup={noop}
        onRename={noop}
        {...overrides}
      />
    </div>
  );
}

export function Header() {
  return (
    <StoryCard labelWidth="220px" className="max-w-4xl">
      <StoryRow
        label="this machine"
        hint="the machine bb itself runs on: no provider, so no tag and no lifecycle actions"
      >
        <Row
          host={makeHost({
            id: "host_local",
            name: "Michael's MacBook Pro",
            machineProviderId: null,
            createdAt: now - 60 * 24 * 60 * 60_000,
          })}
          machineProvider={null}
          platformLabel="macOS"
          isPrimary
          isThisMachine
          showPrimaryBadge
        />
      </StoryRow>
      <StoryRow
        label="manually paired"
        hint="the provider owns nothing at runtime, so Suspend never appears and its machines carry no tag"
      >
        <Row
          host={makeHost({
            id: "host_build",
            name: "michael-build-box",
            machineProviderId: MANUAL_MACHINE_PROVIDER.id,
            createdAt: now - 18 * 24 * 60 * 60_000,
          })}
          machineProvider={MANUAL_MACHINE_PROVIDER}
        />
      </StoryRow>
      <StoryRow
        label="running"
        hint="a live sandbox from a provider that suspends, so pausing it is offered here rather than only in the list"
      >
        <Row host={sandbox({ name: "Modal sandbox 0af2" })} />
      </StoryRow>
      <StoryRow
        label="pausing"
        hint="core is preserving the machine; the message is informational, so it is not destructive text"
      >
        <Row
          host={sandbox({
            name: "Modal sandbox 91c4",
            lifecycle: lifecycle({
              phase: "suspending",
              message: "Saving the sandbox filesystem",
            }),
          })}
          lifecycleNotice={{
            phase: "suspending",
            message:
              "Preserving this machine. Active turns will be interrupted and open terminals closed before the filesystem is saved.",
          }}
        />
      </StoryRow>
      <StoryRow
        label="paused"
        hint="suspended and disconnected, so the action becomes Resume"
      >
        <Row
          host={sandbox({
            status: "disconnected",
            lastSeenAt: WEEKS_AGO,
            lifecycle: lifecycle({
              phase: "suspended",
              suspendedAt: WEEKS_AGO,
            }),
          })}
        />
      </StoryRow>
      <StoryRow
        label="removing"
        hint="removal is under way and still going, so there is nothing to retry yet"
      >
        <Row
          host={sandbox({
            name: "Modal sandbox 7c11",
            lifecycle: lifecycle({
              phase: "removing",

              teardown: { status: "running", attempt: 1 },
            }),
          })}
        />
      </StoryRow>
      <StoryRow
        label="cleanup failed"
        hint="the only place that says why teardown gave up; Retry cleanup appears beside the message"
      >
        <Row
          host={sandbox({
            name: "Modal sandbox 55de",
            status: "disconnected",
            lastSeenAt: WEEKS_AGO,
            lifecycle: lifecycle({
              phase: "removing",

              teardown: { status: "failed", attempt: 3 },
            }),
          })}
          lifecycleNotice={{
            phase: "removing",
            message: "Machine removal failed: Modal returned HTTP 500.",
          }}
        />
      </StoryRow>
      <StoryRow
        label="an action is running"
        hint="every lifecycle action shares one pending flag, so a second click cannot race the first"
      >
        <Row
          host={sandbox({ name: "Modal sandbox 0af2" })}
          lifecycleActionPending
        />
      </StoryRow>
    </StoryCard>
  );
}
