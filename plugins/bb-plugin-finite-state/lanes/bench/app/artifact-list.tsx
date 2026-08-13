import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";

export interface BenchArtifactLink {
  runId: string;
  name: string;
  kind: string;
  sha256: string | null;
  bytes: number | null;
  downloadPath: string;
}

interface ArtifactListProps {
  runId: string;
  artifacts: Array<{
    name: string;
    kind: string;
    sha256: string | null;
    bytes: number | null;
    downloadAvailable?: boolean;
  }>;
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function bytes(value: number | null): string {
  if (value === null) return "size unknown";
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${(value / 1_048_576).toFixed(1)} MiB`;
}

export function ArtifactList({ runId, artifacts }: ArtifactListProps): React.JSX.Element {
  if (artifacts.length === 0) return <p className="text-sm text-muted-foreground">No artifact metadata has been recorded for this run.</p>;
  return (
    <div className="space-y-2">
      {artifacts.map((artifact, index) => {
        const safeName = SAFE_NAME.test(artifact.name);
        const verifiedHash = artifact.sha256 !== null && SHA256.test(artifact.sha256);
        if (!safeName) {
          return <Alert key={`unsafe-${index}`}><Icon name="AlertTriangle" /><AlertDescription>An artifact has an unsafe or expired logical name. Refresh run evidence to recover it.</AlertDescription></Alert>;
        }
        const href = `/api/v1/plugins/finite-state/http/bench/runs/artifact?runId=${encodeURIComponent(runId)}&artifactName=${encodeURIComponent(artifact.name)}`;
        return (
          <div className="flex items-center gap-3 rounded-md border border-border bg-background p-3" key={`${artifact.name}-${index}`}>
            <Icon className="text-muted-foreground" name="Download" />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{artifact.name}</p><p className="mt-1 text-xs text-muted-foreground">{artifact.kind} · {bytes(artifact.bytes)}</p>{verifiedHash ? <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={artifact.sha256 ?? undefined}>sha256 {artifact.sha256}</p> : <p className="mt-1 text-xs text-destructive">Verified hash unavailable — refresh evidence before trusting this artifact.</p>}</div>
            {verifiedHash && artifact.downloadAvailable ? <Button asChild size="sm" variant="outline"><a href={href}><Icon name="Download" />Download</a></Button> : <Badge variant="outline">Recovery needed</Badge>}
          </div>
        );
      })}
    </div>
  );
}
