import type { Command } from "commander";

type ThreadCommandRegistrar = (parent: Command, getUrl: () => string) => void;

type ThreadCommandLoader = () => Promise<ThreadCommandRegistrar>;

const waitLoader: ThreadCommandLoader = async () =>
  (await import("./wait.js")).registerWaitCommand;
const spawnLoader: ThreadCommandLoader = async () =>
  (await import("./spawn.js")).registerSpawnCommand;
const forkLoader: ThreadCommandLoader = async () =>
  (await import("./fork.js")).registerForkCommand;
const listLoader: ThreadCommandLoader = async () =>
  (await import("./list.js")).registerListCommand;
const showLoader: ThreadCommandLoader = async () =>
  (await import("./show.js")).registerShowCommand;
const openLoader: ThreadCommandLoader = async () =>
  (await import("./open.js")).registerOpenCommand;
const paneLoader: ThreadCommandLoader = async () =>
  (await import("./pane.js")).registerPaneCommand;
const organizationLoader: ThreadCommandLoader = async () =>
  (await import("./organization.js")).registerOrganizationCommands;
const actionsLoader: ThreadCommandLoader = async () =>
  (await import("./actions.js")).registerActionsCommands;
const interactionsLoader: ThreadCommandLoader = async () =>
  (await import("./interactions.js")).registerInteractionCommands;

const allLoaders: readonly ThreadCommandLoader[] = [
  waitLoader,
  spawnLoader,
  forkLoader,
  listLoader,
  showLoader,
  openLoader,
  paneLoader,
  organizationLoader,
  actionsLoader,
  interactionsLoader,
];

const loaderByCommand = new Map<string, ThreadCommandLoader>([
  ["wait", waitLoader],
  ["wait-many", waitLoader],
  ["spawn", spawnLoader],
  ["fork", forkLoader],
  ["list", listLoader],
  ["show", showLoader],
  ["log", showLoader],
  ["output", showLoader],
  ["open", openLoader],
  ["pane", paneLoader],
  ["section", organizationLoader],
  ["search", organizationLoader],
  ["history", organizationLoader],
  ["read", organizationLoader],
  ["unread", organizationLoader],
  ["reorder-pinned", organizationLoader],
  ["queue", organizationLoader],
  ["tabs", organizationLoader],
  ["update", actionsLoader],
  ["archive", actionsLoader],
  ["unarchive", actionsLoader],
  ["pin", actionsLoader],
  ["unpin", actionsLoader],
  ["delete", actionsLoader],
  ["edit-message", actionsLoader],
  ["tell", actionsLoader],
  ["stop", actionsLoader],
  ["compact", actionsLoader],
  ["cancel-plan", actionsLoader],
  ["clear-goal", actionsLoader],
  ["interactions", interactionsLoader],
]);

export async function loadThreadCommandRegistrar(
  commandName: string | undefined,
): Promise<(program: Command, getUrl: () => string) => void> {
  const selectedLoader =
    commandName === undefined ? undefined : loaderByCommand.get(commandName);
  const registrars = await Promise.all(
    selectedLoader === undefined
      ? allLoaders.map((load) => load())
      : [selectedLoader()],
  );
  return (program, getUrl) => {
    const thread = program.command("thread").description("Manage threads");
    for (const register of registrars) register(thread, getUrl);
  };
}
