import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { buildStorageBreadcrumbs } from "@/data/files";
import { useTheme } from "@/theme";
import { Icon, Text } from "@/ui";

/** Crumb capsule height. */
const CRUMB_HEIGHT = 28;

/**
 * Breadcrumb strip: root › dir › dir as capsule chips, the last (current)
 * crumb filled, the others tinted and tappable.
 */
export function StorageBreadcrumbs({
  directoryPath,
  onNavigate,
}: {
  directoryPath: string;
  onNavigate: (directoryPath: string) => void;
}) {
  const { tokens } = useTheme();
  const crumbs = buildStorageBreadcrumbs(directoryPath);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.strip}
      testID="storage-breadcrumbs"
    >
      {crumbs.map((crumb, index) => {
        const current = index === crumbs.length - 1;
        return (
          <View key={crumb.path} className="flex-row items-center gap-1">
            {index > 0 ? (
              <Icon
                name="ChevronRight"
                size={11}
                weight="semibold"
                color={tokens.subtleForeground}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: current }}
              disabled={current}
              onPress={() => onNavigate(crumb.path)}
              hitSlop={4}
              style={({ pressed }) => [
                styles.crumb,
                {
                  backgroundColor: current ? tokens.secondary : "transparent",
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
              testID={`storage-crumb-${index}`}
            >
              <Text
                variant="footnote"
                weight={current ? "semibold" : "medium"}
                tone={current ? "foreground" : "primary"}
                numberOfLines={1}
              >
                {crumb.label}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 4,
  },
  crumb: {
    height: CRUMB_HEIGHT,
    paddingHorizontal: 12,
    borderRadius: CRUMB_HEIGHT / 2,
    borderCurve: "continuous",
    justifyContent: "center",
  },
});
