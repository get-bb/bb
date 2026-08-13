import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";

export function RunActions({ checkId, running, jobState, manualMessage, onRun }: { checkId: string | null; running: boolean; jobState: string | null; manualMessage: string; onRun(checkId: string): void }): React.JSX.Element {
  return <div className="space-y-3"><div className="flex items-center gap-3"><Button disabled={!checkId || running} onClick={() => checkId && onRun(checkId)}><Icon name="Play" />{running ? "Running verification…" : "Run verification"}</Button>{jobState ? <span className="text-sm text-muted-foreground" role="status">Job {jobState}</span> : null}</div>{!checkId ? <Alert><Icon name="AlertTriangle" /><AlertDescription>No mapped check is available. The run action cannot invent a check.</AlertDescription></Alert> : null}<Alert><Icon name="Info" /><AlertDescription>{manualMessage}</AlertDescription></Alert></div>;
}
