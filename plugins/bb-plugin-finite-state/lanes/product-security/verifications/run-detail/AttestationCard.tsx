import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Icon } from "@bb/shared-ui/icon";
import type { AttestationView } from "./attestation.js";
import { attestationIsEvidence } from "./attestation.js";

export function AttestationCard({ attestation }: { attestation: AttestationView }): React.JSX.Element {
  const evidence = attestationIsEvidence(attestation);
  return <article className="rounded-md border border-border bg-background p-3">
    <div className="flex items-center gap-2"><Icon name={evidence ? "CircleCheck" : "AlertTriangle"} className={evidence ? "text-foreground" : "text-destructive"} /><span className="font-mono text-xs">{attestation.id}</span><Badge className="ml-auto" variant={evidence ? "default" : "destructive"}>{evidence ? "Valid evidence" : attestation.verification}</Badge></div>
    {!evidence ? <Alert className="mt-3"><Icon name="AlertTriangle" /><AlertDescription>{attestation.verification === "valid" ? "The signature is valid but its subject digest is not bound to this run's firmware." : "This attestation cannot count as evidence for this run."}</AlertDescription></Alert> : null}
    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-muted-foreground">Firmware subject</dt><dd className="break-all font-mono">{attestation.firmwareDigest}</dd></div><div><dt className="text-muted-foreground">Evidence digest</dt><dd className="break-all font-mono">{attestation.evidenceDigest}</dd></div><div><dt className="text-muted-foreground">Signer</dt><dd>{attestation.signer}</dd></div><div><dt className="text-muted-foreground">Signed</dt><dd>{attestation.signedAt}</dd></div><div><dt className="text-muted-foreground">Source run</dt><dd className="font-mono">{attestation.runId}</dd></div><div><dt className="text-muted-foreground">Signature</dt><dd className="truncate font-mono" title={attestation.signature}>{attestation.signature}</dd></div></dl>
  </article>;
}
