import { z } from "zod";

/**
 * How completely a provider can clone one of its sessions — the single
 * vocabulary shared by the provider declaration
 * (`bb.providers.register`), the server→daemon
 * `bridgeLaunch`, and the bridge's `initialize` handshake.
 *
 * - `"none"`: sessions cannot be cloned at all.
 * - `"tip"`: only the current end of a session can be cloned (ACP
 *   `session/fork`), so thread fork works but edit-past-message rewind
 *   cannot.
 * - `"checkpoint"`: a session can be recreated at an earlier point, which is
 *   what edit-past-message rewind needs.
 *
 * The values are ordered least to most capable: a declaration is a ceiling
 * the handshake may narrow but never widen.
 */
export const PROVIDER_FORK_VALUES = ["none", "tip", "checkpoint"] as const;

export const providerForkSchema = z.enum(PROVIDER_FORK_VALUES);

export type ProviderFork = (typeof PROVIDER_FORK_VALUES)[number];
