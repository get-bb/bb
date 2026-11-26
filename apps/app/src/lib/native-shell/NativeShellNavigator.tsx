import { useEffect, useEffectEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getNativeShell, shellReportCapabilities } from "./native-shell";

export function NativeShellNavigator() {
  const shell = getNativeShell();
  const navigate = useNavigate();
  const openPath = useEffectEvent((path: string) => {
    void navigate(path);
  });

  useEffect(() => {
    if (shell === null) return;
    const unsubscribe = shell.subscribe((event) => {
      if (event.type === "navigate") openPath(event.path);
    });
    shellReportCapabilities(["navigate"]);
    return unsubscribe;
  }, [shell]);

  return null;
}
