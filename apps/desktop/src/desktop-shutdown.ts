export type DesktopShutdownSignal = "SIGINT" | "SIGTERM";
export type DesktopSignalListener = () => void;

interface DesktopShutdownState {
  inProgress: boolean;
}

export interface DesktopSignalProcess {
  on(signal: DesktopShutdownSignal, listener: DesktopSignalListener): void;
}

interface HandleDesktopShutdownSignalArgs {
  exitProcess(code: number): void;
  quitApplication(): void;
  signal: DesktopShutdownSignal;
  state: DesktopShutdownState;
  stopOwnedRuntime(): Promise<void>;
}

interface RegisterDesktopShutdownSignalHandlersArgs {
  exitProcess(code: number): void;
  processEvents: DesktopSignalProcess;
  quitApplication(): void;
  state: DesktopShutdownState;
  stopOwnedRuntime(): Promise<void>;
}

interface SignalExitCodeArgs {
  signal: DesktopShutdownSignal;
}

export function createDesktopShutdownState(): DesktopShutdownState {
  return { inProgress: false };
}

function signalExitCode(args: SignalExitCodeArgs): number {
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
): void {
  const signals: DesktopShutdownSignal[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    args.processEvents.on(signal, () => {
      void handleDesktopShutdownSignal({
        exitProcess: args.exitProcess,
        quitApplication: args.quitApplication,
        signal,
        state: args.state,
        stopOwnedRuntime: args.stopOwnedRuntime,
      });
    });
  }
}
