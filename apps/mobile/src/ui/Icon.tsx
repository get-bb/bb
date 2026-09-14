import { HugeIcon, type IconProps } from "./HugeIcon";

export function Icon(props: IconProps) {
  return <HugeIcon {...props} />;
}

export { isIconName, type IconName } from "./icon-map";
