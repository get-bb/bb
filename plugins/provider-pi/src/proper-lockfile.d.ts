declare module "proper-lockfile" {
  export interface LockOptions {
    realpath?: boolean;
  }
  export interface ProperLockfile {
    lockSync(path: string, options?: LockOptions): () => void;
  }
  const lockfile: ProperLockfile;
  export default lockfile;
}
