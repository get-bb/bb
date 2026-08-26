import { HugeIcon, type IconProps } from "./HugeIcon";

/**
 * Android / default platform icon: the Hugeicons glyph for `name`. Metro
 * picks the sibling `Icon.ios.tsx` on iOS, which renders the SF Symbol from
 * `sf-symbol-map.ts` when one exists and otherwise falls back to `HugeIcon`.
 * Both modules export the same surface so `@/ui` re-exports resolve on
 * every platform.
 */
export function Icon(props: IconProps) {
  return <HugeIcon {...props} />;
}

export { HugeIcon, type IconProps } from "./HugeIcon";
export { ICON_NAMES, isIconName, type IconName } from "./icon-map";
