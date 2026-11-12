import { useCallback, useState } from "react";
import type { Thread, Environment } from "@bb/domain";
import {
  getProjectPathValidationMessage,
  normalizeProjectPathInput,
} from "@bb/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { LazyRemotePathBrowser } from "@/components/dialogs/LazyRemotePathBrowser";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useHosts } from "@/hooks/queries/host-queries";
import { sdk } from "@/lib/sdk";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import { getPluginBoundSdk } from "@/lib/plugin-bound-sdk";

export function ThreadDirectoryDialog({
  target,
  onOpenChange,
}: {
  target: Thread | null;
  onOpenChange: (open: boolean) => void;
}) {
  const environment = useEnvironment(target?.environmentId);
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target && environment.data ? (
          <ThreadDirectoryDialogContent
            key={`${target.id}:${environment.data.id}`}
            thread={target}
            environment={environment.data}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Change working directory</DialogTitle>
              <DialogDescription>
                {environment.isError
                  ? "Could not load the thread environment. Close this dialog and try again."
                  : "Loading the thread environment…"}
              </DialogDescription>
            </DialogHeader>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ThreadDirectoryDialogContent({
  thread,
  environment,
  onClose,
}: {
  thread: Thread;
  environment: Environment;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: hosts } = useHosts();
  const host = hosts?.find((candidate) => candidate.id === environment.hostId);
  const [path, setPath] = useState<string | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  const onDirectoryChange = useCallback((value: string | null) => {
    setPath(value);
    setValidationMessage(null);
  }, []);
  const mutation = useMutation({
    mutationFn: (path: string) =>
      getPluginBoundSdk(
        sdk,
        "thread-list",
        queryClient,
      ).threads.experimental_changeDirectory({
        threadId: thread.id,
        path,
        expectedEnvironmentId: environment.id,
      }),
    onSuccess: () => onClose(),
    onError: (error) =>
      showMutationErrorToast({
        error,
        fallbackMessage: "Failed to change working directory.",
      }),
  });
  const available = host?.status === "connected";
  return (
    <form
      className="min-w-0 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (mutation.isPending || !available || !path) return;
        const normalized = normalizeProjectPathInput(path);
        const failure = getProjectPathValidationMessage(normalized);
        setValidationMessage(failure);
        if (!failure) mutation.mutate(normalized);
      }}
    >
      <DialogHeader>
        <DialogTitle>Change working directory</DialogTitle>
        <DialogDescription>
          Choose a folder
          {host ? ` on ${host.name}` : " on the thread's machine"}. Future
          messages use this folder. The conversation and project stay the same.
        </DialogDescription>
      </DialogHeader>
      {!available ? (
        <p className="text-sm text-muted-foreground">
          {hosts
            ? "The thread's machine is offline. Bring it online to choose a folder."
            : "Loading machine…"}
        </p>
      ) : (
        <LazyRemotePathBrowser
          allowCreateFolder={false}
          hostId={environment.hostId}
          initialPath={environment.path}
          disabled={mutation.isPending}
          onDirectoryChange={onDirectoryChange}
        />
      )}
      {validationMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {validationMessage}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={mutation.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={mutation.isPending || !available || !path}
        >
          {mutation.isPending ? "Changing…" : "Change directory"}
        </Button>
      </DialogFooter>
    </form>
  );
}
