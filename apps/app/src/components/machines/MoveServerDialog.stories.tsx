import type {
  ServerMoveCheckItem,
  ServerMoveCheckResponse,
} from "@bb/server-contract";
import {
  MoveServerDialogView,
  type MoveServerDialogViewProps,
} from "./MoveServerDialog";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Move Server",
};

const noop = () => {};

const RUNNING_TURNS: ServerMoveCheckItem = {
  id: "running-turns",
  severity: "warning",
  title: "3 turns are running",
  detail: "They stop when the move starts. You can resume them afterwards.",
};

const SCHEDULES: ServerMoveCheckItem = {
  id: "plugin-schedules",
  severity: "warning",
  title: "Scheduled automations pause during the move",
  detail: null,
};

const TIMEZONE: ServerMoveCheckItem = {
  id: "timezone",
  severity: "info",
  title: "desk uses Europe/Berlin",
  detail: "Core plugin schedules run 9 hours later than on MacBook Pro.",
};

const GH_LOGIN: ServerMoveCheckItem = {
  id: "gh-login",
  severity: "warning",
  title: "GitHub CLI isn't logged in on desk",
  detail: "Run gh auth login on desk so the server can reach GitHub.",
};

function checkResult(
  overrides: Partial<ServerMoveCheckResponse> = {},
): ServerMoveCheckResponse {
  return {
    targetHostId: "host_desk",
    targetHostName: "desk",
    mode: "connect",
    serverUrl: null,
    requiresServerUrl: false,
    targetDataDir: "/home/michael/.bb-machines/macbook-pro",
    existingTargetServerData: null,
    items: [RUNNING_TURNS, SCHEDULES, TIMEZONE],
    canMove: true,
    ...overrides,
  };
}

function Stage(overrides: Partial<MoveServerDialogViewProps>) {
  return (
    <DialogStage>
      <MoveServerDialogView
        targetName="desk"
        result={checkResult()}
        checking={false}
        checkError={null}
        showAddress={false}
        addressDraft=""
        archiveConfirmed={false}
        startAllowed
        starting={false}
        startError={null}
        onAddressDraftChange={noop}
        onCheck={noop}
        onArchiveConfirmedChange={noop}
        onStart={noop}
        onCancel={noop}
        {...overrides}
      />
    </DialogStage>
  );
}

export function Checklist() {
  return (
    <StoryCard labelWidth="220px">
      <StoryRow
        label="checking"
        hint="the first check runs with no address; nothing to act on yet, so Stop all and move stays off"
      >
        <Stage result={null} checking startAllowed={false} />
      </StoryRow>
      <StoryRow
        label="bb connect, ready"
        hint="machines keep using the same connect address, so there is no address step; warnings never block"
      >
        <Stage />
      </StoryRow>
      <StoryRow
        label="nothing to report"
        hint="a quiet machine still gets a sentence rather than an empty gap"
      >
        <Stage result={checkResult({ items: [] })} />
      </StoryRow>
      <StoryRow
        label="blocked"
        hint="blockers sort first and keep the primary action off; Check again re-runs after the user fixes them"
      >
        <Stage
          startAllowed={false}
          result={checkResult({
            canMove: false,
            items: [
              {
                id: "port",
                severity: "blocker",
                title: "Port 38886 is in use on desk",
                detail:
                  "Stop whatever is listening on that port, then check again.",
              },
              GH_LOGIN,
              TIMEZONE,
            ],
          })}
        />
      </StoryRow>
      <StoryRow
        label="check failed"
        hint="the check itself failed, so there are no results; the error is inline and Check again retries"
      >
        <Stage
          result={null}
          checkError="desk did not answer in time."
          startAllowed={false}
        />
      </StoryRow>
    </StoryCard>
  );
}

export function DirectAddress() {
  return (
    <StoryCard labelWidth="220px">
      <StoryRow
        label="address needed"
        hint="a direct-address server has no shared handle, so the dialog asks where machines should reach the new server"
      >
        <Stage
          showAddress
          startAllowed={false}
          result={checkResult({
            mode: "direct",
            requiresServerUrl: true,
            canMove: false,
            items: [
              {
                id: "server-url",
                severity: "blocker",
                title: "Enter the address machines should use",
                detail: "Loopback addresses only work on desk itself.",
              },
              RUNNING_TURNS,
            ],
          })}
        />
      </StoryRow>
      <StoryRow
        label="address checked"
        hint="the latest check ran with this exact address, so the move can start"
      >
        <Stage
          showAddress
          addressDraft="https://desk.example.com"
          result={checkResult({
            mode: "direct",
            requiresServerUrl: true,
            serverUrl: "https://desk.example.com",
            items: [RUNNING_TURNS],
          })}
        />
      </StoryRow>
      <StoryRow
        label="re-checking"
        hint="the previous results dim while the new address is checked"
      >
        <Stage
          showAddress
          checking
          startAllowed={false}
          addressDraft="https://desk.tailnet.example"
          result={checkResult({
            mode: "direct",
            requiresServerUrl: true,
            items: [RUNNING_TURNS],
          })}
        />
      </StoryRow>
    </StoryCard>
  );
}

export function ExistingData() {
  return (
    <StoryCard labelWidth="220px">
      <StoryRow
        label="needs confirmation"
        hint="desk already has its own bb server data; it is archived, never merged, and only after the user says so"
      >
        <Stage
          startAllowed={false}
          result={checkResult({
            existingTargetServerData: {
              path: "/Users/michael/.bb",
              sizeBytes: 412 * 1024 * 1024,
            },
            items: [
              {
                id: "existing-server-data",
                severity: "warning",
                title: "desk already has bb server data",
                detail: null,
              },
              RUNNING_TURNS,
            ],
          })}
        />
      </StoryRow>
      <StoryRow label="confirmed" hint="the checkbox is the last gate">
        <Stage
          archiveConfirmed
          result={checkResult({
            existingTargetServerData: {
              path: "/Users/michael/.bb",
              sizeBytes: 412 * 1024 * 1024,
            },
            items: [
              {
                id: "existing-server-data",
                severity: "warning",
                title: "desk already has bb server data",
                detail: null,
              },
            ],
          })}
        />
      </StoryRow>
      <StoryRow
        label="starting"
        hint="the dialog cannot be dismissed mid-request; the overlay takes over once the server accepts"
      >
        <Stage starting startAllowed={false} />
      </StoryRow>
      <StoryRow
        label="start refused"
        hint="the server re-checked and refused; its message is inline and the dialog stays open"
      >
        <Stage
          startAllowed={false}
          startError="Another server move is already in progress."
        />
      </StoryRow>
    </StoryCard>
  );
}
