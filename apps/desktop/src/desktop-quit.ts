import type { DesktopQuitStatus } from "@bb/server-contract";

interface QuitEvent {
  preventDefault(): void;
}

interface DesktopQuitDependencies {
  readStatus(): Promise<DesktopQuitStatus>;
  confirm(runningAgentCount: number | null): Promise<{
    quit: boolean;
    dontAskAgain: boolean;
  }>;
  disableConfirmation(): Promise<void>;
  finishQuit(): Promise<void>;
  quitApplication(): void;
  requestQuit(): void;
  onError(error: unknown): void;
}

export function createDesktopQuitController(deps: DesktopQuitDependencies) {
  let phase: "idle" | "checking" | "stopping" | "ready" = "idle";
  let bypass = false;
  let generation = 0;

  async function proceed(token: number): Promise<void> {
    try {
      if (!bypass) {
        let status: DesktopQuitStatus | null = null;
        try {
          status = await deps.readStatus();
        } catch (error) {
          deps.onError(error);
        }
        if (token !== generation) return;
        if (
          status === null ||
          (status.confirmDesktopQuit && status.runningAgentCount > 0)
        ) {
          const decision = await deps.confirm(
            status?.runningAgentCount ?? null,
          );
          if (token !== generation) return;
          if (!decision.quit) {
            phase = "idle";
            return;
          }
          if (decision.dontAskAgain) {
            try {
              await deps.disableConfirmation();
            } catch (error) {
              deps.onError(error);
            }
          }
        }
      }
      if (token !== generation) return;
      phase = "stopping";
      try {
        await deps.finishQuit();
      } finally {
        phase = "ready";
        deps.quitApplication();
      }
    } catch (error) {
      if (phase === "checking") phase = "idle";
      deps.onError(error);
    }
  }

  return {
    shouldCloseWindow(
      platform: NodeJS.Platform,
      isLastWindow: boolean,
    ): boolean {
      if (
        platform === "darwin" ||
        !isLastWindow ||
        phase === "ready" ||
        phase === "stopping"
      )
        return true;
      deps.requestQuit();
      return false;
    },
    beforeQuit(event: QuitEvent): void {
      if (phase === "ready") return;
      event.preventDefault();
      if (phase !== "idle") return;
      phase = "checking";
      void proceed(++generation);
    },
    bypassConfirmation(): void {
      bypass = true;
      if (phase === "checking") {
        phase = "idle";
        generation++;
      }
    },
    restoreConfirmation(): void {
      bypass = false;
    },
  };
}
