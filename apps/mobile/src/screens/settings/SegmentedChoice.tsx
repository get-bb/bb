import { View } from "react-native";
import { Button } from "@/ui";
import type { SegmentedChoiceProps } from "./segmented-choice-types";

/**
 * A small single-choice control. Android / default: a row of compact
 * buttons (`SegmentedChoice.ios.tsx` renders the native segmented control).
 */
export function SegmentedChoice<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  testID,
  testIDPrefix,
}: SegmentedChoiceProps<T>) {
  const prefix = testIDPrefix ?? testID;
  return (
    <View className="flex-row flex-wrap gap-2" testID={testID}>
      {options.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant={option.value === value ? "default" : "outline"}
          disabled={disabled}
          onPress={() => onChange(option.value)}
          testID={prefix ? `${prefix}-${option.value}` : undefined}
        >
          {option.label}
        </Button>
      ))}
    </View>
  );
}

export type {
  SegmentedChoiceOption,
  SegmentedChoiceProps,
} from "./segmented-choice-types";
