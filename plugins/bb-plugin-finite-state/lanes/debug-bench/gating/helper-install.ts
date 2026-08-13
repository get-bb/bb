import type { BbPluginApi } from "@bb/plugin-sdk";
import type { FamilyDescriptor } from "../registry/families.js";
import {
  confirmHelperInstall as installConfirmedHelper,
  helperInstallRecord,
  proposeHelperInstall as proposeFamilyHelperInstall,
  type HelperInstaller,
  type HelperInstallOutcome,
  type HelperInstallProposal,
} from "../registry/helpers.js";
import {
  consumeDestructiveGrant,
  destructiveGrantAudit,
  HELPER_INSTALL_OPERATION,
  mintDestructiveGrant,
  requestHumanConfirmation,
} from "./destructive.js";
import type { GatingDeps } from "./mode.js";

export type { HelperInstallOutcome, HelperInstallProposal } from "../registry/helpers.js";

export interface ConfirmHelperInstallRequest {
  bb: Pick<BbPluginApi, "ui">;
  deps: GatingDeps;
  threadId: string;
  proposalToken: string;
  installer?: HelperInstaller;
}

const initialized = new WeakSet<GatingDeps["db"]>();

function initialize(deps: GatingDeps): void {
  if (initialized.has(deps.db)) return;
  deps.db.exec(
    `CREATE TABLE IF NOT EXISTS bench_helper_install_gate_audit (
       proposal_token TEXT PRIMARY KEY,
       grant_id TEXT NOT NULL,
       caller_origin TEXT NOT NULL CHECK (caller_origin = 'bb.ui.requestInput'),
       confirmed_by TEXT NOT NULL,
       consumed_at TEXT NOT NULL,
       outcome TEXT CHECK (outcome IN ('installed','failed'))
     )`,
  );
  initialized.add(deps.db);
}

function displayCommand(value: string): string {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) || parsed.length === 0 ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new Error("INVALID_HELPER_INSTALL_PROPOSAL");
  }
  return parsed.join(" ");
}

export function proposeHelperInstall(
  db: GatingDeps["db"],
  family: FamilyDescriptor,
  now?: Date,
): HelperInstallProposal {
  return proposeFamilyHelperInstall(db, family, now);
}

export async function confirmHelperInstall(
  request: ConfirmHelperInstallRequest,
): Promise<HelperInstallOutcome> {
  initialize(request.deps);
  const proposal = helperInstallRecord(request.deps.db, request.proposalToken);
  if (!proposal) throw new Error("HELPER_INSTALL_PROPOSAL_NOT_FOUND");
  const deviceId = `helper:${proposal.helper_id}`;
  const evidence = await requestHumanConfirmation(request.bb, request.deps, {
    threadId: request.threadId,
    toolName: HELPER_INSTALL_OPERATION,
    deviceId,
    title: `Install ${proposal.helper_name}`,
    detail: proposal.why,
    command: displayCommand(proposal.command_json),
  });
  const grant = await mintDestructiveGrant(request.deps, evidence, {
    threadId: request.threadId,
    toolName: HELPER_INSTALL_OPERATION,
    deviceId,
    expiresAt: evidence.expiresAt,
  });
  const consumed = await consumeDestructiveGrant(
    request.deps,
    HELPER_INSTALL_OPERATION,
    deviceId,
    { threadId: request.threadId, turnId: evidence.confirmationId },
  );
  const audit = destructiveGrantAudit(request.deps, grant.grantId);
  if (!audit || consumed.consumedAt === null) throw new Error("HELPER_INSTALL_GATE_AUDIT_MISSING");
  request.deps.db.prepare(
    `INSERT INTO bench_helper_install_gate_audit (
       proposal_token, grant_id, caller_origin, confirmed_by, consumed_at, outcome
     ) VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(
    request.proposalToken,
    grant.grantId,
    audit.callerOrigin,
    audit.confirmedBy,
    consumed.consumedAt,
  );
  const outcome = await installConfirmedHelper(
    request.deps.db,
    request.proposalToken,
    { confirmed: true, confirmedBy: audit.confirmedBy },
    request.installer,
    request.deps.now?.() ?? new Date(),
  );
  request.deps.db.prepare(
    `UPDATE bench_helper_install_gate_audit SET outcome = ? WHERE proposal_token = ?`,
  ).run(outcome.state, request.proposalToken);
  return outcome;
}

export function helperInstallGateAudit(
  deps: GatingDeps,
  proposalToken: string,
): {
  grantId: string;
  callerOrigin: "bb.ui.requestInput";
  confirmedBy: string;
  consumedAt: string;
  outcome: "installed" | "failed" | null;
} | null {
  initialize(deps);
  const row = deps.db.prepare<
    [string],
    {
      grant_id: string;
      caller_origin: "bb.ui.requestInput";
      confirmed_by: string;
      consumed_at: string;
      outcome: "installed" | "failed" | null;
    }
  >(
    `SELECT grant_id, caller_origin, confirmed_by, consumed_at, outcome
       FROM bench_helper_install_gate_audit WHERE proposal_token = ?`,
  ).get(proposalToken);
  return row ? {
    grantId: row.grant_id,
    callerOrigin: row.caller_origin,
    confirmedBy: row.confirmed_by,
    consumedAt: row.consumed_at,
    outcome: row.outcome,
  } : null;
}
