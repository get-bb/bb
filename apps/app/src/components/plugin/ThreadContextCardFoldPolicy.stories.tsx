import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentType,
} from "react";
import { Provider as JotaiProvider, createStore } from "jotai";
import type { ExperimentalThreadContextCardProps } from "@get-bb/plugin-sdk";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  ThreadContextCard,
  ThreadContextCardHeaderButton,
  ThreadContextCardProvider,
} from "./PluginThreadContextCard";
import { ThreadContextCardRow } from "./ThreadContextCardRow";

export default {
  title: "Thread context card/Fold policy",
};

const noop = () => {};
const PLUGIN_ID = "story-fold-policy";

const FilledContext = createContext(false);

function EmptyBody() {
  return null;
}

function PopulatedBody({ label }: { label: string }) {
  return (
    <ThreadContextCardRow icon="GitPullRequest" label={label} onClick={noop} />
  );
}

function ToggledBody() {
  return useContext(FilledContext) ? (
    <PopulatedBody label="Appeared while closed" />
  ) : null;
}

function populated(
  label: string,
): ComponentType<ExperimentalThreadContextCardProps> {
  return function Body() {
    return <PopulatedBody label={label} />;
  };
}

function Summary() {
  return <>Summary text</>;
}

interface FoldSection {
  id: string;
  title: string;
  component: ComponentType<ExperimentalThreadContextCardProps>;
}

const MIXED_SECTIONS: readonly FoldSection[] = [
  { id: "empty-first", title: "Empty first", component: EmptyBody },
  { id: "toggled", title: "Toggled", component: ToggledBody },
  { id: "populated", title: "Populated", component: populated("First row") },
  { id: "empty-middle", title: "Empty middle", component: EmptyBody },
  {
    id: "populated-last",
    title: "Populated last",
    component: populated("Last row"),
  },
];

const EMPTY_SECTIONS: readonly FoldSection[] = [
  { id: "empty-a", title: "Empty A", component: EmptyBody },
  { id: "empty-b", title: "Empty B", component: EmptyBody },
];

function FoldPolicyFixture({ sections }: { sections: readonly FoldSection[] }) {
  const [store] = useState(createStore);
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    setPluginSlotRegistrations(
      PLUGIN_ID,
      makePluginRegistrationSet({
        threadContextCardSections: sections.map((section, index) => ({
          id: section.id,
          title: section.title,
          group: "2_plugins",
          order: index,
          component: section.component,
          summary: Summary,
        })),
      }),
    );
    return () => removePluginSlotRegistrations(PLUGIN_ID);
  }, [sections]);
  return (
    <JotaiProvider store={store}>
      <FilledContext.Provider value={filled}>
        <div className="p-6">
          <button
            type="button"
            data-fold-fixture-fill=""
            aria-pressed={filled}
            onClick={() => setFilled((value) => !value)}
          >
            Fill the Toggled body
          </button>
          <ThreadContextCardProvider
            enabled
            coreRows={[]}
            coreSections={[]}
            threadId="thr_story"
            projectId="proj_story"
            environment={null}
          >
            <ThreadContextCardHeaderButton />
            <div data-scroll-overlay="" className="flex w-[1500px]">
              <ThreadContextCard />
            </div>
          </ThreadContextCardProvider>
        </div>
      </FilledContext.Provider>
    </JotaiProvider>
  );
}

export function MixedBodies() {
  return <FoldPolicyFixture sections={MIXED_SECTIONS} />;
}

export function AllBodiesEmpty() {
  return <FoldPolicyFixture sections={EMPTY_SECTIONS} />;
}
