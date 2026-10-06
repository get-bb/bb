import { PluginCatalogAuthorAvatar } from "@bb/shared-ui/plugin-catalog-card";
import { BbLogo } from "@/components/ui/bb-logo";

export function PluginAuthorAvatar({
  name,
  github,
  size,
  official = false,
}: {
  name: string;
  github: string | null;
  size: "detail" | "page";
  official?: boolean;
}) {
  return (
    <PluginCatalogAuthorAvatar
      name={name}
      github={github}
      size={size}
      official={official}
      officialMark={<BbLogo className="size-4/5" />}
    />
  );
}
