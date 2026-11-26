export type HostUiProps = { "data-bb-host-ui"?: "" };
export type PluginContentProps = { "data-bb-plugin-content"?: "" };

const NO_PROPS = {};

export function useHostUiProps(): HostUiProps {
  return NO_PROPS;
}

export function usePluginContentProps(): PluginContentProps {
  return NO_PROPS;
}
