// Producer event id minting shared by the daemon's durable event spools (the
// thread event buffer and the workflow run event buffer). One id per spooled
// event, generated daemon-side, carried to the server for at-least-once
// idempotency (`events.producer_event_id` / `workflow_run_events` unique
// re-ack discipline).

import { randomBytes } from "node:crypto";
import {
  hostDaemonProducerEventIdSchema,
  type HostDaemonProducerEventId,
} from "@bb/domain";

const PRODUCER_EVENT_ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";

export function createHostDaemonProducerEventId(): HostDaemonProducerEventId {
  const bytes = randomBytes(20);
  let suffix = "";
  for (const byte of bytes) {
    suffix += PRODUCER_EVENT_ID_ALPHABET.charAt(
      byte % PRODUCER_EVENT_ID_ALPHABET.length,
    );
  }
  return hostDaemonProducerEventIdSchema.parse(`hdevt_${suffix}`);
}
