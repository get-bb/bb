import { z } from "zod";

export const CLIENT_TURN_REQUEST_ID_PREFIX = "creq_";
export const CLIENT_TURN_REQUEST_ID_SUFFIX_LENGTH = 10;
export const CLIENT_TURN_REQUEST_ID_ALPHABET =
  "23456789abcdefghijkmnpqrstuvwxyz";

export interface FormatClientTurnRequestIdSuffixArgs {
  suffix: string;
}

export interface EncodeClientTurnRequestIdAlphabetIndexesArgs {
  indexes: readonly number[];
}

export interface EncodeClientTurnRequestIdNumberArgs {
  value: number;
}

export const clientTurnRequestIdSchema = z
  .string()
  .regex(/^creq_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/u);
export type ClientTurnRequestId = z.infer<typeof clientTurnRequestIdSchema>;

export function formatClientTurnRequestIdSuffix(
  args: FormatClientTurnRequestIdSuffixArgs,
): ClientTurnRequestId {
  return clientTurnRequestIdSchema.parse(
    `${CLIENT_TURN_REQUEST_ID_PREFIX}${args.suffix}`,
  );
}

export function encodeClientTurnRequestIdAlphabetIndexes(
  args: EncodeClientTurnRequestIdAlphabetIndexesArgs,
): ClientTurnRequestId {
  if (args.indexes.length !== CLIENT_TURN_REQUEST_ID_SUFFIX_LENGTH) {
    throw new Error(
      `Client turn request id requires ${CLIENT_TURN_REQUEST_ID_SUFFIX_LENGTH} alphabet indexes`,
    );
  }

  let suffix = "";
  for (const index of args.indexes) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= CLIENT_TURN_REQUEST_ID_ALPHABET.length
    ) {
      throw new Error(`Invalid client turn request id alphabet index ${index}`);
    }
    suffix += CLIENT_TURN_REQUEST_ID_ALPHABET.charAt(index);
  }

  return formatClientTurnRequestIdSuffix({ suffix });
}

export function encodeClientTurnRequestIdNumber(
  args: EncodeClientTurnRequestIdNumberArgs,
): ClientTurnRequestId {
  if (!Number.isSafeInteger(args.value) || args.value < 0) {
    throw new Error(
      "Client turn request id number must be a safe non-negative integer",
    );
  }

  let value = args.value;
  let suffix = "";
  for (
    let index = 0;
    index < CLIENT_TURN_REQUEST_ID_SUFFIX_LENGTH;
    index += 1
  ) {
    const alphabetIndex = value % CLIENT_TURN_REQUEST_ID_ALPHABET.length;
    suffix = CLIENT_TURN_REQUEST_ID_ALPHABET.charAt(alphabetIndex) + suffix;
    value = Math.floor(value / CLIENT_TURN_REQUEST_ID_ALPHABET.length);
  }

  return formatClientTurnRequestIdSuffix({ suffix });
}
