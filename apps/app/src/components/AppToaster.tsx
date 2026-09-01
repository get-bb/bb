import { Toaster, type ToasterProps } from "sonner";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { usePreferredTheme } from "@/hooks/useTheme";

export function AppToaster({
  position = "bottom-right",
  ...props
}: ToasterProps) {
  const theme = usePreferredTheme();
  const isCompactViewport = useIsCompactViewport();
  return (
    <Toaster
      theme={theme}
      position={isCompactViewport ? "top-center" : position}
      {...props}
    />
  );
}
