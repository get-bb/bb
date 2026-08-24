/**
 * Long-press delay shared by every long-press shortcut (message actions,
 * quote-this-block, sidebar rows, composer chips). One value, so nested
 * targets (a block inside a message) never race each other.
 */
export const LONG_PRESS_DELAY_MS = 350;
