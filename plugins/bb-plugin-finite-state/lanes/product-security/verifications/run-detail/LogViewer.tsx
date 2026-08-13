import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";

export function LogViewer({ projectId, projectVersionId, runId, available }: { projectId: string; projectVersionId: string | null; runId: string | null; available: boolean }): React.JSX.Element {
  if (!runId || !projectVersionId || !available) return <p className="text-sm text-muted-foreground">No scoped log is cached for this run.</p>;
  const href = `/api/v1/plugins/finite-state/http/product-security/verifications/log?projectId=${encodeURIComponent(projectId)}&projectVersionId=${encodeURIComponent(projectVersionId)}&runId=${encodeURIComponent(runId)}`;
  return <div className="space-y-3"><Alert><Icon name="Info" /><AlertDescription>Large logs are delivered through the authenticated HTTP route, outside JSON RPC.</AlertDescription></Alert><Button asChild size="sm" variant="outline"><a href={href}><Icon name="Download" />Download cached log</a></Button></div>;
}
