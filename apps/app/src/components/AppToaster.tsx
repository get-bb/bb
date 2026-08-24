import { Toaster, type ToasterProps } from "sonner";
import { usePreferredTheme } from "@/hooks/useTheme";

export function AppToaster(props: ToasterProps) {
  const theme = usePreferredTheme();
  return <Toaster theme={theme} {...props} />;
}
