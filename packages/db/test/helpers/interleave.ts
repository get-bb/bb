type DynamicValue =
  | bigint
  | boolean
  | null
  | number
  | object
  | string
  | symbol
  | undefined;

type DynamicCallable = (...callArgs: never[]) => DynamicValue;

function isCallable<TValue>(value: TValue): value is TValue & DynamicCallable {
  return value instanceof Function;
}

function isObject<TValue>(value: TValue): value is TValue & object {
  return (
    value !== null && Object(value) === value && !(value instanceof Function)
  );
}

function readProperty<T extends object>(
  target: T,
  property: string | symbol,
): T[keyof T] | undefined {
  if (!(property in target)) {
    return undefined;
  }
  // SAFETY: The proxy checks that the runtime property exists before indexing the target.
  return target[property as keyof T];
}

export function withWriteAfterFirstRead<T extends object>(
  connection: T,
  onFirstRead: () => void,
): T {
  let pending: (() => void) | null = onFirstRead;
  const wrapBuilder = <TBuilder extends object>(builder: TBuilder): TBuilder =>
    new Proxy(builder, {
      get(target, property) {
        const value = readProperty(target, property);
        if (!isCallable(value)) {
          return value;
        }
        return (...callArgs: never[]) => {
          const result = value.call(target, ...callArgs);
          if (property === "get") {
            const trigger = pending;
            pending = null;
            trigger?.();
            return result;
          }
          return isObject(result) ? wrapBuilder(result) : result;
        };
      },
    });
  return new Proxy(connection, {
    get(target, property) {
      const value = readProperty(target, property);
      if (property !== "select" || !isCallable(value)) {
        return value;
      }
      return (...callArgs: never[]) => {
        const result = value.call(target, ...callArgs);
        if (!isObject(result)) {
          throw new TypeError("select must return a builder");
        }
        return wrapBuilder(result);
      };
    },
  });
}
