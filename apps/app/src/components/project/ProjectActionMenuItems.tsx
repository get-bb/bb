import type {
  experimental_ProjectAction,
  experimental_ProjectActionMenuItemsProps,
} from "@get-bb/plugin-sdk";
import { ActionMenuItem } from "@bb/shared-ui/action-menu-items";
import { PluginContext } from "@/components/plugin/plugin-context";
import { useBbNavigate, useSdk } from "@/lib/plugin-sdk-hooks";
import {
  usePluginSlots,
  type PluginProjectActionSlot,
} from "@/lib/plugin-slots";

function ProjectActionMenuItem({
  slot,
  project,
  surface,
}: experimental_ProjectActionMenuItemsProps & {
  slot: PluginProjectActionSlot;
}) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const key = `${slot.pluginId}/${slot.id}`;
  let action: experimental_ProjectAction | null;
  try {
    action = slot.item({
      project: { id: project.id, name: project.name },
      sdk,
      navigate,
    });
  } catch (error) {
    console.error(`project action "${key}" item failed`, error);
    return null;
  }
  if (action === null) return null;
  return (
    <ActionMenuItem
      surface={surface}
      icon={action.icon}
      disabled={action.disabled}
      variant={action.variant}
      onSelect={() => {
        if (action.disabled) return;
        const warn = (error: unknown) =>
          console.error(`project action "${key}" failed`, error);
        try {
          void Promise.resolve(action.run()).catch(warn);
        } catch (error) {
          warn(error);
        }
      }}
    >
      {action.label}
    </ActionMenuItem>
  );
}

export function ProjectActionMenuItems(
  props: experimental_ProjectActionMenuItemsProps,
) {
  const { projectActions } = usePluginSlots();
  const slots = [...projectActions].sort((left, right) => {
    const leftOrder = left.order ?? Number.POSITIVE_INFINITY;
    const rightOrder = right.order ?? Number.POSITIVE_INFINITY;
    return leftOrder === rightOrder ? 0 : leftOrder < rightOrder ? -1 : 1;
  });
  return slots.map((slot) => (
    <PluginContext.Provider
      key={`${slot.pluginId}/${slot.generation}/${slot.id}`}
      value={slot.pluginId}
    >
      <ProjectActionMenuItem slot={slot} {...props} />
    </PluginContext.Provider>
  ));
}
