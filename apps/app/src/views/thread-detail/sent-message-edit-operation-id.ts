import { nanoid } from "nanoid";

export function createSentMessageEditOperationId(): string {
  return nanoid();
}
