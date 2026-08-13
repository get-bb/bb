import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Icon } from "@bb/shared-ui/icon";

export interface RunArtifact { id: string; name: string; kind: string; mediaType: string | null; sha256: string | null; bytes: number | null }

export function ArtifactList({ artifacts }: { artifacts: RunArtifact[]; projectId: string; runId: string | null }): React.JSX.Element {
  if (artifacts.length === 0) return <p className="text-sm text-muted-foreground">No artifact metadata is cached for the selected run.</p>;
  return <ul className="space-y-2">{artifacts.map((artifact) => {
    return <li className="flex items-center gap-3 rounded-md border border-border bg-background p-3" key={artifact.id}><Icon name="File" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{artifact.name}</p><p className="text-xs text-muted-foreground">{artifact.kind} · {artifact.bytes ?? "unknown"} bytes</p>{artifact.sha256 ? <p className="truncate font-mono text-xs text-muted-foreground">sha256 {artifact.sha256}</p> : null}</div><Badge variant="outline">Recovery needed</Badge></li>;
  })}<Alert><Icon name="Info" /><AlertDescription>Artifact bytes require an approved logical-locator adapter. Metadata remains visible when bytes cannot be recovered.</AlertDescription></Alert></ul>;
}
