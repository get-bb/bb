import { Pressable, ScrollView, View } from "react-native";
import { buildStorageBreadcrumbs } from "@/data/files";
import { useTheme } from "@/theme";
import { Icon, Text } from "@/ui";

/** Breadcrumb strip: root › dir › dir, the last crumb current. */
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
      contentContainerStyle={{
        alignItems: "center",
        paddingHorizontal: 16,
        gap: 2,
      }}
      testID="storage-breadcrumbs"
    >
      {crumbs.map((crumb, index) => {
        const current = index === crumbs.length - 1;
        return (
          <View key={crumb.path} className="flex-row items-center gap-1">
            {index > 0 ? (
              <Icon
                name="ChevronRight"
                size={14}
                color={tokens.mutedForeground}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={current}
              onPress={() => onNavigate(crumb.path)}
              className="rounded-sm px-1 py-1 active:bg-state-hover"
              testID={`storage-crumb-${index}`}
            >
              <Text
                variant="chrome"
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
