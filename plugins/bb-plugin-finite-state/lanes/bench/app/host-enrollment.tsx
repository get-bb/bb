import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@bb/plugin-sdk/app";
import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import type { RpcContract } from "../../../shared/contract.js";

export interface EnrolledBenchHost {
  id: string;
  name: string;
  status: string;
  capabilities: string[];
  lastSeenAt: string | null;
}

interface HostEnrollmentProps {
  hosts: EnrolledBenchHost[];
  loadingHosts: boolean;
  onRefreshHosts(): Promise<void>;
}

export function HostEnrollment({
  hosts,
  loadingHosts,
  onRefreshHosts,
}: HostEnrollmentProps): React.JSX.Element {
  const rpc = useRpc<RpcContract>();
  const [enrollment, setEnrollment] = useState<{
    joinCode: string;
    hostId: string;
    expiresAt: string;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enrollment) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [enrollment]);
  const expired = enrollment !== null && Date.parse(enrollment.expiresAt) <= now;
  const confirmed = enrollment !== null && hosts.some((host) => host.id === enrollment.hostId);

  const issue = useCallback(async () => {
    setIssuing(true);
    setError(null);
    try {
      const created = await rpc.call("benchHostsJoinCode", null);
      setEnrollment(created);
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A host join code could not be issued.");
    } finally {
      setIssuing(false);
    }
  }, [rpc]);

  return (
    <section aria-labelledby="bench-host-enrollment-title" className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground"><Icon name="ElectricPlugs" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold" id="bench-host-enrollment-title">Enroll a bench host</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Run the bb host-daemon on the target machine, then redeem a short-lived join code there. A code is only an invitation; this panel considers the target enrolled only after bb lists the host.</p>
        </div>
      </div>
      {error ? <Alert className="mt-3"><Icon name="AlertCircle" /><AlertDescription>{error}</AlertDescription></Alert> : null}
      {enrollment && !expired ? (
        <div className="mt-4 rounded-md border border-border bg-background p-3">
          <p className="text-xs font-medium text-muted-foreground">Join code</p>
          <p aria-label="Bench host join code" className="mt-1 select-all font-mono text-lg font-semibold tracking-widest">{enrollment.joinCode}</p>
          <p className="mt-2 text-xs text-muted-foreground">Expires {new Date(enrollment.expiresAt).toLocaleString()}</p>
          <div className="mt-3 flex items-center gap-2">
            {confirmed ? <Badge><Icon name="CircleCheck" />Listed by bb</Badge> : <Badge variant="outline"><Icon name="Loading" />Waiting for bb host list</Badge>}
            <Button disabled={loadingHosts} onClick={() => void onRefreshHosts()} size="sm" variant="outline">Refresh hosts</Button>
          </div>
        </div>
      ) : null}
      {expired ? (
        <Alert className="mt-3"><Icon name="AlertTriangle" /><AlertDescription>This join code expired and is no longer shown. Issue a new code before continuing on the target.</AlertDescription></Alert>
      ) : null}
      <Button className="mt-4" disabled={issuing} onClick={() => void issue()} size="sm" variant="outline">
        <Icon name="ElectricPlugs" />{issuing ? "Issuing…" : enrollment ? "Issue new code" : "Issue join code"}
      </Button>
    </section>
  );
}
