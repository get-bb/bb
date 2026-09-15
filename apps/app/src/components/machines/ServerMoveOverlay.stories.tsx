import { SERVER_MOVE_STEP_IDS, type ServerMoveStepId } from "@bb/domain";
import type {
  ServerMoveStatus,
  ServerMoveStepStatus,
} from "@bb/server-contract";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import {
  ServerMoveOverlayView,
  type ServerMoveOverlayViewProps,
} from "./ServerMoveOverlay";
import { OldServerCopySectionView } from "./OldServerCopySection";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "machines/Server Move",
};

const noop = () => {};
const now = Date.parse("2026-09-15T12:00:00Z");

function steps(
  statuses: Partial<Record<ServerMoveStepId, ServerMoveStepStatus>>,
  messages: Partial<Record<ServerMoveStepId, string>> = {},
) {
  return SERVER_MOVE_STEP_IDS.map((id) => ({
    id,
    status: statuses[id] ?? "pending",
    message: messages[id] ?? null,
  }));
}

function move(overrides: Partial<ServerMoveStatus> = {}): ServerMoveStatus {
  return {
    moveId: "move_1",
    state: "preparing",
    mode: "connect",
    targetHostId: "host_desk",
    targetHostName: "desk",
    serverUrl: "https://michael.getbb.app",
    destinationStatusUrl: null,
    startedAt: now - 90_000,
    finishedAt: null,
    error: null,
    steps: steps({}),
    cancellable: true,
    ...overrides,
  };
}

const DONE_THROUGH_SWITCH = steps({
  "stop-work": "done",
  "update-target": "done",
  export: "done",
  transfer: "done",
  "start-target": "done",
  "verify-address": "skipped",
  switch: "done",
});

function Overlay(overrides: Partial<ServerMoveOverlayViewProps>) {
  return (
    <ServerMoveOverlayView
      presentation="inline"
      content={{ kind: "progress", move: move() }}
      cancelPending={false}
      cancelError={null}
      onCancel={noop}
      onClose={noop}
      {...overrides}
    />
  );
}

export function Progress() {
  return (
    <StoryCard labelWidth="220px">
      <StoryRow
        label="copying"
        hint="every app shows this full-screen layer; the running step carries the daemon's progress message"
      >
        <Overlay
          content={{
            kind: "progress",
            move: move({
              steps: steps(
                {
                  "stop-work": "done",
                  "update-target": "skipped",
                  export: "done",
                  transfer: "running",
                },
                { transfer: "Sent 212 MB of 480 MB" },
              ),
            }),
          }}
        />
      </StoryRow>
      <StoryRow
        label="cancelling"
        hint="one request at a time; the move keeps its step list until the server answers"
      >
        <Overlay
          cancelPending
          content={{
            kind: "progress",
            move: move({
              steps: steps({ "stop-work": "done", "update-target": "running" }),
            }),
          }}
        />
      </StoryRow>
      <StoryRow
        label="cancel refused"
        hint="the switch started between the click and the request, so the server refuses and says why"
      >
        <Overlay
          cancelError="The move can no longer be cancelled."
          content={{
            kind: "progress",
            move: move({
              state: "switching",
              cancellable: false,
              steps: steps({
                "stop-work": "done",
                "update-target": "done",
                export: "done",
                transfer: "done",
                "start-target": "done",
                "verify-address": "done",
                switch: "running",
              }),
            }),
          }}
        />
      </StoryRow>
      <StoryRow
        label="switching"
        hint="past the point of no return: no Cancel, and the app polls while the old server shuts down"
      >
        <Overlay
          content={{
            kind: "progress",
            move: move({
              state: "switching",
              mode: "direct",
              serverUrl: "https://desk.example.com",
              cancellable: false,
              steps: steps({
                "stop-work": "done",
                "update-target": "done",
                export: "done",
                transfer: "done",
                "start-target": "done",
                "verify-address": "done",
                switch: "running",
              }),
            }),
          }}
        />
      </StoryRow>
      <StoryRow
        label="needs recovery"
        hint="the target never confirmed it took over, so the server stays up read-only while bb keeps checking; Abandon asks first"
      >
        <Overlay
          content={{
            kind: "recovery",
            move: move({
              state: "recovery_required",
              error: {
                step: "switch",
                message: "desk disconnected before confirming",
              },
              steps: steps(
                {
                  "stop-work": "done",
                  "update-target": "done",
                  export: "done",
                  transfer: "done",
                  "start-target": "done",
                  "verify-address": "skipped",
                  switch: "running",
                },
                { switch: "Waiting for desk to confirm it took over" },
              ),
            }),
          }}
        />
      </StoryRow>
    </StoryCard>
  );
}

export function Finished() {
  const completedConnect = move({
    state: "completed",
    cancellable: false,
    finishedAt: now,
    steps: DONE_THROUGH_SWITCH,
  });
  const completedDirect = move({
    state: "completed",
    mode: "direct",
    serverUrl: "https://desk.example.com",
    cancellable: false,
    finishedAt: now,
    steps: steps({
      "stop-work": "done",
      "update-target": "done",
      export: "done",
      transfer: "done",
      "start-target": "done",
      "verify-address": "done",
      switch: "done",
    }),
  });
  return (
    <StoryCard labelWidth="220px">
      <StoryRow
        label="bb connect, reconnecting"
        hint="the address stays the same, so the app waits for the new server to answer with this move, then toasts"
      >
        <Overlay content={{ kind: "reconnecting", move: completedConnect }} />
      </StoryRow>
      <StoryRow
        label="direct address, waiting"
        hint="the old server stopped answering; the app follows the new server's /health and opens it only once it reports ready"
      >
        <Overlay
          content={{
            kind: "waiting",
            move: completedDirect,
            destinationState: "pending",
          }}
        />
      </StoryRow>
      <StoryRow
        label="direct address, redirecting"
        hint="the app opens the new address at the current path; the link is the fallback if navigation is blocked"
      >
        <Overlay
          content={{
            kind: "redirecting",
            move: completedDirect,
            destination:
              "https://desk.example.com/projects/proj_bb/threads/thr_1",
          }}
        />
      </StoryRow>
      <StoryRow
        label="failed"
        hint="the server's message leads, the failed step is marked, and Close dismisses for this app only"
      >
        <Overlay
          content={{
            kind: "ended",
            move: move({
              state: "failed",
              cancellable: false,
              finishedAt: now,
              error: {
                step: "transfer",
                message: "desk ran out of disk space while receiving the data.",
              },
              steps: steps({
                "stop-work": "done",
                "update-target": "skipped",
                export: "done",
                transfer: "failed",
              }),
            }),
          }}
        />
      </StoryRow>
      <StoryRow label="cancelled" hint="nothing switched over">
        <Overlay
          content={{
            kind: "ended",
            move: move({
              state: "cancelled",
              cancellable: false,
              finishedAt: now,
              steps: steps({ "stop-work": "done", "update-target": "done" }),
            }),
          }}
        />
      </StoryRow>
      <StoryRow
        label="server restarted"
        hint="a restart forgets an unfinished move; the app says so instead of spinning forever"
      >
        <Overlay
          content={{
            kind: "abandoned",
            move: move({
              steps: steps({ "stop-work": "done", export: "running" }),
            }),
          }}
        />
      </StoryRow>
    </StoryCard>
  );
}

export function OldServerCopy() {
  const lastMove = {
    moveId: "move_1",
    fromHostId: "host_laptop",
    fromHostName: "MacBook Pro",
    toHostId: "host_desk",
    toHostName: "desk",
    completedAt: now - 2 * 24 * 60 * 60_000,
    oldCopyDeletedAt: null,
  };
  return (
    <StoryCard labelWidth="220px" className="max-w-4xl">
      <StoryRow
        label="online"
        hint="the old machine keeps the locked data as a backup until the user deletes it"
      >
        <div className="min-w-0 flex-1">
          <OldServerCopySectionView
            host={makeHost({ id: "host_laptop", name: "MacBook Pro" })}
            lastMove={lastMove}
            onDelete={noop}
          />
        </div>
      </StoryRow>
      <StoryRow
        label="offline"
        hint="deleting runs on that machine, so the action waits for it to come back"
      >
        <div className="min-w-0 flex-1">
          <OldServerCopySectionView
            host={makeHost({
              id: "host_laptop",
              name: "MacBook Pro",
              status: "disconnected",
              lastSeenAt: now - 60 * 60_000,
            })}
            lastMove={lastMove}
            onDelete={noop}
          />
        </div>
      </StoryRow>
    </StoryCard>
  );
}
