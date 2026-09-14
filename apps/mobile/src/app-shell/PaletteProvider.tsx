import { isBuiltInThemeId, type BuiltInThemeId } from "@bb/domain";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useSystemConfig } from "@/data/system/system-queries";
import { useProfiles } from "./ProfilesProvider";

const PaletteContext = createContext<
  ((palette: BuiltInThemeId) => void) | null
>(null);

export function PaletteProvider({
  children,
}: {
  children: (palette: BuiltInThemeId) => ReactNode;
}) {
  const [palette, setPalette] = useState<BuiltInThemeId>("default");
  return (
    <PaletteContext.Provider value={setPalette}>
      {children(palette)}
    </PaletteContext.Provider>
  );
}

function usePaletteSetter(): (palette: BuiltInThemeId) => void {
  const setPalette = useContext(PaletteContext);
  if (!setPalette) {
    throw new Error("usePaletteSetter must be used inside <PaletteProvider>");
  }
  return setPalette;
}

function paletteFromThemeId(themeId: string): BuiltInThemeId {
  return isBuiltInThemeId(themeId) ? themeId : "default";
}

function ActiveServerPaletteSync() {
  const setPalette = usePaletteSetter();
  const config = useSystemConfig();
  const themeId = config.data?.appearance.themeId;
  useEffect(() => {
    if (themeId !== undefined) setPalette(paletteFromThemeId(themeId));
  }, [themeId, setPalette]);
  return null;
}

export function ServerPaletteSync() {
  const { connection } = useProfiles();
  return connection ? <ActiveServerPaletteSync /> : null;
}
