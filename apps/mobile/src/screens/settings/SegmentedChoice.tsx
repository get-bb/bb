import { View } from "react-native";
import { Button } from "@/ui";
import type { SegmentedChoiceProps } from "./segmented-choice-types";

export function SegmentedChoice<T extends string>({
  options,
  value,
  onChange,
  testIDPrefix,
}: SegmentedChoiceProps<T>) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant={option.value === value ? "default" : "outline"}
          onPress={() => onChange(option.value)}
          testID={testIDPrefix ? `${testIDPrefix}-${option.value}` : undefined}
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
