import { formatPendingInteractionSummary } from "@bb/core-ui";
import { useRouter } from "expo-router";
import { View } from "react-native";
import type { ChildThreadPendingAttention } from "@/data/interactions";
import { ListRow } from "@/ui";
import { threadHref } from "../../shell/hrefs";

interface ChildThreadPendingInteractionsProps {
  items: readonly ChildThreadPendingAttention[];
}

/**
 * Compact rows for children waiting on input, each opening the child thread
 * (whose own banner resolves it). The web renders the full banner inline;
 * on a phone the parent's composer area has no room for several forms.
 */
export function ChildThreadPendingInteractions({
  items,
}: ChildThreadPendingInteractionsProps) {
  const router = useRouter();
  if (items.length === 0) return null;
  return (
    <View
      className="overflow-hidden rounded-lg border border-border bg-surface-recessed"
      testID="child-thread-pending-interactions"
    >
      {items.map((item) => (
        <ListRow
          key={item.interaction.id}
          leading="CircleQuestion"
          title={item.childTitle}
          subtitle={formatPendingInteractionSummary({
            interaction: item.interaction,
            surface: "app",
          })}
          trailing="chevron"
          onPress={() => router.push(threadHref(item.childThreadId))}
          testID={`child-pending-interaction-${item.childThreadId}`}
        />
      ))}
    </View>
  );
}
