import type { Host } from "@bb/domain";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { useSystemConfig } from "../system/system-queries";
import {
  findNewlyConnectedHost,
  mintAddMachineCodes,
  resolveAddMachinePresentation,
  type AddMachineCodes,
  type AddMachinePresentation,
} from "./add-machine";
import { useHosts } from "./host-queries";

export interface AddMachineSession {
  /** True between `begin()` and `end()` (the sheet is up). */
  active: boolean;
  presentation: AddMachinePresentation;
  /** Milliseconds until the shown command expires; null without a command. */
  remainingMs: number | null;
  expired: boolean;
  minting: boolean;
  /** Open the sheet: snapshot the known hosts and mint the codes. */
  begin: () => void;
  /** The sheet closed: forget the codes and the baseline. */
  end: () => void;
  /** Mint a fresh pair of codes ("Try again", "Generate a new code"). */
  mint: () => void;
  /** The machine that connected since `begin()`, once it does. */
  connectedNewHost: Host | null;
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Couldn't create a join code.";
}

/**
 * Drives the add-machine sheet: `begin()` (from the press handler that
 * presents it) snapshots the hosts known at that moment and mints the codes;
 * while a command is on screen a 1 s clock drives the expiry countdown; the
 * host list (live through the `host-list` subscription) reveals the new
 * machine as a connected host outside the snapshot.
 */
export function useAddMachineSession(): AddMachineSession {
  const { sdk } = useProfileClient();
  const configQuery = useSystemConfig();
  const hostsQuery = useHosts();
  const hostsData = hostsQuery.data;
  const serverUrl = configQuery.data?.serverUrl ?? null;

  const mintCodes = useMutation<AddMachineCodes, Error, void>({
    meta: { showErrorToast: false },
    mutationFn: () => mintAddMachineCodes(sdk),
  });
  const mint = mintCodes.mutate;
  const reset = mintCodes.reset;

  // Hosts known when the sheet opened; a connected host outside this set is
  // the one the user just paired. Null while the sheet is closed.
  const [baselineHostIds, setBaselineHostIds] = useState<Set<string> | null>(
    null,
  );
  // The countdown clock; re-based whenever codes are (re)minted so the first
  // tick is not stale from an earlier session.
  const [now, setNow] = useState(() => Date.now());
  const begin = useCallback(() => {
    setBaselineHostIds(new Set((hostsData ?? []).map((host) => host.id)));
    setNow(Date.now());
    mint();
  }, [hostsData, mint]);
  const end = useCallback(() => {
    setBaselineHostIds(null);
    reset();
  }, [reset]);
  const active = baselineHostIds !== null;

  const presentation = resolveAddMachinePresentation({
    codes: mintCodes.data ?? null,
    error: mintCodes.isError ? describeError(mintCodes.error) : null,
    serverUrl,
  });
  const expiresAt =
    presentation.kind === "command" ? presentation.expiresAt : null;

  useEffect(() => {
    if (!active || expiresAt === null) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [active, expiresAt]);
  const remainingMs = expiresAt === null ? null : expiresAt - now;

  return {
    active,
    presentation,
    remainingMs,
    expired: remainingMs !== null && remainingMs <= 0,
    minting: mintCodes.isPending,
    begin,
    end,
    mint: () => {
      setNow(Date.now());
      mint();
    },
    connectedNewHost: findNewlyConnectedHost(hostsData, baselineHostIds),
  };
}
