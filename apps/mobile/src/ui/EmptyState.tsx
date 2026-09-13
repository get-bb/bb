import type { ReactNode } from "react";
import { View } from "react-native";

export interface EmptyStatePanelProps {
  children: ReactNode;
}

export function EmptyStatePanel({ children }: EmptyStatePanelProps) {
  return (
    <View className="items-center rounded-md border border-dashed border-border px-3 py-6">
      {children}
    </View>
  );
}
