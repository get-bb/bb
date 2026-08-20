import { Drawer } from "expo-router/drawer";
import { useProfiles } from "@/app-shell";
import { DrawerContent } from "@/screens";
import { withAlpha } from "@/markdown/colors";
import { scrimBaseColor, useTheme } from "@/theme";

export default function DrawerLayout() {
  const { tokens, fonts, mode } = useTheme();
  const { activeProfile } = useProfiles();
  return (
    <Drawer
      drawerContent={(props) => <DrawerContent {...props} />}
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: tokens.background },
        headerShadowVisible: false,
        headerTintColor: tokens.foreground,
        headerTitleStyle: {
          fontFamily: fonts.sans.semibold,
          fontWeight: "600",
          color: tokens.foreground,
        },
        drawerStyle: { backgroundColor: tokens.sidebar, width: 300 },
        drawerType: "front",
        overlayColor: withAlpha(scrimBaseColor(mode, tokens), 0.45),
        sceneStyle: { backgroundColor: tokens.background },
        swipeEdgeWidth: 48,
      }}
    >
      <Drawer.Screen
        name="index"
        options={{ title: activeProfile?.label ?? "bb", drawerLabel: "Home" }}
      />
    </Drawer>
  );
}
