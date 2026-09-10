import { useState } from "react";
import { MachineAccessGate, ManualMachineSetupView } from "./AddMachineDialog";
import { MachineAccessControlsContent } from "@/components/settings/MachineAccessSettings";
import {
  CONNECT_UNAVAILABLE,
  CONNECT_UNPAIRED,
  MANUAL_WITHOUT_URL,
  machineAccessState,
} from "../../../.ladle/machine-story-fixtures";
import { makeHost } from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Add a Machine",
};

const noop = () => {};
const CONNECTED_HOST = makeHost({
  id: "host_new",
  name: "build-box",
  status: "connected",
});
const ENROLLMENT_COMMAND =
  "curl -fsSL -H 'X-BB-Enrollment: bbde_TZpKWsJpWiPulVIRKNENmEVtvNwnEwDobjPFlnlsyCUUzorssgdxmgxUblRIWAUA' 'https://bb.example.com/install.sh' | sh";

export function AccessGate() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="checking"
        hint="the access check has not answered yet — no heading, so nothing swaps when it does"
      >
        <DialogStage>
          <MachineAccessGate state={{ status: "checking" }}>
            {null}
          </MachineAccessGate>
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="bb connect unpaired"
        hint="default provider is setup-required — the primary action leaves for plugin settings"
      >
        <DialogStage>
          <MachineAccessGate state={{ status: "blocked" }}>
            <MachineAccessControlsContent
              machineAccess={machineAccessState(CONNECT_UNPAIRED)}
            />
          </MachineAccessGate>
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="bb connect unavailable"
        hint="paired once, now refused — a status line appears because there is a verdict to report"
      >
        <DialogStage>
          <MachineAccessGate state={{ status: "blocked" }}>
            <MachineAccessControlsContent
              machineAccess={machineAccessState(CONNECT_UNAVAILABLE)}
            />
          </MachineAccessGate>
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="manual, no address"
        hint="the direct provider with nothing saved — machines would have nothing to dial"
      >
        <DialogStage>
          <MachineAccessGate state={{ status: "blocked" }}>
            <MachineAccessControlsContent
              machineAccess={machineAccessState(MANUAL_WITHOUT_URL)}
            />
          </MachineAccessGate>
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="manual, rejected address"
        hint="validation refuses before saving; the message replaces the hint and is announced"
      >
        <DialogStage>
          <MachineAccessGate state={{ status: "blocked" }}>
            <MachineAccessControlsContent
              machineAccess={machineAccessState(MANUAL_WITHOUT_URL, {
                draft: "http://localhost:3000",
                error:
                  "Other machines cannot reach localhost. Use a domain or shared-network address.",
              })}
            />
          </MachineAccessGate>
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="check failed"
        hint="the access check itself failed, so nothing is known about access — retry, and no setup copy"
      >
        <DialogStage>
          <MachineAccessGate state={{ status: "failed", onRetry: noop }}>
            {null}
          </MachineAccessGate>
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}

export function EnrollmentCommandState() {
  const [issuedAt] = useState(() => Date.now());
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="preparing"
        hint="one status row carries every phase, so waiting never shows two spinners racing each other"
      >
        <DialogStage>
          <ManualMachineSetupView
            command={null}
            errorMessage={null}
            onRetry={noop}
            onRegenerate={noop}
            connectedHost={null}
            onOpenMachine={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="command issued"
        hint="the only path this dialog offers — the countdown is the server's own expiry, not a guessed interval"
      >
        <DialogStage>
          <ManualMachineSetupView
            command={{
              value: ENROLLMENT_COMMAND,
              expiresAt: issuedAt + 15 * 60_000,
            }}
            errorMessage={null}
            onRetry={noop}
            onRegenerate={noop}
            connectedHost={null}
            onOpenMachine={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="about to lapse"
        hint="under a minute drops the minutes segment so the number left is the one that matters"
      >
        <DialogStage>
          <ManualMachineSetupView
            command={{
              value: ENROLLMENT_COMMAND,
              expiresAt: issuedAt + 40_000,
            }}
            errorMessage={null}
            onRetry={noop}
            onRegenerate={noop}
            connectedHost={null}
            onOpenMachine={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="expired"
        hint="the dead credential is withdrawn rather than left copyable, and the only action left mints a new one"
      >
        <DialogStage>
          <ManualMachineSetupView
            command={{
              value: ENROLLMENT_COMMAND,
              expiresAt: issuedAt - 1_000,
            }}
            errorMessage={null}
            onRetry={noop}
            onRegenerate={noop}
            connectedHost={null}
            onOpenMachine={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="machine connected"
        hint="the same row resolves to the machine and offers the only next step worth taking"
      >
        <DialogStage>
          <ManualMachineSetupView
            command={{
              value: ENROLLMENT_COMMAND,
              expiresAt: issuedAt + 15 * 60_000,
            }}
            connectedHost={CONNECTED_HOST}
            errorMessage={null}
            onRetry={noop}
            onRegenerate={noop}
            onOpenMachine={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="could not prepare one"
        hint="the description carries the failure, so the header never promises a command that does not exist"
      >
        <DialogStage>
          <ManualMachineSetupView
            command={null}
            errorMessage="The gate rejected this bb's credential (HTTP 401)"
            onRetry={noop}
            onRegenerate={noop}
            connectedHost={null}
            onOpenMachine={noop}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
