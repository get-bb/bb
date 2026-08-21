/**
 * The plugin's `bb.host` artifact.
 *
 * Every ACP agent bb ships runs on the published ACP kit — the same module a
 * third-party plugin uses — so this plugin's host side is one re-export. The
 * daemon's bridge bootstrap imports the artifact and looks for the named
 * `experimental_providerBridge` export.
 */
export { experimental_acpProviderBridge as experimental_providerBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
