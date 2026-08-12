import type { PolicyDecision, Principal } from "@bb/domain";

export type RoomJsonPrimitive = string | number | boolean | null;
export type RoomJsonValue =
  | RoomJsonPrimitive
  | RoomJsonValue[]
  | { readonly [key: string]: RoomJsonValue };
export type RoomJsonObject = { readonly [key: string]: RoomJsonValue };

export type RoomDistributionContextV1 = Readonly<{
  bindingId: string;
  principal: Principal;
  authorize(
    operation:
      | "bootstrap"
      | "commands"
      | "events"
      | "subscribe"
      | "reauthorize",
  ): Promise<PolicyDecision>;
}>;

export type RoomDistributionCommandResultV1 = Readonly<{
  status: 200 | 202;
  body: RoomJsonObject;
}>;

export type RoomDistributionSubscriptionV1 = Readonly<{
  close(): void;
}>;

export type RoomDistributionStreamTargetV1 = Readonly<{
  /** Null selects the Room's primary thread. Child ids are opaque WT attachment ids. */
  childAttachmentId: string | null;
  cursor: string | null;
}>;

export type RoomDistributionOlderTimelineTargetV1 = Readonly<{
  /** Public sequence-only cursor `p.<positive sequence>`. */
  before: string;
}>;

/**
 * Deep, binding-scoped Room interface consumed by the transport adapter.
 * Implementations own binding resolution and DTO validation; transport code
 * never calls or proxies BB's public/operator routes.
 */
export interface WorkTogetherRoomDistributionV1 {
  bootstrap(context: RoomDistributionContextV1): Promise<RoomJsonObject>;
  execute(
    context: RoomDistributionContextV1,
    command: RoomJsonObject,
  ): Promise<RoomDistributionCommandResultV1>;
  events(
    context: RoomDistributionContextV1,
    target: RoomDistributionStreamTargetV1,
  ): Promise<RoomJsonObject>;
  /**
   * Authorized older timeline page before a public sequence-only cursor.
   * Distinct from live events high-water semantics (`s.N`).
   */
  timeline(
    context: RoomDistributionContextV1,
    target: RoomDistributionOlderTimelineTargetV1,
  ): Promise<RoomJsonObject>;
  subscribe(
    context: RoomDistributionContextV1,
    target: RoomDistributionStreamTargetV1,
    emit: (event: RoomJsonObject) => void,
  ): Promise<RoomDistributionSubscriptionV1>;
}

export class RoomDistributionUnavailableError extends Error {
  constructor(readonly kind: "not_found" | "unavailable") {
    super("Room distribution unavailable");
    this.name = "RoomDistributionUnavailableError";
  }
}
