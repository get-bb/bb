export type DesktopShutdownSignal = "SIGINT" | "SIGTERM";
export type DesktopSignalListener = () => void;

export interface DesktopShutdownState {
  inProgress: boolean;
}

export interface DesktopSignalProcess {
  off(signal: DesktopShutdownSignal, listener: DesktopSignalListener): void;
  on(signal: DesktopShutdownSignal, listener: DesktopSignalListener): void;
}

export interface HandleDesktopShutdownSignalArgs {
  exitProcess(code: number): void;
  quitApplication(): void;
  signal: DesktopShutdownSignal;
  state: DesktopShutdownState;
  stopOwnedRuntime(): Promise<void>;
}

export interface RegisterDesktopShutdownSignalHandlersArgs {
  exitProcess(code: number): void;
  processEvents: DesktopSignalProcess;
  quitApplication(): void;
  state: DesktopShutdownState;
  stopOwnedRuntime(): Promise<void>;
}

export interface RegisteredDesktopShutdownSignalHandlers {
  remove(): void;
}

interface SignalExitCodeArgs {
  signal: DesktopShutdownSignal;
}

export function createDesktopShutdownState(): DesktopShutdownState {
  return { inProgress: false };
}

export function signalExitCode(args: SignalExitCodeArgs): number {
  return args.signal === "SIGINT" ? 130 : 143;
}

export async function handleDesktopShutdownSignal(
  args: HandleDesktopShutdownSignalArgs,
): Promise<void> {
  if (args.state.inProgress) {
    return;
  }

  args.state.inProgress = true;
  await args.stopOwnedRuntime();
  args.exitProcess(signalExitCode({ signal: args.signal }));
  args.quitApplication();
}

export function registerDesktopShutdownSignalHandlers(
  args: RegisterDesktopShutdownSignalHandlersArgs,
): RegisteredDesktopShutdownSignalHandlers {
  const sigintHandler = (): void => {
    void handleDesktopShutdownSignal({
      exitProcess: args.exitProcess,
      quitApplication: args.quitApplication,
      signal: "SIGINT",
      state: args.state,
      stopOwnedRuntime: args.stopOwnedRuntime,
    });
  };
  const sigtermHandler = (): void => {
    void handleDesktopShutdownSignal({
      exitProcess: args.exitProcess,
      quitApplication: args.quitApplication,
      signal: "SIGTERM",
      state: args.state,
      stopOwnedRuntime: args.stopOwnedRuntime,
    });
  };

  args.processEvents.on("SIGINT", sigintHandler);
  args.processEvents.on("SIGTERM", sigtermHandler);

  return {
    remove() {
      args.processEvents.off("SIGINT", sigintHandler);
      args.processEvents.off("SIGTERM", sigtermHandler);
    },
  };
}
