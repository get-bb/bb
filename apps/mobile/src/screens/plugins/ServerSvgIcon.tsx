import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { useServerSvgAsset } from "@/data/plugins";
import { useTheme } from "@/theme";
import { Icon, isIconName, type IconName } from "@/ui";

interface ServerSvgIconProps {
  /** Server-relative (`/api/v1/...`) or absolute URL of an SVG. */
  path: string | null;
  /** `@/ui` icon name drawn while the SVG loads / when there is none. */
  fallbackIcon: IconName;
  size?: number;
  /** Resolves `currentColor`; defaults to the foreground token. */
  color?: string;
}

/**
 * A server-served branding SVG (plugin compact icon, provider logo) painted
 * in the theme foreground: react-native-svg's `color` prop resolves the
 * `currentColor` fills bb's SVGs use, which an `<Image>` would leave black.
 * Falls back to a vocabulary glyph while loading or when the asset is
 * missing / not an SVG.
 */
export function ServerSvgIcon({
  path,
  fallbackIcon,
  size = 20,
  color,
}: ServerSvgIconProps) {
  const { tokens } = useTheme();
  const asset = useServerSvgAsset(path);
  const tint = color ?? tokens.foreground;
  if (asset.data === undefined) {
    return <Icon name={fallbackIcon} size={size} color={tint} />;
  }
  return (
    <View style={{ width: size, height: size }} accessible={false}>
      <SvgXml xml={asset.data} width={size} height={size} color={tint} />
    </View>
  );
}

interface PluginIconProps {
  /** The plugin's `iconUrl` (compact SVG) when it declares one. */
  iconUrl: string | null;
  /** The plugin's `icon` (a shared vocabulary name) when it declares one. */
  icon: string | null;
  size?: number;
  color?: string;
}

/** Plugin identity glyph: the plugin's SVG, else its named icon, else a puzzle piece. */
export function PluginIcon({
  iconUrl,
  icon,
  size = 20,
  color,
}: PluginIconProps) {
  const { tokens } = useTheme();
  const fallback: IconName =
    icon !== null && isIconName(icon) ? icon : "Puzzle";
  if (iconUrl === null) {
    return (
      <Icon name={fallback} size={size} color={color ?? tokens.foreground} />
    );
  }
  return (
    <ServerSvgIcon
      path={iconUrl}
      fallbackIcon={fallback}
      size={size}
      color={color}
    />
  );
}
