import type { TerminalSessionCloseReason } from "@bb/domain";
import type {
  HostDaemonTerminalDataServerMessage,
  HostDaemonTerminalDataDaemonMessage,
} from "@bb/host-daemon-contract/terminal-data";
import type { TerminalDataPlaneSocket } from "./terminal-data-plane.js";

export interface TerminalDataPlaneHost {
  sendDaemonDataMessage(
    daemonSessionId: string,
    message: HostDaemonTerminalDataServerMessage,
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
  onCatchUpError(args: {
    code: string;
    daemonSessionId: string;
    message: string;
    requestId: string;
    terminalId: string;
  }): void;
  onReplay(args: {
    daemonSessionId: string;
    message: Extract<
      HostDaemonTerminalDataDaemonMessage,
      { type: "terminal.replay" }
    >;
  }): void;
  onDaemonSendFailed(daemonSessionId: string): void;
}
