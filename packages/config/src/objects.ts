interface AssignIfDefinedArgs<
  TTarget extends object,
  TKey extends keyof TTarget,
> {
  key: TKey;
  target: TTarget;
  value: TTarget[TKey] | undefined;
}

export function assignIfDefined<
  TTarget extends object,
  TKey extends keyof TTarget,
>(args: AssignIfDefinedArgs<TTarget, TKey>): void {
  if (args.value !== undefined) {
    args.target[args.key] = args.value;
  }
}
