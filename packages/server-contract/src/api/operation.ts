import { z } from "zod";

export const operationProgressSchema = z.enum(["complete", "in-progress"]);
export type OperationProgress = z.infer<typeof operationProgressSchema>;

export const operationResponseSchema = z
  .object({
    ok: z.literal(true),
    progress: operationProgressSchema,
  })
  .strict();
export type OperationResponse = z.infer<typeof operationResponseSchema>;

type FailureValue =
  | "failed"
  | "error"
  | "rolled-back"
  | "partial"
  | "cancelled"
  | "timed-out";

type Deeper<Depth extends readonly unknown[]> = [...Depth, unknown];

type FieldCarriesFailure<
  Key,
  Value,
  Depth extends readonly unknown[],
> = Key extends "ok" | "success"
  ? false extends Value
    ? true
    : false
  : Key extends "outcome" | "state" | "result"
    ? [Extract<Value, FailureValue>] extends [never]
      ? false
      : true
    : Key extends "error" | "errorMessage" | "failure"
      ? true
      : Key extends "results" | "items" | "entries"
        ? CarriesFailureState<Value, Deeper<Depth>>
        : false;

export type CarriesFailureState<
  T,
  Depth extends readonly unknown[] = [],
> = Depth["length"] extends 3
  ? false
  : T extends readonly (infer Item)[]
    ? CarriesFailureState<Item, Deeper<Depth>>
    : T extends object
      ? {
          [Key in keyof T]-?: FieldCarriesFailure<Key, T[Key], Depth>;
        }[keyof T]
      : false;
