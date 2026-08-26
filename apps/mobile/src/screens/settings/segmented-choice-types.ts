// Shared by SegmentedChoice.tsx (Android / default) and SegmentedChoice.ios.tsx;
// a separate module because "./SegmentedChoice" resolves to the .ios sibling on iOS.

export interface SegmentedChoiceOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedChoiceProps<T extends string> {
  options: readonly SegmentedChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** The control's id (iOS: the whole segmented control). */
  testID?: string;
  /** Android per-option ids: `${testIDPrefix}-${value}`. */
  testIDPrefix?: string;
}
