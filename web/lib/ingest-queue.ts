/** Serialize heavy indexing so memory and CPU stay predictable. */
let chain: Promise<void> = Promise.resolve();

export function enqueueIngest<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(() => task());
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
