// bb connect cloud schema (Cloudflare D1, SQLite dialect).
//
// Two groups of tables:
//   1. better-auth core tables (user/session/account/verification) — shaped to
//      better-auth's default drizzle sqlite schema so the drizzle adapter binds
//      to them in M1. Do not rename columns without regenerating auth config.
//   2. bb-connect product tables (profile/server/connect_code).
//
// The cloud stores identity + routing ONLY — never threads, code, or terminal
// output. If a column here would hold product data, it is in the wrong
// database.

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });

// ── better-auth core ────────────────────────────────────────────────────────

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  // GitHub username, refreshed from the OAuth profile on every sign-in.
  // Null only for rows predating the column.
  githubLogin: text("github_login"),
  createdAt: timestampMs("created_at").notNull(),
  updatedAt: timestampMs("updated_at").notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    expiresAt: timestampMs("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestampMs("created_at").notNull(),
    updatedAt: timestampMs("updated_at").notNull(),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestampMs("access_token_expires_at"),
    refreshTokenExpiresAt: timestampMs("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestampMs("created_at").notNull(),
    updatedAt: timestampMs("updated_at").notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestampMs("expires_at").notNull(),
    createdAt: timestampMs("created_at").notNull(),
    updatedAt: timestampMs("updated_at").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// ── bb-connect product tables ───────────────────────────────────────────────

/**
 * One profile per user: the claimed handle that becomes `<handle>.getbb.app`.
 * Separate from `user` so better-auth's generated table stays untouched.
 */
export const profile = sqliteTable("profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  handle: text("handle").notNull().unique(),
  createdAt: timestampMs("created_at").notNull(),
});

export const labelClaimKinds = ["handle", "server", "machine"] as const;
export type LabelClaimKind = (typeof labelClaimKinds)[number];

/**
 * The authoritative global routing-label namespace. Product rows retain their
 * denormalized handle/subdomain for direct reads. Migration-owned triggers
 * insert/delete the claim in the same statement as each source mutation, so
 * the primary key is an atomic cross-namespace constraint even for old workers.
 * `generation` changes when a claim changes owners; machine routing uses it to
 * isolate TunnelDO and cache state. Server routing remains unchanged from main.
 */
export const labelClaim = sqliteTable(
  "label_claim",
  {
    label: text("label").primaryKey(),
    kind: text("kind", { enum: labelClaimKinds }).notNull(),
    ownerId: text("owner_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    generation: text("generation").notNull(),
    createdAt: timestampMs("created_at").notNull(),
  },
  (table) => [index("label_claim_user_id_idx").on(table.userId)],
);

/**
 * A connected bb server (the machine running the tunnel client). An account may
 * own up to `MAX_PER_ACCOUNT` servers; each owns a globally-unique
 * `subdomain` label in the SAME public namespace as `profile.handle`
 * (`<subdomain>.getbb.app`). The account's `profile.handle` names the
 * primary/first server (its subdomain is backfilled to the handle); additional
 * servers claim their own free labels (e.g. `sawyerhood-desktop`).
 *
 * `subdomain` uses the exact handle grammar (see `validateLabel`) — reserved
 * words and the `--` share separator are rejected — and is unique across
 * `server.subdomain`, `machine.subdomain`, and `profile.handle` (see
 * `checkLabelAvailability`).
 *
 * `credentialHash` is a hash of the durable tunnel credential — the plaintext
 * lives only on the user's machine. `lastSeenAt` is bumped by tunnel
 * heartbeats; null means never-connected.
 */
export const server = sqliteTable(
  "server",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("default"),
    // Globally-unique routing label (`<subdomain>.getbb.app`). Backfilled to the
    // owner's handle for pre-multi-server rows; see migration 0003.
    subdomain: text("subdomain").notNull().unique(),
    credentialHash: text("credential_hash"),
    version: text("version"),
    lastSeenAt: timestampMs("last_seen_at"),
    createdAt: timestampMs("created_at").notNull(),
    revokedAt: timestampMs("revoked_at"),
  },
  (table) => [uniqueIndex("server_user_name_idx").on(table.userId, table.name)],
);

/**
 * One-time codes exchanged during pairing.
 *   - `server-pair`: browser-approval flow mints this; the tunnel client
 *     exchanges it for the durable credential (binds to a server row).
 *   - `manual-pair`: headless fallback shown in the dashboard for `bb connect
 *     --code`.
 * Consumed exactly once; `consumedAt` set on redemption. Expired/consumed rows
 * are swept, not reused.
 */
export const connectCode = sqliteTable(
  "connect_code",
  {
    code: text("code").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    serverId: text("server_id").references(() => server.id, {
      onDelete: "cascade",
    }),
    purpose: text("purpose").notNull(),
    expiresAt: timestampMs("expires_at").notNull(),
    consumedAt: timestampMs("consumed_at"),
    createdAt: timestampMs("created_at").notNull(),
  },
  (table) => [index("connect_code_user_id_idx").on(table.userId)],
);

/**
 * A machine (execution host) the owner connects to their server through the
 * tunnel. Distinct from `server`: the server is the bb server behind the tunnel;
 * a machine is a bb host-daemon on another computer that reaches that server via
 * the tunnel, authenticated to the gate by `credentialHash`. The daemon also
 * carries its own bb host key for the server's auth — this credential only
 * authorizes it to traverse the gate's `/internal/*` path. `subdomain` is a
 * nullable routing label assigned lazily for machine-direct port shares. It
 * uses the same global label namespace and grammar as servers and handles.
 */
export const machine = sqliteTable(
  "machine",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name"),
    subdomain: text("subdomain").unique(),
    credentialHash: text("credential_hash").notNull(),
    lastSeenAt: timestampMs("last_seen_at"),
    createdAt: timestampMs("created_at").notNull(),
    revokedAt: timestampMs("revoked_at"),
  },
  (table) => [index("machine_user_id_idx").on(table.userId)],
);

/** Append-only audit of security-relevant events (connect, revoke, pair). */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    detail: text("detail"),
    ipAddress: text("ip_address"),
    createdAt: timestampMs("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("audit_log_user_id_idx").on(table.userId)],
);

export const connectCodePurposes = [
  "server-pair",
  "manual-pair",
  "machine-pair",
] as const;
export type ConnectCodePurpose = (typeof connectCodePurposes)[number];

export const schema = {
  user,
  session,
  account,
  verification,
  profile,
  labelClaim,
  server,
  machine,
  connectCode,
  auditLog,
};
