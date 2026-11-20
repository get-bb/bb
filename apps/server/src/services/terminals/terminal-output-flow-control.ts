import type { HostDaemonServerWsMessage } from "@bb/host-daemon-contract";

const DEFAULT_OUTPUT_ACK_STALL_MS = 3_000;

export type TerminalOutputFlowDaemonMessage = Extract<
  HostDaemonServerWsMessage,
  { type: "terminal.ack" | "terminal.stream" }
>;

export interface TerminalOutputFlowControlOptions {
  now?: () => number;
  sendDaemonMessage: (
    daemonSessionId: string,
    message: TerminalOutputFlowDaemonMessage,
  ) => void;
  stallMs?: number;
}

export interface TerminalOutputFlowClientState {
  acknowledgesOutput: boolean;
  nextSeq: number;
  visible: boolean;
}

interface TerminalOutputFlowClient {
  acknowledgedNextSeq: number;
  acknowledgesOutput: boolean;
  lastProgressAt: number;
  stalled: boolean;
  visible: boolean;
}

interface TerminalOutputFlow {
  clients: Map<object, TerminalOutputFlowClient>;
  daemonSessionId: string | null;
  receivedNextSeq: number;
  sentAckNextSeq: number;
  stallTimeout: ReturnType<typeof setTimeout> | null;
}

export class TerminalOutputFlowControl {
  private readonly flows = new Map<string, TerminalOutputFlow>();
  private readonly now: () => number;
  private readonly stallMs: number;

  constructor(private readonly options: TerminalOutputFlowControlOptions) {
    this.now = options.now ?? Date.now;
    this.stallMs = options.stallMs ?? DEFAULT_OUTPUT_ACK_STALL_MS;
  }

  subscribe(
    terminalId: string,
    client: object,
    daemonSessionId: string | null,
  ): void {
    const flow = this.flows.get(terminalId) ?? {
      clients: new Map(),
      daemonSessionId: null,
      receivedNextSeq: 0,
      sentAckNextSeq: 0,
      stallTimeout: null,
    };
    this.flows.set(terminalId, flow);
    if (!flow.clients.has(client)) {
      flow.clients.set(client, {
        acknowledgedNextSeq: 0,
        acknowledgesOutput: false,
        lastProgressAt: this.now(),
        stalled: false,
        visible: false,
      });
    }
    if (daemonSessionId !== null) {
      this.streamFrom(terminalId, flow, daemonSessionId);
    }
    this.update(terminalId, flow);
  }

  setClientState(
    terminalId: string,
    client: object,
    state: TerminalOutputFlowClientState,
  ): void {
    const flow = this.flows.get(terminalId);
    if (!flow?.clients.has(client)) {
      return;
    }
    flow.receivedNextSeq = Math.max(flow.receivedNextSeq, state.nextSeq);
    flow.clients.set(client, {
      acknowledgedNextSeq: state.nextSeq,
      acknowledgesOutput: state.acknowledgesOutput,
      lastProgressAt: this.now(),
      stalled: false,
      visible: state.visible,
    });
    this.update(terminalId, flow);
  }

  bindDaemonSession(terminalId: string, daemonSessionId: string): void {
    const flow = this.flows.get(terminalId);
    if (!flow) {
      return;
    }
    this.streamFrom(terminalId, flow, daemonSessionId);
    this.update(terminalId, flow);
  }

  removeClient(terminalId: string, client: object): void {
    const flow = this.flows.get(terminalId);
    if (!flow?.clients.delete(client)) {
      return;
    }
    if (flow.clients.size > 0) {
      this.update(terminalId, flow);
      return;
    }
    if (flow.daemonSessionId !== null) {
      this.options.sendDaemonMessage(flow.daemonSessionId, {
        type: "terminal.stream",
        terminalId,
        enabled: false,
      });
    }
    this.forgetTerminal(terminalId);
  }

  acknowledge(terminalId: string, client: object, nextSeq: number): void {
    const flow = this.flows.get(terminalId);
    const flowClient = flow?.clients.get(client);
    if (!flow || !flowClient || nextSeq <= flowClient.acknowledgedNextSeq) {
      return;
    }
    flowClient.acknowledgedNextSeq = nextSeq;
    flowClient.lastProgressAt = this.now();
    if (flowClient.stalled && nextSeq >= flow.receivedNextSeq) {
      flowClient.stalled = false;
    }
    this.update(terminalId, flow);
  }

  setVisible(terminalId: string, client: object, visible: boolean): void {
    const flow = this.flows.get(terminalId);
    const flowClient = flow?.clients.get(client);
    if (!flow || !flowClient || flowClient.visible === visible) {
      return;
    }
    flowClient.visible = visible;
    flowClient.lastProgressAt = this.now();
    this.update(terminalId, flow);
  }

  recordOutput(terminalId: string, daemonSessionId: string, seq: number): void {
    const flow = this.flows.get(terminalId);
    if (!flow || flow.daemonSessionId !== daemonSessionId) {
      return;
    }
    const previousNextSeq = flow.receivedNextSeq;
    flow.receivedNextSeq = Math.max(previousNextSeq, seq + 1);
    const now = this.now();
    for (const flowClient of flow.clients.values()) {
      if (flowClient.acknowledgedNextSeq >= previousNextSeq) {
        flowClient.lastProgressAt = now;
      }
    }
    this.update(terminalId, flow);
  }

  forgetTerminal(terminalId: string): void {
    const flow = this.flows.get(terminalId);
    if (!flow) {
      return;
    }
    if (flow.stallTimeout !== null) {
      clearTimeout(flow.stallTimeout);
    }
    this.flows.delete(terminalId);
  }

  private streamFrom(
    terminalId: string,
    flow: TerminalOutputFlow,
    daemonSessionId: string,
  ): void {
    if (flow.daemonSessionId === daemonSessionId) {
      return;
    }
    flow.daemonSessionId = daemonSessionId;
    flow.sentAckNextSeq = 0;
    this.options.sendDaemonMessage(daemonSessionId, {
      type: "terminal.stream",
      terminalId,
      enabled: true,
    });
  }

  private update(terminalId: string, flow: TerminalOutputFlow): void {
    const daemonSessionId = flow.daemonSessionId;
    if (daemonSessionId === null) {
      this.clearStallTimeout(flow);
      return;
    }
    let target: number | null = null;
    for (const flowClient of flow.clients.values()) {
      if (isGoverning(flowClient)) {
        target = Math.max(
          target ?? flowClient.acknowledgedNextSeq,
          flowClient.acknowledgedNextSeq,
        );
      }
    }
    if (target === null) {
      target = flow.receivedNextSeq;
    }
    if (target > flow.sentAckNextSeq) {
      flow.sentAckNextSeq = target;
      this.options.sendDaemonMessage(daemonSessionId, {
        type: "terminal.ack",
        terminalId,
        nextSeq: target,
      });
    }
    this.scheduleStallCheck(terminalId, flow);
  }

  private scheduleStallCheck(
    terminalId: string,
    flow: TerminalOutputFlow,
  ): void {
    let earliestStallAt: number | null = null;
    for (const flowClient of flow.clients.values()) {
      if (
        isGoverning(flowClient) &&
        flowClient.acknowledgedNextSeq < flow.receivedNextSeq
      ) {
        const stallAt = flowClient.lastProgressAt + this.stallMs;
        earliestStallAt = Math.min(earliestStallAt ?? stallAt, stallAt);
      }
    }
    this.clearStallTimeout(flow);
    if (earliestStallAt === null) {
      return;
    }
    flow.stallTimeout = setTimeout(
      () => {
        flow.stallTimeout = null;
        this.markStalledClients(terminalId, flow);
      },
      Math.max(0, earliestStallAt - this.now()),
    );
  }

  private markStalledClients(
    terminalId: string,
    flow: TerminalOutputFlow,
  ): void {
    const now = this.now();
    for (const flowClient of flow.clients.values()) {
      if (
        flowClient.acknowledgedNextSeq < flow.receivedNextSeq &&
        now - flowClient.lastProgressAt >= this.stallMs
      ) {
        flowClient.stalled = true;
      }
    }
    this.update(terminalId, flow);
  }

  private clearStallTimeout(flow: TerminalOutputFlow): void {
    if (flow.stallTimeout === null) {
      return;
    }
    clearTimeout(flow.stallTimeout);
    flow.stallTimeout = null;
  }
}

function isGoverning(flowClient: TerminalOutputFlowClient): boolean {
  return (
    flowClient.acknowledgesOutput && flowClient.visible && !flowClient.stalled
  );
}
