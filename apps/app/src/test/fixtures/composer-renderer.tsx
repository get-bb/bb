import type { ReactNode } from "react";
import {
  ComposerRendererHostProvider,
  type TypeaheadConfig,
} from "@/components/promptbox/ComposerBox";
import { installPluginRuntime } from "@/lib/plugin-frontend";
import { testTypeaheadConfig } from "@/test/fixtures/composer-search";

export function ComposerRendererTestHost({
  children,
  typeahead = testTypeaheadConfig(),
}: {
  children: ReactNode;
  typeahead?: TypeaheadConfig;
}) {
  installPluginRuntime();
  return (
    <ComposerRendererHostProvider
      surface="thread"
      value=""
      mentionRanges={[]}
      onChange={() => {}}
      onSubmit={() => {}}
      mentionMenuPlacement="top"
      typeahead={typeahead}
    >
      {children}
    </ComposerRendererHostProvider>
  );
}
