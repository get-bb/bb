import type { NativeStackNavigationOptions } from "expo-router";

/**
 * Options for list-style routes (home, settings home, servers, machines,
 * plugins, skills, archived…): an iOS large title that collapses into the
 * compact bar as the list scrolls. The screen's first scrollable child must
 * set `contentInsetAdjustmentBehavior="automatic"`, or the title never
 * collapses. Android keeps the inline title. Colors come from the
 * navigator's global `headerLargeTitleStyle`.
 */
export const LIST_SCREEN_OPTIONS = {
  headerLargeTitleEnabled: true,
  headerLargeTitleShadowVisible: false,
} as const satisfies NativeStackNavigationOptions;

/**
 * Create / enroll flows slide up as a modal card. The screens supply their
 * own Cancel / primary toolbar buttons; the card is also swipe-dismissable.
 */
export const MODAL_SCREEN_OPTIONS = {
  presentation: "modal",
} as const satisfies NativeStackNavigationOptions;
