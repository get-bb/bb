/**
 * `@react-native/normalize-colors` ships no types. It is React Native's own
 * colour parser (the one `processColor` and react-native-svg end up in):
 * a packed 0xRRGGBBAA number for a colour it can paint, null otherwise.
 */
declare module "@react-native/normalize-colors" {
  export default function normalizeColor(color: string | number): number | null;
}
