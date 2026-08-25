import {
  defaultAppTheme,
  isBuiltInThemeId,
  type FaviconColorPreference,
} from "@bb/domain";
import { useMemo } from "react";
import { View } from "react-native";
import { useProfiles } from "@/app-shell";
import {
  buildPaletteOptions,
  FAVICON_COLOR_OPTIONS,
  faviconColorLabel,
  paletteLabel,
  useThemeCatalog,
  useUpdateAppearance,
} from "@/data/settings";
import { useSystemConfig } from "@/data/system";
import { useTheme, type ThemeModePreference } from "@/theme";
import { ListRow, Sheet, Text, useSheet } from "@/ui";
import {
  OptionSheet,
  usePickerSheetMaxHeight,
  type PickerOption,
} from "../pickers";
import { GroupedScreen } from "./GroupedScreen";
import { SegmentedChoice } from "./SegmentedChoice";
import { SettingsSection, SettingsValueRow } from "./SettingsRows";

const MODES: readonly { value: ThemeModePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const PALETTE_DESCRIPTION =
  "Palettes change bb's colors on every client of this server. The six built-in palettes render natively here; a custom or plugin palette shows as the default palette on mobile.";

/**
 * `/settings/appearance`: light/dark mode (device-local, `bb.theme`) as a
 * segmented control, the server-wide palette (`PUT /settings/appearance`,
 * picked from `GET /settings/themes`) and the favicon tint that rides
 * along with it.
 */
export function AppearanceSettingsScreen() {
  const { connection } = useProfiles();
  const theme = useTheme();
  return (
    <GroupedScreen testID="appearance-settings-screen">
      <SettingsSection
        title="Mode"
        footnote="Light or dark is a choice for this phone; the palette below is shared with the server."
      >
        <View className="px-4 py-3" testID="appearance-mode">
          <SegmentedChoice
            options={MODES}
            value={theme.preference}
            onChange={(mode) => theme.setMode(mode)}
            testIDPrefix="appearance-mode"
          />
        </View>
      </SettingsSection>
      {connection ? (
        <ConnectedAppearanceSections />
      ) : (
        <SettingsSection
          title="Palette"
          footnote="Add a server to choose its palette."
        >
          <SettingsValueRow label="Palette" value="Default" disabled />
        </SettingsSection>
      )}
    </GroupedScreen>
  );
}

function ConnectedAppearanceSections() {
  const configQuery = useSystemConfig();
  const catalogQuery = useThemeCatalog();
  const updateAppearance = useUpdateAppearance();
  const paletteSheet = useSheet();
  const faviconSheet = useSheet();

  const appearance = configQuery.data?.appearance ?? defaultAppTheme;
  const catalogCustom = catalogQuery.data?.custom;
  const configCustom = configQuery.data?.customThemes;
  const catalogPlugins = catalogQuery.data?.plugins;
  const configPlugins = configQuery.data?.pluginThemes;
  // The catalog is authoritative; the config's copy covers the first render.
  const customThemes = useMemo(
    () => catalogCustom ?? configCustom ?? [],
    [catalogCustom, configCustom],
  );
  const pluginThemes = useMemo(
    () => catalogPlugins ?? configPlugins ?? [],
    [catalogPlugins, configPlugins],
  );
  const options = useMemo(
    () => buildPaletteOptions({ customThemes, pluginThemes }),
    [customThemes, pluginThemes],
  );
  const paletteRows = useMemo(
    (): PickerOption<string>[] =>
      options.map((option) => ({
        value: option.id,
        label: option.label,
        description: option.description ?? undefined,
        icon: option.kind === "built-in" ? "Palette" : "Puzzle",
      })),
    [options],
  );
  const { tokens } = useTheme();
  const maxHeight = usePickerSheetMaxHeight();
  const disabled = configQuery.data === undefined || updateAppearance.isPending;
  const selectFaviconColor = (faviconColor: FaviconColorPreference) =>
    updateAppearance.mutate({ themeId: appearance.themeId, faviconColor });
  const activeLabel = paletteLabel(appearance, pluginThemes);
  const nativelyRendered = isBuiltInThemeId(appearance.themeId);

  return (
    <>
      <SettingsSection
        title="Palette"
        footnote={
          nativelyRendered ? (
            PALETTE_DESCRIPTION
          ) : (
            <Text variant="footnote" tone="warning">
              {`“${activeLabel}” is a custom palette; this phone renders the default palette while it is active. ${PALETTE_DESCRIPTION}`}
            </Text>
          )
        }
      >
        <SettingsValueRow
          label="Palette"
          value={activeLabel}
          tone={nativelyRendered ? "default" : "warning"}
          onPress={paletteSheet.present}
          disabled={disabled}
          testID="appearance-palette"
        />
        <SettingsValueRow
          label="Favicon color"
          value={faviconColorLabel(appearance.faviconColor)}
          onPress={faviconSheet.present}
          disabled={disabled}
          testID="appearance-favicon-color"
        />
      </SettingsSection>
      <OptionSheet
        controller={paletteSheet}
        title="Palette"
        options={paletteRows}
        value={appearance.themeId}
        onChange={(themeId) =>
          updateAppearance.mutate({
            themeId,
            faviconColor: appearance.faviconColor,
          })
        }
        testIDPrefix="appearance-palette-option"
      />
      <Sheet
        controller={faviconSheet}
        title="Favicon color"
        layout="scroll"
        maxDynamicContentSize={maxHeight}
      >
        <View className="px-4 pb-2">
          <Text variant="caption">
            Tints the browser tab icon of the web app.
          </Text>
        </View>
        {FAVICON_COLOR_OPTIONS.map((option) => (
          <ListRow
            key={option.value}
            title={option.label}
            leading={
              <View
                className="h-5 w-5 rounded-full"
                style={{ backgroundColor: option.hex ?? tokens.foreground }}
              />
            }
            selected={option.value === appearance.faviconColor}
            onPress={() => {
              faviconSheet.dismiss();
              selectFaviconColor(option.value);
            }}
            testID={`appearance-favicon-option-${option.value}`}
          />
        ))}
      </Sheet>
    </>
  );
}
