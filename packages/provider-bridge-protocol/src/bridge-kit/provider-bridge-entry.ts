import { z } from "zod";

export const PROVIDER_BRIDGE_EXPORT_NAME = "experimental_providerBridge";

export interface ProviderBridgeContext {
  pluginId: string;
  dataDir: string;
  tempDir: string;
}

export interface ProviderBridgeDefinition {
  handleLine: (line: string) => void;
  start?: (context: ProviderBridgeContext) => void;
  onClose?: () => void;
  onSigterm?: () => void;
  onSigint?: () => void;
}

export interface ProviderBridgeEntry extends ProviderBridgeDefinition {
  experimental_apiVersion: 1;
}

type ProviderBridgeExportFunction = (...args: never[]) => void;
type ProviderBridgeExportValue =
  | boolean
  | number
  | string
  | null
  | undefined
  | ProviderBridgeExportFunction
  | ProviderBridgeExportValue[]
  | { [key: string]: ProviderBridgeExportValue };

const providerBridgeContextSchema = z.object({
  pluginId: z.string(),
  dataDir: z.string(),
  tempDir: z.string(),
});

const providerBridgeCandidateSchema = z
  .object({
    experimental_apiVersion: z.json().optional(),
    handleLine: z
      .function({ input: [z.string()], output: z.void() })
      .optional(),
    start: z
      .function({ input: [providerBridgeContextSchema], output: z.void() })
      .optional(),
    onClose: z.function({ input: [], output: z.void() }).optional(),
    onSigterm: z.function({ input: [], output: z.void() }).optional(),
    onSigint: z.function({ input: [], output: z.void() }).optional(),
  })
  .passthrough();

const providerBridgeEntrySchema = providerBridgeCandidateSchema.extend({
  experimental_apiVersion: z.literal(1),
  handleLine: z.function({ input: [z.string()], output: z.void() }),
});

export function experimental_defineProviderBridge(
  definition: ProviderBridgeDefinition,
): ProviderBridgeEntry {
  return { experimental_apiVersion: 1, ...definition };
}

export function parseProviderBridgeEntry(
  value: ProviderBridgeExportValue,
):
  | { entry: ProviderBridgeEntry; problem: null }
  | { entry: null; problem: string } {
  const parsedCandidate = providerBridgeCandidateSchema.safeParse(value);
  if (!parsedCandidate.success) {
    return {
      entry: null,
      problem: `exports no "${PROVIDER_BRIDGE_EXPORT_NAME}"`,
    };
  }
  const candidate = parsedCandidate.data;
  if (candidate.experimental_apiVersion !== 1) {
    return {
      entry: null,
      problem: `exports "${PROVIDER_BRIDGE_EXPORT_NAME}" with unsupported apiVersion ${String(candidate.experimental_apiVersion)} (expected 1) — build it with experimental_defineProviderBridge()`,
    };
  }
  if (candidate.handleLine === undefined) {
    return {
      entry: null,
      problem: `exports "${PROVIDER_BRIDGE_EXPORT_NAME}" without a handleLine function`,
    };
  }
  const parsedEntry = providerBridgeEntrySchema.safeParse(candidate);
  if (!parsedEntry.success) {
    return {
      entry: null,
      problem: `exports "${PROVIDER_BRIDGE_EXPORT_NAME}" with an invalid definition`,
    };
  }
  return { entry: parsedEntry.data, problem: null };
}
