export const SERVER_RETIRE_FORCE_EXIT_MS = 10_000;

export interface RetireServerProcessArgs {
  exit(code: number): void;
  forceExitAfterMs: number;
  shutdown(): Promise<void>;
}

export function retireServerProcess(args: RetireServerProcessArgs): void {
  const forceExit = setTimeout(() => {
    args.exit(0);
  }, args.forceExitAfterMs);
  forceExit.unref();
  const finish = () => {
    clearTimeout(forceExit);
    args.exit(0);
  };
  void args.shutdown().then(finish, finish);
}
