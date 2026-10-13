import type { HostDaemonServerWsMessage } from "@bb/host-daemon-contract";

const DEFAULT_OUTPUT_ACK_STALL_MS = 3_000;

export type TerminalOutputFlowDaemonMessage = Extract<
  HostDaemonServerWsMessage,
  { type: "terminal.ack" | "terminal.flow-control" }
>;

export interface TerminalOutputFlowControlOptions {
  now?: () => number;
  sendDaemonMessage: (
    daemonSessionId: string,
    message: TerminalOutputFlowDaemonMessage,
  ) => void;
  stallMs?: number;
}

interface TerminalOutputFlowClient {
  acknowledgedNextSeq: number;
  lastProgressAt: number;
  stalled: boolean;
  visible: boolean;
}

interface TerminalOutputFlow {
  clients: Map<object, TerminalOutputFlowClient>;
  enabledDaemonSessionId: string | null;
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

  addClient(
    terminalId: string,
    client: object,
    nextSeq: number,
    visible: boolean,
  ): void {
    const flow = this.flows.get(terminalId) ?? {
      clients: new Map(),
      enabledDaemonSessionId: null,
      receivedNextSeq: nextSeq,
      sentAckNextSeq: 0,
      stallTimeout: null,
    };
    flow.receivedNextSeq = Math.max(flow.receivedNextSeq, nextSeq);
    flow.clients.set(client, {
      acknowledgedNextSeq: nextSeq,
      lastProgressAt: this.now(),
      stalled: false,
      visible,
    });
    this.flows.set(terminalId, flow);
    this.update(terminalId, flow);
  }

  removeClient(terminalId: string, client: object): void {
    const flow = this.flows.get(terminalId);
    if (!flow?.clients.delete(client)) {
      return;
    }
    this.update(terminalId, flow);
    if (flow.clients.size === 0) {
      this.forgetTerminal(terminalId);
    }
  }

  acknowledge(terminalId: string, client: object, nextSeq: number): void {
    const flow = this.flows.get(terminalId);
    const flowClient = flow?.clients.get(client);
    if (
      !flow ||
      !flowClient ||
      nextSeq <= flowClient.acknowledgedNextSeq
    ) {
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
    if (!flow) {
      return;
    }
    if (
      flow.enabledDaemonSessionId !== null &&
      flow.enabledDaemonSessionId !== daemonSessionId
    ) {
      flow.enabledDaemonSessionId = null;
    }
    const previousNextSeq = flow.receivedNextSeq;
    flow.receivedNextSeq = Math.max(previousNextSeq, seq + 1);
    const now = this.now();
    for (const flowClient of flow.clients.values()) {
      if (flowClient.acknowledgedNextSeq >= previousNextSeq) {
        flowClient.lastProgressAt = now;
      }
    }
    if (
      flow.enabledDaemonSessionId === null &&
      hasGoverningClient(flow)
    ) {
      flow.enabledDaemonSessionId = daemonSessionId;
      flow.sentAckNextSeq = flow.receivedNextSeq;
      this.options.sendDaemonMessage(daemonSessionId, {
        type: "terminal.flow-control",
        terminalId,
        enabled: true,
      });
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

  private update(terminalId: string, flow: TerminalOutputFlow): void {
    let target: number | null = null;
    for (const flowClient of flow.clients.values()) {
      if (isGoverning(flowClient)) {
        target = Math.max(
          target ?? flowClient.acknowledgedNextSeq,
          flowClient.acknowledgedNextSeq,
        );
      }
    }
    const daemonSessionId = flow.enabledDaemonSessionId;
    if (target === null) {
      if (daemonSessionId !== null) {
        flow.enabledDaemonSessionId = null;
        this.options.sendDaemonMessage(daemonSessionId, {
          type: "terminal.flow-control",
          terminalId,
          enabled: false,
        });
      }
      this.clearStallTimeout(flow);
      return;
    }
    if (daemonSessionId !== null && target > flow.sentAckNextSeq) {
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
    if (flow.enabledDaemonSessionId === null) {
      this.clearStallTimeout(flow);
      return;
    }
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
  return flowClient.visible && !flowClient.stalled;
}

function hasGoverningClient(flow: TerminalOutputFlow): boolean {
  for (const flowClient of flow.clients.values()) {
    if (isGoverning(flowClient)) {
      return true;
    }
  }
  return false;
}
