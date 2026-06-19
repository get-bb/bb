import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/ui/icon";
import { appToast } from "@/components/ui/app-toast";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  usePeerShareIdentity,
  usePeerSharePeers,
  useSendPeerShare,
  useUpdatePeerShareIdentity,
} from "@/hooks/usePeerShare";

export interface PeerShareDialogProps {
  threadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "AirDrop for threads": pick a nearby instance and send a read-only snapshot
 * of the current thread. The same dialog controls this instance's discoverable
 * identity (renameable name + on/off) so people can be found by their computer
 * name, mirroring AirDrop's "discoverable to everyone on your network".
 */
export function PeerShareDialog({
  threadId,
  open,
  onOpenChange,
}: PeerShareDialogProps) {
  const identityQuery = usePeerShareIdentity({ enabled: open });
  const peersQuery = usePeerSharePeers({ enabled: open });
  const updateIdentity = useUpdatePeerShareIdentity();
  const sendShare = useSendPeerShare();

  const identity = identityQuery.data;
  const [nameDraft, setNameDraft] = useState("");
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  useEffect(() => {
    if (identity) {
      setNameDraft(identity.displayName);
    }
  }, [identity]);

  const peers = peersQuery.data?.peers ?? [];

  const handleToggleDiscoverable = (discoverable: boolean) => {
    updateIdentity.mutate({ discoverable });
  };

  const handleRename = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === identity?.displayName) {
      return;
    }
    updateIdentity.mutate(
      { displayName: trimmed },
      {
        onError: (error) =>
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to rename",
            }),
          ),
      },
    );
  };

  const handleSend = (address: string, port: number, peerName: string) => {
    const key = `${address}:${port}`;
    setSendingTo(key);
    sendShare.mutate(
      { threadId, address, port },
      {
        onSuccess: () => {
          appToast.success(`Sent to ${peerName}`);
          onOpenChange(false);
        },
        onError: (error) =>
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: `Couldn't reach ${peerName}`,
            }),
          ),
        onSettled: () => setSendingTo(null),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send thread to a nearby device</DialogTitle>
          <DialogDescription>
            People on your local network running bb appear here by their device
            name. The recipient sees an offer they can accept or decline.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* This instance's identity */}
          <section className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium" htmlFor="peer-share-name">
                Discoverable as
              </label>
              <Switch
                checked={identity?.discoverable ?? false}
                onCheckedChange={handleToggleDiscoverable}
                disabled={!identity || updateIdentity.isPending}
                aria-label="Toggle discoverable"
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Input
                id="peer-share-name"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={handleRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleRename();
                  }
                }}
                placeholder="This device's name"
                disabled={!identity}
                className="h-8"
              />
            </div>
            {identity && !identity.lanReachable ? (
              <p className="mt-2 text-xs text-muted-foreground">
                To receive shares, start bb with{" "}
                <code className="rounded bg-surface-selected px-1">
                  BB_LAN_SHARE=1
                </code>
                .
              </p>
            ) : null}
          </section>

          {/* Nearby peers */}
          <section className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Nearby</span>
              {peersQuery.isFetching ? (
                <Icon
                  name="Spinner"
                  className="size-3.5 animate-spin text-muted-foreground"
                  aria-hidden
                />
              ) : null}
            </div>
            {peers.length === 0 ? (
              <p className="py-3 text-center text-sm text-muted-foreground">
                No devices found yet. Make sure the other device is on the same
                network and is discoverable.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {peers.map((peer) => {
                  const key = `${peer.address}:${peer.port}`;
                  const isSending = sendingTo === key;
                  return (
                    <li
                      key={peer.instanceId}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover"
                    >
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <Icon
                          name="Laptop"
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm">
                            {peer.displayName}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {peer.address}
                          </span>
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isSending || sendShare.isPending}
                        onClick={() =>
                          handleSend(peer.address, peer.port, peer.displayName)
                        }
                      >
                        {isSending ? "Sending…" : "Send"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
