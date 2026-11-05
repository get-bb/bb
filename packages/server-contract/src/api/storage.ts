import { z } from "zod";

const nonnegativeIntegerSchema = z.number().int().nonnegative();

export const storageDatabaseFileSchema = z.object({
  path: z.string(),
  fileBytes: nonnegativeIntegerSchema,
  walBytes: nonnegativeIntegerSchema,
  pageSize: nonnegativeIntegerSchema,
  pageCount: nonnegativeIntegerSchema,
  freelistPages: nonnegativeIntegerSchema,
  reclaimableBytes: nonnegativeIntegerSchema,
  autoVacuum: z.enum(["none", "full", "incremental"]),
});
export type StorageDatabaseFile = z.infer<typeof storageDatabaseFileSchema>;

export const storageThreadHistoryRowsSchema = z.object({
  threads: nonnegativeIntegerSchema,
  events: nonnegativeIntegerSchema,
  searchSegments: nonnegativeIntegerSchema,
});
export type StorageThreadHistoryRows = z.infer<
  typeof storageThreadHistoryRowsSchema
>;

export const storageDatabaseResponseSchema = z.object({
  measuredAt: z.number().int(),
  database: storageDatabaseFileSchema,
  history: z.object({
    active: storageThreadHistoryRowsSchema,
    archived: storageThreadHistoryRowsSchema,
    deleted: storageThreadHistoryRowsSchema,
  }),
});
export type StorageDatabaseResponse = z.infer<
  typeof storageDatabaseResponseSchema
>;
