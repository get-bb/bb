import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
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

export const profile = sqliteTable("profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  handle: text("handle").notNull().unique(),
  createdAt: timestampMs("created_at").notNull(),
});

const labelClaimKinds = ["handle", "server", "machine"] as const;

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

export const server = sqliteTable(
  "server",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("default"),
    subdomain: text("subdomain").notNull().unique(),
    credentialHash: text("credential_hash"),
    version: text("version"),
    lastSeenAt: timestampMs("last_seen_at"),
    createdAt: timestampMs("created_at").notNull(),
    revokedAt: timestampMs("revoked_at"),
  },
  (table) => [uniqueIndex("server_user_name_idx").on(table.userId, table.name)],
);

export const connectCode = sqliteTable(
  "connect_code",
  {
    code: text("code").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    serverId: text("server_id").references(() => server.id, {
      onDelete: "cascade",
    }),
    purpose: text("purpose").notNull(),
    deviceCodeHash: text("device_code_hash"),
    clientName: text("client_name"),
    polledAt: timestampMs("polled_at"),
    approvedAt: timestampMs("approved_at"),
    deniedAt: timestampMs("denied_at"),
    expiresAt: timestampMs("expires_at").notNull(),
    consumedAt: timestampMs("consumed_at"),
    createdAt: timestampMs("created_at").notNull(),
  },
  (table) => [
    index("connect_code_user_id_idx").on(table.userId),
    uniqueIndex("connect_code_device_code_hash_idx").on(table.deviceCodeHash),
  ],
);

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

export const aiUsageDay = sqliteTable(
  "ai_usage_day",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    spentMicros: integer("spent_micros").notNull().default(0),
    reservedMicros: integer("reserved_micros").notNull().default(0),
    requests: integer("requests").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.day] }),
    index("ai_usage_day_day_idx").on(table.day),
  ],
);

export const aiRequestOutcomes = [
  "ok",
  "invalid_request",
  "budget_exhausted",
  "rate_limited",
  "unavailable",
  "upstream_error",
  "timeout",
] as const;

export type AiRequestOutcome = (typeof aiRequestOutcomes)[number];

export const aiRequestLog = sqliteTable(
  "ai_request_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    serverId: text("server_id").references(() => server.id, {
      onDelete: "set null",
    }),
    model: text("model"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    costMicros: integer("cost_micros").notNull().default(0),
    latencyMs: integer("latency_ms").notNull(),
    outcome: text("outcome", { enum: aiRequestOutcomes }).notNull(),
    createdAt: timestampMs("created_at").notNull(),
  },
  (table) => [
    index("ai_request_log_created_at_idx").on(table.createdAt),
    index("ai_request_log_user_created_at_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

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
  aiUsageDay,
  aiRequestLog,
};
