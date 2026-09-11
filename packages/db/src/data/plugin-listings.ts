import { and, eq, isNull } from "drizzle-orm";
import {
  pluginListingNoticeSchema,
  pluginListingRecordSchema,
  type PluginListingNotice,
  type PluginListingRecord,
} from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { pluginListingNotices, pluginListings } from "../schema.js";

export function getPluginListing(
  db: DbConnection,
  pluginId: string,
): PluginListingRecord | undefined {
  const row = db
    .select({ json: pluginListings.recordJson })
    .from(pluginListings)
    .where(eq(pluginListings.pluginId, pluginId))
    .get();
  return row === undefined
    ? undefined
    : pluginListingRecordSchema.parse(JSON.parse(row.json));
}

export function listPluginListings(db: DbConnection): PluginListingRecord[] {
  return db
    .select({ json: pluginListings.recordJson })
    .from(pluginListings)
    .orderBy(pluginListings.createdAt, pluginListings.pluginId)
    .all()
    .map((row) => pluginListingRecordSchema.parse(JSON.parse(row.json)));
}

export function listInReviewPluginListings(
  db: DbConnection,
): PluginListingRecord[] {
  return db
    .select({ json: pluginListings.recordJson })
    .from(pluginListings)
    .where(eq(pluginListings.status, "in-review"))
    .all()
    .map((row) => pluginListingRecordSchema.parse(JSON.parse(row.json)));
}

interface WritePluginListingArgs {
  db: DbConnection;
  current: PluginListingRecord | undefined;
  record: PluginListingRecord;
  notice: PluginListingNotice | null;
  at: number;
}

export function writePluginListing(args: WritePluginListingArgs): boolean {
  const record = pluginListingRecordSchema.parse(args.record);
  return args.db.transaction((tx) => {
    const values = {
      pluginId: record.pluginId,
      status: record.lifecycle.status,
      recordJson: JSON.stringify(record),
      updatedAt: args.at,
    };
    const result =
      args.current === undefined
        ? tx
            .insert(pluginListings)
            .values({ ...values, createdAt: args.at })
            .onConflictDoNothing()
            .run()
        : tx
            .update(pluginListings)
            .set(values)
            .where(
              and(
                eq(pluginListings.pluginId, record.pluginId),
                eq(pluginListings.recordJson, JSON.stringify(args.current)),
              ),
            )
            .run();
    if (result.changes === 0) return false;
    if (args.notice !== null) {
      const notice = pluginListingNoticeSchema.parse(args.notice);
      tx.insert(pluginListingNotices)
        .values({
          id: notice.id,
          noticeJson: JSON.stringify(notice),
          createdAt: notice.createdAt,
          consumedAt: null,
        })
        .onConflictDoNothing()
        .run();
    }
    return true;
  });
}

export function listPluginListingNotices(
  db: DbConnection,
): PluginListingNotice[] {
  return db
    .select({ json: pluginListingNotices.noticeJson })
    .from(pluginListingNotices)
    .where(isNull(pluginListingNotices.consumedAt))
    .orderBy(pluginListingNotices.createdAt, pluginListingNotices.id)
    .all()
    .map((row) => pluginListingNoticeSchema.parse(JSON.parse(row.json)));
}

export function consumePluginListingNotice(
  db: DbConnection,
  noticeId: string,
  at: number,
): boolean {
  return (
    db
      .update(pluginListingNotices)
      .set({ consumedAt: at })
      .where(
        and(
          eq(pluginListingNotices.id, noticeId),
          isNull(pluginListingNotices.consumedAt),
        ),
      )
      .run().changes > 0
  );
}
