// bb-fork(windows): the shell the Start terminal action launches.
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

export const terminalShellIdAtom =
  createSyncedPreferenceAtom("terminal.shellId");
