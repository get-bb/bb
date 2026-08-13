import { useState } from "react";
import { useRpc } from "@bb/plugin-sdk/app";
import { Alert, AlertDescription, AlertTitle } from "@bb/shared-ui/alert";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@bb/shared-ui/dialog";
import { Input } from "@bb/shared-ui/input";
import { Label } from "@bb/shared-ui/label";
import { RadioGroup, RadioGroupItem } from "@bb/shared-ui/radio-group";
import { Icon } from "@bb/shared-ui/icon";
import type { rpcContract } from "../../../shared/contract.js";

export interface MaterializeDialogProps {
  projectId: string;
  initialPvId?: string;
  onStarted?: (pvId: string) => void;
}

export function MaterializeDialog({
  projectId,
  initialPvId = "",
  onStarted,
}: MaterializeDialogProps): React.JSX.Element {
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"standalone_unpack" | "api">("standalone_unpack");
  const [pvId, setPvId] = useState(initialPvId);
  const [scanId, setScanId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (submitting || source === "standalone_unpack" || !pvId.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await rpc.call("firmwareMaterializeStart", {
        projectId,
        projectVersionId: pvId.trim(),
        source: "api",
        mode: "metadata",
        ...(scanId.trim() ? { scanId: scanId.trim() } : {}),
      });
      onStarted?.(pvId.trim());
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Firmware materialization could not start.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && setOpen(next)}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Icon name="Download" className="mr-1.5 size-4" />
          Materialize
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Materialize firmware</DialogTitle>
          <DialogDescription>
            Build a verified manifest and reveal the rootfs through bb&apos;s native workspace tree.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!projectId ? (
            <Alert>
              <Icon name="Info" className="size-4" />
              <AlertTitle>Select a project</AlertTitle>
              <AlertDescription>Firmware materialization requires a project and project version.</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="firmware-pv">Project version</Label>
            <Input
              id="firmware-pv"
              value={pvId}
              onChange={(event) => setPvId(event.target.value)}
              placeholder="Project version ID"
              autoComplete="off"
            />
          </div>

          <RadioGroup
            value={source}
            onValueChange={(value) => setSource(value === "api" ? "api" : "standalone_unpack")}
            className="space-y-3"
          >
            <Label className="flex items-start gap-3 rounded-lg border p-3">
              <RadioGroupItem value="standalone_unpack" className="mt-0.5" />
              <span className="space-y-1">
                <span className="block font-medium">Local image · recommended</span>
                <span className="block text-sm font-normal text-muted-foreground">
                  Complete, offline-capable standalone unpack using the FACT extractor image.
                </span>
              </span>
            </Label>
            <Label className="flex items-start gap-3 rounded-lg border p-3">
              <RadioGroupItem value="api" className="mt-0.5" />
              <span className="space-y-1">
                <span className="block font-medium">Platform API fallback</span>
                <span className="block text-sm font-normal text-muted-foreground">
                  Metadata first. File bytes require org-admin VIEW_ANY_PROJECT_FILE, range reads are bounded,
                  and bulk rootfs hydration is unavailable.
                </span>
              </span>
            </Label>
          </RadioGroup>

          {source === "standalone_unpack" ? (
            <Alert>
              <Icon name="Info" className="size-4" />
              <AlertTitle>Local selection is awaiting contract activation</AlertTitle>
              <AlertDescription>
                AMD-0003 adds the confined workspace-file issuer and the configured wrapper/FACT image.
                Until it merges, use the API fallback or the firmware CLI; arbitrary browser paths are never accepted.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="firmware-scan">Scan ID (optional)</Label>
              <Input
                id="firmware-scan"
                value={scanId}
                onChange={(event) => setScanId(event.target.value)}
                placeholder="Use the project version's current scan"
                autoComplete="off"
              />
            </div>
          )}

          {error ? (
            <Alert variant="destructive">
              <Icon name="AlertCircle" className="size-4" />
              <AlertTitle>Materialization failed</AlertTitle>
              <AlertDescription>{error} You can retry without losing the last verified mount.</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting || !projectId || !pvId.trim() || source === "standalone_unpack"}
          >
            {submitting ? <Icon name="Loading" className="mr-1.5 size-4 animate-spin" /> : null}
            {source === "api" ? "Load API metadata" : "Select local image"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
