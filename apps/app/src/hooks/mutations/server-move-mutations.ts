import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ServerMoveCheckRequest,
  ServerMoveStartRequest,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import {
  applyServerMoveStatus,
  invalidateServerMoveStatus,
} from "../cache-owners/server-move-cache-owner";

export function useCheckServerMove() {
  return useMutation({
    meta: {
      showErrorToast: false,
    },
    mutationFn: (request: ServerMoveCheckRequest) =>
      sdk.experimental_server.checkMove(request),
  });
}

export function useStartServerMove() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      showErrorToast: false,
    },
    mutationFn: (request: ServerMoveStartRequest) =>
      sdk.experimental_server.startMove(request),
    onSuccess: (move) => applyServerMoveStatus({ move, queryClient }),
  });
}

export function useCancelServerMove() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      showErrorToast: false,
    },
    mutationFn: () => sdk.experimental_server.cancelMove(),
    onSuccess: (move) => applyServerMoveStatus({ move, queryClient }),
  });
}

export function useDeleteOldServerCopy() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      showErrorToast: false,
    },
    mutationFn: (hostId: string) =>
      sdk.hosts.experimental_deleteOldServerCopy({ hostId }),
    onSuccess: () => {
      void invalidateServerMoveStatus({ queryClient });
    },
  });
}
