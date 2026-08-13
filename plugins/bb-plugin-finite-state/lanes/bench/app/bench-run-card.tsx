import { useBbContext } from "@bb/plugin-sdk/app";
import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Icon } from "@bb/shared-ui/icon";
import { RunDetail } from "./run-detail.js";

export interface BenchRunCardProps {
  id: string;
}

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;

/** Directive-ready: the validated id is the only supplied row data. */
export function BenchRunCard({ id }: BenchRunCardProps): React.JSX.Element {
  const { projectId } = useBbContext();
  if (!projectId) return <Alert><Icon name="AlertTriangle" /><AlertDescription>Select the bb project that owns this bench run.</AlertDescription></Alert>;
  if (!SAFE_RUN_ID.test(id)) return <Alert><Icon name="AlertTriangle" /><AlertDescription>The bench run identifier is invalid. No request was sent.</AlertDescription></Alert>;
  return <RunDetail compact projectId={projectId} projectVersionId={null} runId={id} />;
}
