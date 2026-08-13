import { useState } from "react";
import { useRpc, useSettings } from "@bb/plugin-sdk/app";
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
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<"standalone_unpack" | "api">("standalone_unpack");
  const [pvId, setPvId] = useState(initialPvId);
  const [scanId, setScanId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [firmwarePath, setFirmwarePath] = useState("");
  const [maxDepth, setMaxDepth] = useState("12");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (submitting || !projectId || !pvId.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      if (source === "standalone_unpack") {
        if (!environmentId.trim() || !firmwarePath.trim()) return;
        const issued = await rpc.call("firmwareInputIssue", {
          projectId,
          projectVersionId: pvId.trim(),
          environmentId: environmentId.trim(),
          firmwarePath: firmwarePath.trim(),
        });
        await rpc.call("firmwareMaterializeStart", {
          projectId,
          projectVersionId: pvId.trim(),
          source: "standalone_unpack",
          inputId: issued.inputId,
          maxDepth: Number(maxDepth),
        });
      } else {
        await rpc.call("firmwareMaterializeStart", {
          projectId,
          projectVersionId: pvId.trim(),
          source: "api",
          mode: "metadata",
          ...(scanId.trim() ? { scanId: scanId.trim() } : {}),
        });
      }
      onStarted?.(pvId.trim());
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Firmware materialization could not start.");
    } finally {
      setSubmitting(false);
    }
  }

  const wrapperConfigured = typeof settings.values?.standaloneUnpackExecutablePath === "string" &&
    settings.values.standaloneUnpackExecutablePath.trim().length > 0;
  const factImage = typeof settings.values?.standaloneUnpackImage === "string" &&
    settings.values.standaloneUnpackImage.trim().length > 0
    ? settings.values.standaloneUnpackImage
    : "localhost:5000/services-unpack:latest";

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
            <div className="space-y-3">
              <Alert>
                <Icon name="Info" className="size-4" />
                <AlertTitle>{settings.isLoading ? "Checking extractor configuration" : wrapperConfigured ? "Confined workspace selection" : "Standalone extractor is not configured"}</AlertTitle>
                <AlertDescription>
                  {wrapperConfigured
                    ? <>Choose a file identity relative to the selected environment worktree. The server rejects absolute paths and canonical symlink escapes. Extractor image: <span className="font-mono">{factImage}</span>.</>
                    : <>Set the Standalone unpack wrapper in Finite State settings. The configured FACT image is <span className="font-mono">{factImage}</span>; local unpack remains disabled until the wrapper is set.</>}
                </AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Label htmlFor="firmware-environment">Environment ID</Label>
                <Input id="firmware-environment" value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)} placeholder="Current worktree environment" autoComplete="off" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="firmware-path">Workspace-relative image</Label>
                <Input id="firmware-path" value={firmwarePath} onChange={(event) => setFirmwarePath(event.target.value)} placeholder="artifacts/firmware.bin" autoComplete="off" />
                <p className="text-xs text-muted-foreground">Images outside the worktree are unsupported. Never paste an absolute browser or host path.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="firmware-depth">Maximum unpack depth</Label>
                <Input id="firmware-depth" type="number" min={1} max={12} value={maxDepth} onChange={(event) => setMaxDepth(event.target.value)} />
              </div>
            </div>
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
            disabled={submitting || !projectId || !pvId.trim() || (source === "standalone_unpack" && (
              settings.isLoading || !wrapperConfigured || !environmentId.trim() || !firmwarePath.trim() ||
              !Number.isInteger(Number(maxDepth)) || Number(maxDepth) < 1 || Number(maxDepth) > 12
            ))}
          >
            {submitting ? <Icon name="Loading" className="mr-1.5 size-4 animate-spin" /> : null}
            {source === "api" ? "Load API metadata" : "Select local image"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
