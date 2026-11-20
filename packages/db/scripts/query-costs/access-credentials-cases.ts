import {
  deleteAccessCredential,
  deleteAccessCredentialsByKindAndLabel,
  deleteExpiredAccessCredentials,
  getAccessCredential,
  getAccessCredentialByTokenHash,
  insertAccessCredential,
  listAccessCredentials,
  touchAccessCredential,
  type InsertAccessCredentialArgs,
} from "../../src/data/access-credentials.js";
import type { DbConnection } from "../../src/connection.js";
import { registerCostGroup, scaled, type QueryCostCase } from "./case.js";

const ACCESS_CREDENTIALS = "packages/db/src/data/access-credentials.ts";
const BROWSERS_AT_FULL_SCALE = 400;
const DEVICES_AT_FULL_SCALE = 200;
const EXPIRED_AT_FULL_SCALE = 100;
const DAY_MS = 86_400_000;
const NOW = 1_795_000_000_000;

interface AccessCredentialsSeed {
  browserId: string;
  browserTokenHash: string;
  deviceId: string;
  localBrowserLabel: string;
}

function credential(
  args: Pick<InsertAccessCredentialArgs, "id" | "kind"> &
    Partial<InsertAccessCredentialArgs>,
): InsertAccessCredentialArgs {
  return {
    label: `${args.kind} ${args.id}`,
    tokenHash: null,
    dpopJkt: null,
    parentId: null,
    secureOnly: false,
    origin: "http://192.168.1.20:38886",
    createdAt: NOW - DAY_MS,
    lastUsedAt: NOW - DAY_MS,
    expiresAt: NOW + 30 * DAY_MS,
    ...args,
  };
}

function seedAccessCredentials(
  db: DbConnection,
  _fixture: unknown,
  scale: number,
): AccessCredentialsSeed {
  const browsers = scaled(BROWSERS_AT_FULL_SCALE, scale);
  for (let index = 0; index < browsers; index += 1) {
    insertAccessCredential(
      db,
      credential({
        id: `acc_browser_${index}`,
        kind: "browser",
        tokenHash: `browser-hash-${index}`,
      }),
    );
  }
  const devices = scaled(DEVICES_AT_FULL_SCALE, scale);
  for (let index = 0; index < devices; index += 1) {
    insertAccessCredential(
      db,
      credential({
        id: `acc_device_${index}`,
        kind: "device",
        dpopJkt: `jkt-${index}`,
      }),
    );
    insertAccessCredential(
      db,
      credential({
        id: `acc_device_browser_${index}`,
        kind: "device-browser",
        tokenHash: `device-browser-hash-${index}`,
        parentId: `acc_device_${index}`,
        expiresAt: NOW + 3_600_000,
      }),
    );
  }
  const expired = scaled(EXPIRED_AT_FULL_SCALE, scale);
  for (let index = 0; index < expired; index += 1) {
    insertAccessCredential(
      db,
      credential({
        id: `acc_expired_${index}`,
        kind: "browser",
        tokenHash: `expired-hash-${index}`,
        expiresAt: NOW - DAY_MS,
      }),
    );
  }
  insertAccessCredential(
    db,
    credential({
      id: "acc_local_browser",
      kind: "local-browser",
      label: "bb desktop",
      tokenHash: "local-browser-hash",
    }),
  );
  return {
    browserId: "acc_browser_0",
    browserTokenHash: "browser-hash-0",
    deviceId: "acc_device_0",
    localBrowserLabel: "bb desktop",
  };
}

const CASES: readonly QueryCostCase<AccessCredentialsSeed>[] = [
  {
    name: `${ACCESS_CREDENTIALS}#insertAccessCredential`,
    run: (db) =>
      insertAccessCredential(
        db,
        credential({
          id: "acc_new_browser",
          kind: "browser",
          tokenHash: "new-browser-hash",
        }),
      ),
  },
  {
    name: `${ACCESS_CREDENTIALS}#getAccessCredentialByTokenHash`,
    run: (db, _fixture, seed) =>
      getAccessCredentialByTokenHash(db, seed.browserTokenHash),
  },
  {
    name: `${ACCESS_CREDENTIALS}#getAccessCredential`,
    run: (db, _fixture, seed) => getAccessCredential(db, seed.deviceId),
  },
  {
    name: `${ACCESS_CREDENTIALS}#listAccessCredentials`,
    run: (db) => listAccessCredentials(db),
  },
  {
    name: `${ACCESS_CREDENTIALS}#deleteAccessCredential`,
    run: (db, _fixture, seed) => deleteAccessCredential(db, seed.deviceId),
  },
  {
    name: `${ACCESS_CREDENTIALS}#deleteAccessCredentialsByKindAndLabel`,
    run: (db, _fixture, seed) =>
      deleteAccessCredentialsByKindAndLabel(db, {
        kind: "local-browser",
        label: seed.localBrowserLabel,
      }),
  },
  {
    name: `${ACCESS_CREDENTIALS}#deleteExpiredAccessCredentials`,
    run: (db) => deleteExpiredAccessCredentials(db, NOW),
  },
  {
    name: `${ACCESS_CREDENTIALS}#touchAccessCredential`,
    run: (db, _fixture, seed) =>
      touchAccessCredential(db, {
        id: seed.browserId,
        lastUsedAt: NOW,
        expiresAt: NOW + 30 * DAY_MS,
      }),
  },
];

export const ACCESS_CREDENTIALS_COST_GROUP = registerCostGroup({
  name: "access-credentials",
  seed: seedAccessCredentials,
  cases: CASES,
});
