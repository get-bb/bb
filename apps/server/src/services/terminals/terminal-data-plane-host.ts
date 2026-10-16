import type { TerminalSessionCloseReason } from "@bb/domain";
import type {
  HostDaemonServerWsMessage,
  HostDaemonDaemonWsMessage,
} from "@bb/host-daemon-contract";
import type { TerminalDataPlaneSocket } from "./terminal-data-plane.js";

export interface TerminalDataPlaneHost {
  sendDaemonSessionMessage(
    daemonSessionId: string,
    message: HostDaemonServerWsMessage,
  ): boolean;
  onBrowserInput(args: {
    dataBase64: string;
    socket: TerminalDataPlaneSocket;
    terminalId: string;
  }): void;
  onBrowserResize(args: {
    cols: number;
    rows: number;
    socket: TerminalDataPlaneSocket;
    terminalId: string;
  }): void;
  onTerminalExited(args: {
    closeReason: TerminalSessionCloseReason;
    daemonSessionId: string;
    exitCode: number | null;
    terminalId: string;
  }): void;
  onAttachError(args: {
    code: string;
    daemonSessionId: string;
    message: string;
    requestId: string;
    terminalId: string;
  }): void;
  onReplay(args: {
    daemonSessionId: string;
    message: Extract<HostDaemonDaemonWsMessage, { type: "terminal.replay" }>;
  }): void;
  onDaemonSendFailed(daemonSessionId: string): void;
}
