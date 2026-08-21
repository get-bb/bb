import { AppState } from "react-native";
import type { AppStateLike } from "../realtime/app-state";

/** React Native's AppState, typed against the injectable lifecycle contract. */
export const nativeAppState: AppStateLike = AppState;
