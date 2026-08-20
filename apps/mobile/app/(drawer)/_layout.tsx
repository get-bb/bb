import { Drawer } from "expo-router/drawer";
import { useProfiles } from "@/app-shell";
import { DrawerContent } from "@/screens";
import { useTheme } from "@/theme";

export default function DrawerLayout() {
  const { tokens, fonts } = useTheme();
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
