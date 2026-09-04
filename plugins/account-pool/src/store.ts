import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import {
  accountSchema,
  accountSecretSchema,
  quotaSchema,
  type Account,
  type AccountQuota,
  type AccountSecret,
} from "./contracts.js";

const ACCOUNTS_KEY = "accounts:v1";
const accountsSchema = z.array(accountSchema);

export class AccountStore {
  private mutationLock: Promise<void> | null = null;

  constructor(
    private readonly kv: PluginKvStorage,
    private readonly secretsDir: string,
  ) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.secretsDir, { recursive: true, mode: 0o700 });
    await fs.chmod(this.secretsDir, 0o700);
  }

  async list(): Promise<Account[]> {
    const value = await this.kv.get(ACCOUNTS_KEY);
    if (value === undefined) return [];
    return accountsSchema.parse(value);
  }

  async get(id: string): Promise<Account | null> {
    return (await this.list()).find((account) => account.id === id) ?? null;
  }

  async add(
    input: Omit<Account, "id" | "createdAt">,
    secret: AccountSecret,
  ): Promise<Account> {
    return this.serialized(async () => {
      const account = accountSchema.parse({
        ...input,
        id: randomUUID(),
        createdAt: Date.now(),
      });
      await this.writeSecret(account.id, secret);
      try {
        const accounts = await this.list();
        accounts.push(account);
        await this.kv.set(ACCOUNTS_KEY, accounts);
      } catch (error) {
        await fs.rm(this.accountSecretPath(account.id), { force: true });
        throw error;
      }
      return account;
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.serialized(async () => {
      const accounts = await this.list();
      const next = accounts.filter((account) => account.id !== id);
      if (next.length === accounts.length) return false;
      await this.kv.set(ACCOUNTS_KEY, next);
      await fs.rm(this.accountSecretPath(id), { force: true });
      return true;
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<Account | null> {
    return this.serialized(async () => {
      const accounts = await this.list();
      const index = accounts.findIndex((account) => account.id === id);
      if (index < 0) return null;
      const current = accounts[index];
      if (current === undefined) return null;
      const updated = accountSchema.parse({ ...current, enabled });
      accounts[index] = updated;
      await this.kv.set(ACCOUNTS_KEY, accounts);
      return updated;
    });
  }

  async readSecret(id: string): Promise<AccountSecret> {
    const parsed = JSON.parse(
      await fs.readFile(this.accountSecretPath(id), "utf8"),
    );
    return accountSecretSchema.parse(parsed);
  }

  async writeSecret(id: string, secret: AccountSecret): Promise<void> {
    await this.initialize();
    const value = `${JSON.stringify(accountSecretSchema.parse(secret))}\n`;
    const destination = this.accountSecretPath(id);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, destination);
    await fs.chmod(destination, 0o600);
  }

  async hubKey(): Promise<string> {
    await this.initialize();
    const file = path.join(this.secretsDir, "hub-key");
    try {
      const existing = (await fs.readFile(file, "utf8")).trim();
      if (existing) return existing;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    const key = randomBytes(32).toString("base64url");
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${key}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await fs.link(temporary, file);
    } catch (error) {
      if (!isExistingFile(error)) throw error;
    } finally {
      await fs.rm(temporary, { force: true });
    }
    await fs.chmod(file, 0o600);
    return (await fs.readFile(file, "utf8")).trim();
  }

  private accountSecretPath(id: string): string {
    z.string().uuid().parse(id);
    return path.join(this.secretsDir, `account-${id}.json`);
  }

  private async serialized<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.mutationLock ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.mutationLock = tail;
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.mutationLock === tail) this.mutationLock = null;
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isExistingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

const quotaRowSchema = z
  .object({
    account_id: z.string().uuid(),
    five_hour_utilization: z.number().nullable(),
    five_hour_reset_at: z.number().int().nullable(),
    five_hour_status: z.string().nullable(),
    seven_day_utilization: z.number().nullable(),
    seven_day_reset_at: z.number().int().nullable(),
    seven_day_status: z.string().nullable(),
    representative_claim: z.string().nullable(),
    bucket_exhaustion_json: z.string(),
    observed_at: z.number().int().nullable(),
    held_until: z.number().int().nullable(),
    error: z.string().nullable(),
  })
  .strict();

const EMPTY_QUOTA = {
  fiveHourUtilization: null,
  fiveHourResetAt: null,
  fiveHourStatus: null,
  sevenDayUtilization: null,
  sevenDayResetAt: null,
  sevenDayStatus: null,
  representativeClaim: null,
  bucketExhaustion: {},
  observedAt: null,
  heldUntil: null,
  error: null,
};

export class QuotaStore {
  constructor(private readonly db: Database.Database) {}

  get(accountId: string): AccountQuota {
    const row = quotaRowSchema
      .optional()
      .parse(
        this.db
          .prepare("SELECT * FROM account_quota WHERE account_id = ?")
          .get(accountId),
      );
    if (row === undefined) {
      return quotaSchema.parse({ accountId, ...EMPTY_QUOTA });
    }
    return quotaSchema.parse({
      accountId: row.account_id,
      fiveHourUtilization: row.five_hour_utilization,
      fiveHourResetAt: row.five_hour_reset_at,
      fiveHourStatus: row.five_hour_status,
      sevenDayUtilization: row.seven_day_utilization,
      sevenDayResetAt: row.seven_day_reset_at,
      sevenDayStatus: row.seven_day_status,
      representativeClaim: row.representative_claim,
      bucketExhaustion: JSON.parse(row.bucket_exhaustion_json),
      observedAt: row.observed_at,
      heldUntil: row.held_until,
      error: row.error,
    });
  }

  put(quota: AccountQuota): void {
    const value = quotaSchema.parse(quota);
    this.db
      .prepare(
        `INSERT INTO account_quota (
          account_id, five_hour_utilization, five_hour_reset_at,
          five_hour_status, seven_day_utilization, seven_day_reset_at,
          seven_day_status, representative_claim, bucket_exhaustion_json,
          observed_at, held_until, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET
          five_hour_utilization = excluded.five_hour_utilization,
          five_hour_reset_at = excluded.five_hour_reset_at,
          five_hour_status = excluded.five_hour_status,
          seven_day_utilization = excluded.seven_day_utilization,
          seven_day_reset_at = excluded.seven_day_reset_at,
          seven_day_status = excluded.seven_day_status,
          representative_claim = excluded.representative_claim,
          bucket_exhaustion_json = excluded.bucket_exhaustion_json,
          observed_at = excluded.observed_at,
          held_until = excluded.held_until,
          error = excluded.error`,
      )
      .run(
        value.accountId,
        value.fiveHourUtilization,
        value.fiveHourResetAt,
        value.fiveHourStatus,
        value.sevenDayUtilization,
        value.sevenDayResetAt,
        value.sevenDayStatus,
        value.representativeClaim,
        JSON.stringify(value.bucketExhaustion),
        value.observedAt,
        value.heldUntil,
        value.error,
      );
  }

  remove(accountId: string): void {
    this.db
      .prepare("DELETE FROM account_quota WHERE account_id = ?")
      .run(accountId);
  }
}

export const QUOTA_MIGRATIONS = [
  `CREATE TABLE account_quota (
    account_id TEXT PRIMARY KEY,
    five_hour_utilization REAL,
    five_hour_reset_at INTEGER,
    five_hour_status TEXT,
    seven_day_utilization REAL,
    seven_day_reset_at INTEGER,
    seven_day_status TEXT,
    representative_claim TEXT,
    bucket_exhaustion_json TEXT NOT NULL DEFAULT '{}',
    observed_at INTEGER,
    held_until INTEGER,
    error TEXT
  )`,
];
