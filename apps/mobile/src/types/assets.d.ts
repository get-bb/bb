declare module "*.css";
declare module "*.html" {
  /** Metro asset module id (`Asset.fromModule`). */
  const assetModuleId: number;
  export default assetModuleId;
}
