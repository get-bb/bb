import { useState, type CSSProperties } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  dispatchGateStageValues,
  type AppSettings,
  type DispatchGateStage,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SettingsBadge,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { pluginRuntimeStatusPresentation } from "@/components/plugin/management/plugin-status";
import {
  usePluginList,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";

type DispatchGateOrder = AppSettings["dispatchGateOrder"];

interface DispatchGatesSettingsSectionProps {
  disabled: boolean;
  generalSettings: AppSettings;
  onGeneralSettingsChange: (next: AppSettings) => Promise<unknown> | void;
}

const restrictGateDragToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

const gateDragModifiers: Modifier[] = [restrictGateDragToVerticalAxis];

/**
 * What each stage means to a user. A `Record` over the stage union, so a stage
 * added to the domain enum without wording here fails to compile.
 */
const STAGE_PRESENTATION: Record<
  DispatchGateStage,
  { label: string; description: string }
> = {
  "thread.create": {
    label: "New threads",
    description: "Before a new thread is created.",
  },
  "turn.submit": {
    label: "Messages",
    description: "Before a message is sent to the agent.",
  },
  "turn.failed": {
    label: "Failures",
    description: "After a turn fails, to schedule a retry.",
  },
};

/**
 * The plugins whose gates run at `stage`, in the order the server will run
 * them: the ids pinned in `dispatchGateOrder` lead, in that order, and
 * everything else follows in plugin install order (the order the plugin list
 * arrives in). A pinned id that registers no gate for the stage is ignored.
 * Mirrors `orderedGates()` in the server's dispatch-gate runner — the panel is
 * a read model of that chain, so the two orderings have to agree.
 */
export function orderStageGatePlugins(
  plugins: readonly PluginListItem[],
  stage: DispatchGateStage,
  pinnedIds: readonly string[],
): PluginListItem[] {
  const gates = plugins.filter((plugin) =>
    plugin.dispatchGateStages.includes(stage),
  );
  if (pinnedIds.length === 0) return gates;
  const rank = new Map(pinnedIds.map((id, index) => [id, index]));
  // A stable sort keyed on pinned rank: unpinned ids all share the sentinel
  // rank, so they keep their relative install order behind the pinned ones.
  return [...gates].sort((a, b) => {
    const rankA = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rankB = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return rankA - rankB;
  });
}

/** The id list after a drag, or null when the drag changed nothing. */
export function reorderGatePluginIds(
  ids: readonly string[],
  activeId: string,
  overId: string,
): string[] | null {
  const activeIndex = ids.indexOf(activeId);
  const overIndex = ids.indexOf(overId);
  if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) {
    return null;
  }
  return arrayMove([...ids], activeIndex, overIndex);
}

/**
 * The reordered stage written back into the setting. Only the dragged stage's
 * array changes; every other stage keeps whatever the user pinned there, and a
 * stage the user never touched stays absent (plain install order).
 */
export function nextDispatchGateOrder(
  current: DispatchGateOrder,
  stage: DispatchGateStage,
  ids: readonly string[],
): DispatchGateOrder {
  return { ...current, [stage]: [...ids] };
}

interface SortableGateRowProps {
  disabled: boolean;
  plugin: PluginListItem;
  stageLabel: string;
}

function SortableGateRow({
  disabled,
  plugin,
  stageLabel,
}: SortableGateRowProps) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: plugin.id, disabled });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  const name = plugin.name ?? plugin.id;
  const runtimeStatus = pluginRuntimeStatusPresentation(plugin);
  const statusTitle =
    runtimeStatus === null
      ? "Running"
      : (plugin.statusDetail ?? runtimeStatus.condition);

  return (
    <SettingsRow
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/gate-row",
        isDragging && "relative z-10 rounded-md bg-card opacity-90 shadow-lift",
      )}
    >
      <Button
        ref={setActivatorNodeRef}
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "-ml-2 h-8 w-7 shrink-0 touch-none text-muted-foreground",
          !disabled && "cursor-grab active:cursor-grabbing",
        )}
        disabled={disabled}
        aria-label={`Reorder ${name} in ${stageLabel}`}
        {...attributes}
        {...listeners}
      >
        <Icon name="DragDropVertical" aria-hidden="true" />
      </Button>
      <span
        title={statusTitle}
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          runtimeStatus === null
            ? "bg-success"
            : runtimeStatus.tone === "error"
              ? "bg-destructive"
              : "bg-warning",
        )}
      />
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      {runtimeStatus === null ? null : (
        <SettingsBadge>{runtimeStatus.label}</SettingsBadge>
      )}
    </SettingsRow>
  );
}

interface DispatchGateStageListProps {
  disabled: boolean;
  onReorder: (stage: DispatchGateStage, ids: string[]) => void;
  plugins: readonly PluginListItem[];
  stage: DispatchGateStage;
}

function DispatchGateStageList({
  disabled,
  onReorder,
  plugins,
  stage,
}: DispatchGateStageListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const { label, description } = STAGE_PRESENTATION[stage];
  const ids = plugins.map((plugin) => plugin.id);

  const handleDragEnd = (event: DragEndEvent): void => {
    if (
      disabled ||
      typeof event.active.id !== "string" ||
      typeof event.over?.id !== "string"
    ) {
      return;
    }
    const next = reorderGatePluginIds(ids, event.active.id, event.over.id);
    if (next === null) return;
    onReorder(stage, next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <span className="text-xs text-subtle-foreground/75">{description}</span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={gateDragModifiers}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <SettingsRowList>
            {plugins.map((plugin) => (
              <SortableGateRow
                key={plugin.id}
                disabled={disabled}
                plugin={plugin}
                stageLabel={label}
              />
            ))}
          </SettingsRowList>
        </SortableContext>
      </DndContext>
    </div>
  );
}

/**
 * Per-stage dispatch-gate chains: which plugins get to decide about a
 * dispatch, and in what order. Read-only about registration — a plugin appears
 * here because its backend registered a gate — and writable only about order,
 * which is the `dispatchGateOrder` user setting. Renders nothing when no
 * loaded plugin registers a gate, so the whole panel (and its settings bucket)
 * stays invisible on an install that has none.
 */
export function DispatchGatesSettingsSection({
  disabled,
  generalSettings,
  onGeneralSettingsChange,
}: DispatchGatesSettingsSectionProps) {
  const pluginListQuery = usePluginList({ enabled: true });
  const plugins = pluginListQuery.data?.plugins ?? [];
  // The stage whose order a write is in flight for, so the dragged row stays
  // put until the settings query returns the persisted order.
  const [optimistic, setOptimistic] = useState<{
    stage: DispatchGateStage;
    ids: string[];
  } | null>(null);

  const stages = dispatchGateStageValues.filter((stage) =>
    plugins.some((plugin) => plugin.dispatchGateStages.includes(stage)),
  );
  if (stages.length === 0) return null;

  const handleReorder = (stage: DispatchGateStage, ids: string[]): void => {
    setOptimistic({ stage, ids });
    let write: Promise<unknown> | void;
    try {
      write = onGeneralSettingsChange({
        ...generalSettings,
        dispatchGateOrder: nextDispatchGateOrder(
          generalSettings.dispatchGateOrder,
          stage,
          ids,
        ),
      });
    } catch {
      setOptimistic(null);
      return;
    }
    void Promise.resolve(write)
      .catch(() => undefined)
      .finally(() => setOptimistic(null));
  };

  return (
    <SettingsSection
      title="Dispatch gates"
      description="Plugins that decide whether a dispatch proceeds, is held, or is rejected. Each stage runs its gates top to bottom; the first rejection stops the chain."
    >
      <div className="space-y-4">
        {stages.map((stage) => (
          <DispatchGateStageList
            key={stage}
            disabled={disabled}
            onReorder={handleReorder}
            plugins={orderStageGatePlugins(
              plugins,
              stage,
              optimistic?.stage === stage
                ? optimistic.ids
                : (generalSettings.dispatchGateOrder[stage] ?? []),
            )}
            stage={stage}
          />
        ))}
      </div>
    </SettingsSection>
  );
}
