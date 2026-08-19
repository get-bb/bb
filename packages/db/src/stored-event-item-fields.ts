import type {
  ThreadEvent,
  ThreadEventItemType,
  ThreadEventType,
} from "@bb/domain";

export interface StoredEventItemFields {
  itemId: string | null;
  itemKind: ThreadEventItemType | null;
  parentToolCallId: string | null;
}

interface StoredEventItemIdentity {
  id: string;
  parentToolCallId?: string;
  type: ThreadEventItemType;
}

export interface StoredEventItemFieldSource {
  item?: StoredEventItemIdentity;
  itemId?: string;
  parentToolCallId?: string;
  type: ThreadEventType;
}

type StoredEventOwnItemFields = Omit<StoredEventItemFields, "parentToolCallId">;

function fromItem(args: StoredEventItemIdentity): StoredEventOwnItemFields {
  return {
    itemId: args.id,
    itemKind: args.type,
  };
}

function fromItemId(itemId: string | undefined): StoredEventOwnItemFields {
  return {
    itemId: itemId ?? null,
    itemKind: null,
  };
}

export function deriveStoredEventItemFieldsFromSource(
  source: StoredEventItemFieldSource,
): StoredEventItemFields {
  const ownItemFields: StoredEventOwnItemFields = (() => {
    switch (source.type) {
      case "item/started":
      case "item/completed":
      case "item/backgroundTask/progress":
      case "item/backgroundTask/completed":
        if (!source.item) {
          throw new Error(`Missing item payload for ${source.type}`);
        }
        return fromItem(source.item);
      case "item/agentMessage/delta":
      case "item/commandExecution/outputDelta":
      case "item/fileChange/outputDelta":
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta":
      case "item/plan/delta":
      case "item/mcpToolCall/progress":
      case "item/toolCall/progress":
        return fromItemId(source.itemId);
      default:
        return {
          itemId: null,
          itemKind: null,
        };
    }
  })();
  const parentToolCallId =
    source.item?.parentToolCallId ?? source.parentToolCallId;
  return {
    ...ownItemFields,
    parentToolCallId:
      parentToolCallId !== undefined && parentToolCallId.length > 0
        ? parentToolCallId
        : null,
  };
}

export function deriveStoredEventItemFields(
  event: ThreadEvent,
): StoredEventItemFields {
  return deriveStoredEventItemFieldsFromSource({
    type: event.type,
    item: "item" in event ? event.item : undefined,
    itemId: "itemId" in event ? event.itemId : undefined,
    parentToolCallId:
      "parentToolCallId" in event ? event.parentToolCallId : undefined,
  });
}
