export interface AttestationView {
  id: string; runId: string; firmwareDigest: string; evidenceDigest: string;
  signer: string; signature: string; signedAt: string;
  verification: "valid" | "invalid" | "unverified"; boundToCurrentFirmware: boolean;
}

export function attestationIsEvidence(attestation: AttestationView): boolean {
  return attestation.verification === "valid" && attestation.boundToCurrentFirmware;
}
