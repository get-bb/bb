import type { JsonRpcMessage } from "./runtime-json-rpc.js";

export type ProviderRawEventCoverage = "normalized" | "noise" | "unknown";

export interface ProviderRawEventDescription {
  kind: string;
  coverage: ProviderRawEventCoverage;
}

export interface ProviderParsedRawEvent {
  kind: string;
}

export interface ProviderVisibilityMetadata<
  TRawEvent extends ProviderParsedRawEvent = ProviderParsedRawEvent,
> {
  parseRawEvent(event: JsonRpcMessage): TRawEvent;
  describeParsedRawEvent(event: TRawEvent): ProviderRawEventDescription;
  describeRawEvent(event: JsonRpcMessage): ProviderRawEventDescription;
}

export interface CreateProviderVisibilityMetadataArgs<
  TRawEvent extends ProviderParsedRawEvent,
> {
  parseRawEvent(event: JsonRpcMessage): TRawEvent;
  describeParsedRawEvent(event: TRawEvent): ProviderRawEventDescription;
}

export function createProviderVisibilityMetadata<
  TRawEvent extends ProviderParsedRawEvent,
>(
  args: CreateProviderVisibilityMetadataArgs<TRawEvent>,
): ProviderVisibilityMetadata<TRawEvent> {
  return {
    parseRawEvent: args.parseRawEvent,
    describeParsedRawEvent: args.describeParsedRawEvent,
    describeRawEvent(event) {
      return args.describeParsedRawEvent(args.parseRawEvent(event));
    },
  };
}
