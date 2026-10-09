import type { BbDesktopServerChoice } from "@bb/desktop-contract";

export type ServerChoice = BbDesktopServerChoice;

export interface ServerChoices {
  list(): Promise<ServerChoice[]>;
  subscribe(listener: (choices: ServerChoice[]) => void): () => void;
  select(id: string): void;
}

export function getServerChoices(): ServerChoices | null {
  const desktop = typeof window === "undefined" ? undefined : window.bbDesktop;
  if (
    desktop?.getServerChoices &&
    desktop.onServerChoicesChange &&
    desktop.selectServer
  ) {
    return {
      list: desktop.getServerChoices.bind(desktop),
      subscribe: desktop.onServerChoicesChange.bind(desktop),
      select: desktop.selectServer.bind(desktop),
    };
  }
  return null;
}
