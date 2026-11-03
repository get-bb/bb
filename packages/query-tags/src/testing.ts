export interface KeyedStoreWrite {
  accept(): Promise<void>;
  reject(): Promise<void>;
}

export interface KeyedStoreRead {
  finish(): Promise<void>;
}

export interface KeyedStoreSubject {
  load(rows: Readonly<Record<string, number>>): Promise<void>;
  visible(key: string): number | undefined;
  read(rows: Readonly<Record<string, number>>): Promise<KeyedStoreRead>;
  write(key: string, value: number): Promise<KeyedStoreWrite>;
}

export interface KeyedStoreContractCase {
  name: string;
  run(subject: KeyedStoreSubject): Promise<void>;
}

function shows(
  subject: KeyedStoreSubject,
  expected: Readonly<Record<string, number | undefined>>,
): void {
  const actual = Object.fromEntries(
    Object.keys(expected).map((key) => [key, subject.visible(key)]),
  );
  if (Object.keys(expected).some((key) => actual[key] !== expected[key]))
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}

export const keyedStoreContract: readonly KeyedStoreContractCase[] = [
  {
    name: "shows a prediction on its row at once and removes it when the write fails",
    async run(subject) {
      await subject.load({ a: 1, b: 1 });
      const write = await subject.write("a", 2);
      shows(subject, { a: 2, b: 1 });
      await write.reject();
      shows(subject, { a: 1, b: 1 });
    },
  },
  {
    name: "keeps an accepted value through a read that started before acceptance",
    async run(subject) {
      await subject.load({ a: 1 });
      const write = await subject.write("a", 2);
      const stale = await subject.read({ a: 1 });
      await write.accept();
      await stale.finish();
      shows(subject, { a: 2 });
      const fresh = await subject.read({ a: 3 });
      await fresh.finish();
      shows(subject, { a: 3 });
    },
  },
  {
    name: "lands reads beneath a pending prediction",
    async run(subject) {
      await subject.load({ a: 1 });
      const write = await subject.write("a", 2);
      const read = await subject.read({ a: 5 });
      await read.finish();
      shows(subject, { a: 2 });
      await write.reject();
      shows(subject, { a: 5 });
    },
  },
  {
    name: "keeps a later prediction when an earlier one fails",
    async run(subject) {
      await subject.load({ a: 1 });
      const earlier = await subject.write("a", 2);
      const later = await subject.write("a", 3);
      shows(subject, { a: 3 });
      await earlier.reject();
      shows(subject, { a: 3 });
      await later.reject();
      shows(subject, { a: 1 });
    },
  },
  {
    name: "keeps a later pending prediction above an earlier accepted one",
    async run(subject) {
      await subject.load({ a: 1 });
      const earlier = await subject.write("a", 2);
      const later = await subject.write("a", 3);
      await earlier.accept();
      shows(subject, { a: 3 });
      await later.reject();
      shows(subject, { a: 2 });
    },
  },
  {
    name: "shows a pending prediction on a row that loads after it",
    async run(subject) {
      await subject.load({ b: 1 });
      const write = await subject.write("a", 2);
      shows(subject, { a: undefined, b: 1 });
      const read = await subject.read({ a: 1 });
      await read.finish();
      shows(subject, { a: 2, b: 1 });
      await write.reject();
      shows(subject, { a: 1, b: 1 });
    },
  },
];
