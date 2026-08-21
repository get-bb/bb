# bb mobile design system (`src/ui`, `src/theme`)

NativeWind v5 (Tailwind v4) primitives that mirror `@bb/shared-ui`'s variant
names, driven by the tokens generated from the web app's `theme.css`. Import
from `@/ui` and `@/theme`.

## Wiring (once, in `app/_layout.tsx`)

```tsx
import "../global.css";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAppFonts } from "@/theme/useAppFonts"; // module keeps the splash up until the layout hides it
import { ThemeProvider } from "@/theme";
import { SheetProvider, Toaster } from "@/ui";

export default function RootLayout() {
  const { ready } = useAppFonts(); // true once Inter/Fira Code load
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  if (!ready) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider
          palette={
            paletteFromServerConfig /* BuiltInThemeId, default "default" */
          }
        >
          <SheetProvider>
            <Stack />
            <Toaster />
          </SheetProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

`SheetProvider` is the `BottomSheetModalProvider` host; `Toaster` must sit
inside it.

## Theme

- `useTheme()` → `{ palette, mode, preference, tokens, radii, typography, fonts, setMode }`.
  - `tokens` is `NativeThemeTokens` (camelCase, e.g. `tokens.mutedForeground`),
    the palette × mode slice of the generated `theme.native.ts`.
  - `setMode("system" | "light" | "dark")` persists to MMKV key `bb.theme`
    (same key/values as the web app) and also forces RN's `Appearance` so
    native surfaces follow.
- Utility classes: every web `--color-*` token exists here with the same name
  (`bg-background`, `text-foreground`, `border-border`, `bg-sidebar-accent`,
  `text-destructive-text`, `bg-surface-selected`, …), plus opacity modifiers
  (`bg-foreground/90`) and `active:` / `focus:` (Pressable / TextInput) in
  place of web `hover:` / `focus-visible:`. Radii: `rounded-sm|md|lg|xl` =
  4/6/8/12. Type scale: `text-2xs|xs|sm|base` = 11/14/15/16 (touch values).
- Fonts: `<Text>` sets `fontFamily` + `fontWeight` from `weight`/`mono` or
  from `font-medium|semibold|bold|mono` classes (Expo Google Fonts register
  one family per weight). Outside `<Text>` use `font-sans-medium`,
  `font-mono-semibold`, … or `theme.fonts.sans.medium` with a matching
  `fontWeight`.
- Do not use `leading-*` utilities (NativeWind emits em multipliers); the
  `text-*` sizes already carry the web line heights.
- `dark:` variants are unnecessary — swap happens through variables.

## Primitives

| Component                        | Props (beyond RN passthrough)                                                                                                                                                                                                                            | Notes                                                                                                                                                                                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------- | ------------------------------------------------------------------- | ---------------------- |
| `Text`                           | `variant` body·bodyLarge·title·heading·label·caption·sectionLabel·chrome·mono; `tone` default·foreground·muted·subtle·readback·primary·destructive·warning·success·inverse; `weight`; `mono`; `className`                                                | Themed RN Text.                                                                                                                                                                                                                           |
| `Button`                         | `variant` default·secondary·outline·ghost·destructive·link; `size` sm·default·lg·icon; `icon` (IconName), `iconPosition`; `loading`; `pressed` (toggle); `haptic` (`true`/light/medium/heavy/selection); `onPress`; string or node children; `className` | Heights 36/40/48, icon 40×40.                                                                                                                                                                                                             |
| `Badge`                          | `variant` default·secondary·destructive·outline                                                                                                                                                                                                          |                                                                                                                                                                                                                                           |
| `Pill`                           | `variant` secondary·destructive·outline·emphasis; `size` default·sm                                                                                                                                                                                      | Truncates one line.                                                                                                                                                                                                                       |
| `Input`                          | `invalid`, `mono`, all `TextInputProps`                                                                                                                                                                                                                  | h-10, focus ring via `focus:border-ring`.                                                                                                                                                                                                 |
| `TextArea`                       | `invalid`, `mono`                                                                                                                                                                                                                                        | multiline, min-h 60.                                                                                                                                                                                                                      |
| `Switch`                         | `checked`, `onCheckedChange`, `size` default·sm, `disabled`                                                                                                                                                                                              | Native switch, token colors.                                                                                                                                                                                                              |
| `Skeleton`                       | `className` (size it)                                                                                                                                                                                                                                    | Reanimated pulse.                                                                                                                                                                                                                         |
| `Spinner`                        | `size`, `color`                                                                                                                                                                                                                                          | ActivityIndicator.                                                                                                                                                                                                                        |
| `EmptyState` / `EmptyStatePanel` | `message`, `icon` / children                                                                                                                                                                                                                             | Inline hint / dashed panel.                                                                                                                                                                                                               |
| `ListRow`                        | `title`, `subtitle`, `leading` (IconName or node), `trailing` (`"chevron"` or node), `onPress`, `onLongPress`, `selected`, `destructive`, `disabled`, `titleLines`                                                                                       | 44px min touch row.                                                                                                                                                                                                                       |
| `Separator`                      | `orientation`, `inset`                                                                                                                                                                                                                                   | 1px `bg-border`.                                                                                                                                                                                                                          |
| `Icon`                           | `name` (IconName), `size` (default 20), `color` (default foreground token), `strokeWidth` (1.75), `accessibilityLabel`                                                                                                                                   | Same names/glyphs as shared-ui `ICON_MAP`; `isIconName()` guard.                                                                                                                                                                          |
| `Sheet`                          | `controller` (from `useSheet()`); `title`, `layout` view·scroll·custom, `snapPoints`, `enableDynamicSizing`, `maxDynamicContentSize`, `onDismiss`, `onOpenChange`, `deferContent`                                                                        | @gorhom/bottom-sheet modal; children realized two frames after present, retained afterwards. `useSheet()` → `SheetController {present, dismiss}` (stable; call from handlers). Also `SheetScrollView`, `SheetFlatList`, `SheetTextInput`. |
| `ActionSheet`                    | `controller`; `title`, `message`, `actions: {key,label,icon?,destructive?,disabled?,onPress}[]`                                                                                                                                                          | Long-press menus: `const menu = useSheet(); <ActionSheet controller={menu} …/>; onLongPress={menu.present}`.                                                                                                                              |
| `toast` / `Toaster`              | `toast.success                                                                                                                                                                                                                                           | error                                                                                                                                                                                                                                     | info | warning | message(msg, {description, duration, action})`, `toast.dismiss(id)` | sonner-native, themed. |

Gallery: `app/dev/ui.tsx` renders everything (route `/dev/ui`).
