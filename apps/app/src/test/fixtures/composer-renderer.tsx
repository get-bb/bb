import type { ReactNode } from "react";
import {
  ComposerRendererHostProvider,
  type TypeaheadConfig,
} from "@/components/promptbox/ComposerBox";
import { installPluginRuntime } from "@/lib/plugin-frontend";
import { testTypeaheadConfig } from "@/test/fixtures/composer-search";
import { useComposerDraftFixture } from "@/test/fixtures/composer-draft";

export function ComposerRendererTestHost({
  children,
  typeahead = testTypeaheadConfig(),
}: {
  children: ReactNode;
  typeahead?: TypeaheadConfig;
}) {
  installPluginRuntime();
  const draft = useComposerDraftFixture();
  return (
    <ComposerRendererHostProvider
      surface="thread"
      draft={draft}
      onSubmit={() => {}}
      mentionMenuPlacement="top"
      typeahead={typeahead}
    >
      {children}
    </ComposerRendererHostProvider>
  );
}
