import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type Database from "better-sqlite3";
import type { FamilyDescriptor, HelperDescriptor } from "./families.js";
import { initializeRegistryStore } from "./store.js";

const execFileAsync = promisify(execFile);

export interface HelperCheck {
  available: boolean;
  reason: string | null;
}

export type HelperProbe = (helper: HelperDescriptor) => Promise<HelperCheck>;
export type HelperInstaller = (
  command: string,
  args: readonly string[],
) => Promise<{ message: string | null }>;

export interface HelperInstallProposal {
  proposalToken: string;
  familyId: string;
  helperId: string;
  helperName: string;
  source: string;
  why: string;
  command: string;
  proposedAt: string;
}

export interface HelperInstallOutcome {
  proposalToken: string;
  familyId: string;
  helperId: string;
  state: "installed" | "failed";
  confirmedBy: string;
  message: string | null;
  completedAt: string;
}

interface ProposalRow {
  proposal_token: string;
  family_id: string;
  helper_id: string;
  helper_name: string;
  source: string;
  why: string;
  command_json: string;
  state: "proposed" | "installing" | "installed" | "failed";
  confirmed_by: string | null;
  message: string | null;
  proposed_at: string;
  completed_at: string | null;
}

function safeFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.slice(0, 1000);
  }
  return "The helper command failed without a diagnostic.";
}

export const probeHelper: HelperProbe = async (helper) => {
  const [command, ...args] = helper.check;
  try {
    await execFileAsync(command, args, { timeout: 10_000, maxBuffer: 256 * 1024 });
    return { available: true, reason: null };
  } catch (error) {
    return {
      available: false,
      reason: `${helper.displayName} is unavailable: ${safeFailure(error)}`,
    };
  }
};

export const executeHelperInstall: HelperInstaller = async (command, args) => {
  const result = await execFileAsync(command, [...args], {
    timeout: 5 * 60_000,
    maxBuffer: 512 * 1024,
  });
  const message = [result.stdout, result.stderr]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n")
    .slice(0, 1000);
  return { message: message || null };
};

export function proposeHelperInstall(
  db: Database.Database,
  family: FamilyDescriptor,
  now = new Date(),
): HelperInstallProposal {
  initializeRegistryStore(db);
  const proposalToken = `helper-${randomUUID()}`;
  const proposedAt = now.toISOString();
  const command = JSON.stringify(family.helper.install);
  db.prepare(
    `INSERT INTO bench_helper_install (
       proposal_token, family_id, helper_id, helper_name, source, why,
       command_json, state, proposed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?)`,
  ).run(
    proposalToken,
    family.id,
    family.helper.id,
    family.helper.displayName,
    family.helper.source,
    family.helper.why,
    command,
    proposedAt,
  );
  return {
    proposalToken,
    familyId: family.id,
    helperId: family.helper.id,
    helperName: family.helper.displayName,
    source: family.helper.source,
    why: family.helper.why,
    command: family.helper.install.join(" "),
    proposedAt,
  };
}

function parseInstallCommand(row: ProposalRow): readonly [string, ...string[]] {
  const parsed: unknown = JSON.parse(row.command_json);
  if (
    !Array.isArray(parsed) || parsed.length === 0 ||
    !parsed.every((part) => typeof part === "string")
  ) {
    throw new Error("INVALID_HELPER_INSTALL_PROPOSAL");
  }
  const [command, ...args] = parsed;
  if (command === undefined) throw new Error("INVALID_HELPER_INSTALL_PROPOSAL");
  return [command, ...args];
}

export async function confirmHelperInstall(
  db: Database.Database,
  proposalToken: string,
  confirmation: { confirmed: boolean; confirmedBy: string },
  installer: HelperInstaller = executeHelperInstall,
  now = new Date(),
): Promise<HelperInstallOutcome> {
  initializeRegistryStore(db);
  if (confirmation.confirmed !== true || confirmation.confirmedBy.trim().length === 0) {
    throw new Error("HELPER_INSTALL_CONFIRMATION_REQUIRED");
  }
  const row = db.prepare<[string], ProposalRow>(
    `SELECT * FROM bench_helper_install WHERE proposal_token = ?`,
  ).get(proposalToken);
  if (!row) throw new Error("HELPER_INSTALL_PROPOSAL_NOT_FOUND");
  if (row.state !== "proposed") throw new Error("HELPER_INSTALL_PROPOSAL_ALREADY_USED");
  const started = db.prepare(
    `UPDATE bench_helper_install
        SET state = 'installing', confirmed_by = ?
      WHERE proposal_token = ? AND state = 'proposed'`,
  ).run(confirmation.confirmedBy, proposalToken).changes;
  if (started !== 1) throw new Error("HELPER_INSTALL_PROPOSAL_ALREADY_USED");

  const [command, ...args] = parseInstallCommand(row);
  const completedAt = now.toISOString();
  try {
    const result = await installer(command, args);
    db.prepare(
      `UPDATE bench_helper_install
          SET state = 'installed', message = ?, completed_at = ?
        WHERE proposal_token = ? AND state = 'installing'`,
    ).run(result.message, completedAt, proposalToken);
    return {
      proposalToken,
      familyId: row.family_id,
      helperId: row.helper_id,
      state: "installed",
      confirmedBy: confirmation.confirmedBy,
      message: result.message,
      completedAt,
    };
  } catch (error) {
    const message = safeFailure(error);
    db.prepare(
      `UPDATE bench_helper_install
          SET state = 'failed', message = ?, completed_at = ?
        WHERE proposal_token = ? AND state = 'installing'`,
    ).run(message, completedAt, proposalToken);
    return {
      proposalToken,
      familyId: row.family_id,
      helperId: row.helper_id,
      state: "failed",
      confirmedBy: confirmation.confirmedBy,
      message,
      completedAt,
    };
  }
}

export function helperInstallRecord(
  db: Database.Database,
  proposalToken: string,
): ProposalRow | null {
  initializeRegistryStore(db);
  return db.prepare<[string], ProposalRow>(
    `SELECT * FROM bench_helper_install WHERE proposal_token = ?`,
  ).get(proposalToken) ?? null;
}
