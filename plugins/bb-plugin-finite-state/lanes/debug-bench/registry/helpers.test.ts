import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import { familyDescriptor } from "./families.js";
import {
  confirmHelperInstall,
  helperInstallRecord,
  proposeHelperInstall,
} from "./helpers.js";

const databases: Database.Database[] = [];

function createConnection(path = ":memory:"): Database.Database {
  const db = new Database(path);
  databases.push(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.transaction(() => {
    for (const statement of MIGRATIONS) db.exec(statement);
  })();
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("helper installation confirmation", () => {
  it("records a proposal and never installs without explicit confirmation", async () => {
    const db = createConnection(":memory:");
    migrate(db);
    const family = familyDescriptor("serial-ports");
    if (!family) throw new Error("missing test descriptor");
    const installer = vi.fn(async () => ({ message: null }));
    const proposal = proposeHelperInstall(db, family, new Date("2026-08-13T10:00:00.000Z"));
    expect(installer).not.toHaveBeenCalled();
    await expect(confirmHelperInstall(
      db,
      proposal.proposalToken,
      { confirmed: false, confirmedBy: "human-1" },
      installer,
    )).rejects.toThrow("HELPER_INSTALL_CONFIRMATION_REQUIRED");
    expect(installer).not.toHaveBeenCalled();
    expect(helperInstallRecord(db, proposal.proposalToken)).toMatchObject({ state: "proposed", confirmed_by: null });
  });

  it("records confirmed success and failure outcomes", async () => {
    const db = createConnection(":memory:");
    migrate(db);
    const family = familyDescriptor("serial-ports");
    if (!family) throw new Error("missing test descriptor");
    const success = proposeHelperInstall(db, family);
    await expect(confirmHelperInstall(
      db,
      success.proposalToken,
      { confirmed: true, confirmedBy: "human-1" },
      async () => ({ message: "installed" }),
    )).resolves.toMatchObject({ state: "installed", confirmedBy: "human-1" });
    expect(helperInstallRecord(db, success.proposalToken)).toMatchObject({ state: "installed", confirmed_by: "human-1" });

    const failure = proposeHelperInstall(db, family);
    await expect(confirmHelperInstall(
      db,
      failure.proposalToken,
      { confirmed: true, confirmedBy: "human-2" },
      async () => { throw new Error("pip unavailable"); },
    )).resolves.toMatchObject({ state: "failed", message: "pip unavailable" });
    expect(helperInstallRecord(db, failure.proposalToken)).toMatchObject({ state: "failed", confirmed_by: "human-2" });
  });
});
