import { View } from "react-native";
import { Text } from "@/ui";
import type { TimelineRowRendererProps } from "../../renderers";
import { answeredQuestionEntries } from "./work-row-model";
import { WorkRowShell } from "./WorkRowShell";

/**
 * `work:question` (ask-user): read-only. Pending / interrupted rows are fully
 * described by their title; once an answer is recorded (resolving /
 * answered) the body lists each prompt with the chosen options and free
 * text, or "No answer" (web `QuestionWorkRowBody`).
 */
export function QuestionWorkRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<"work:question">) {
  const entries = answeredQuestionEntries(item.row);
  return (
    <WorkRowShell
      item={item}
      expandable={item.expandable && entries !== null}
      expanded={expanded}
      onToggle={onToggle}
    >
      {entries ? (
        <View className="gap-3 pl-5" testID="timeline-question-answers">
          {entries.map((entry) => {
            const hasContent =
              entry.selectedLabels.length > 0 || entry.freeText !== null;
            return (
              <View key={entry.id}>
                {/* Tiers by color, not weight: the prompt recedes to
                    subtle-foreground while the answer stays foreground. */}
                <Text variant="caption" tone="subtle">
                  {entry.prompt}
                </Text>
                {hasContent ? (
                  <View className="pt-0.5">
                    {entry.selectedLabels.length > 0 ? (
                      <Text className="text-xs">
                        {entry.selectedLabels.join(", ")}
                      </Text>
                    ) : null}
                    {entry.freeText ? (
                      <Text className="text-xs">{entry.freeText}</Text>
                    ) : null}
                  </View>
                ) : (
                  <Text variant="caption" tone="subtle" className="pt-0.5">
                    No answer
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      ) : null}
    </WorkRowShell>
  );
}
