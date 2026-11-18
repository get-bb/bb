import "./src/notifications/dismiss-read-threads-task";
import "expo-router/entry";
import { AppRegistry } from "react-native";
import { WidgetConfiguration } from "./src/widgets/WidgetConfiguration";

if (process.env.EXPO_OS === "android") {
  AppRegistry.registerComponent(
    "BBProjectWidgetConfiguration",
    () => WidgetConfiguration,
  );
}
