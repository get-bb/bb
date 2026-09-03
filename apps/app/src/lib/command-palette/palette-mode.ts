import type { ComponentType } from "react";
import type { AppCommandId } from "@bb/domain";
import type { IconName } from "@bb/shared-ui/icon";

export interface PaletteModePresentation {
  chip: {
    icon: IconName;
    label: string;
  };
  footerKeys: readonly {
    keys: readonly string[];
    label: string;
  }[];
  placeholder: string;
}

export interface PaletteModeViewProps {
  onExit: () => void;
  runAfterClose: (run: () => void) => void;
  presentation: PaletteModePresentation;
}

export interface PaletteModeRegistration extends PaletteModePresentation {
  id: string;
  entryCommand: AppCommandId;
  View: ComponentType<PaletteModeViewProps>;
}
