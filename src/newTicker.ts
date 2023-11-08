/**
 * Creates an asynchronous ticker that yields Date objects at a specified
 * interval. The ticker will adjust the interval or drop ticks, to make up for
 * slow receivers.
 *
 * @param interval - The interval duration, in milliseconds.
 *   Must be a number >= 0.
 * @param count - The number of times to tick. A negative value indicates an
 *   unlimited number of times. Defaults to -1 (unlimited).
 * @param initial - If true, the ticker will immediately yield the current
 *   Date as the first tick. Defaults to false.
 *
 * @returns An AsyncGenerator that yields Dates at the given interval.
 */
export const newTicker = (
  interval: number,
  count = -1,
  initial = false
): AsyncGenerator<Date, void> => {
  if (
    typeof (interval as unknown) !== 'number' ||
    Number.isNaN(interval) ||
    !Number.isFinite(interval) ||
    interval < 0
  ) {
    throw new Error('newTicker: interval must be a number >= 0');
  }

  if (!Number.isInteger(count)) {
    throw new TypeError('newTicker: count must be an integer value');
  }

  // so we can "start" immediately - not on the first call to gen.next()
  const tick = new Date();

  return tickerGenerator1(interval, count, initial, tick);
};

// this generator exists to provide the abort signal to the tickerGenerator2
// (prevent blocking on return or throw, if it's stuck within the timeout)
async function* tickerGenerator1(
  interval: number,
  count: number,
  initial: boolean,
  tick: Date
): AsyncGenerator<Date, void> {
  const abort = new AbortController();
  const gen = tickerGenerator2(abort.signal, interval, count, initial, tick);
  try {
    yield* gen;
  } finally {
    abort.abort(undefined);
    await gen.return();
  }
}

export async function* tickerGenerator2(
  abort: AbortSignal,
  interval: number,
  count: number,
  initial: boolean,
  tick: Date
): AsyncGenerator<Date, void> {
  if (count === 0 || abort.aborted) {
    return;
  }

  if (initial) {
    yield tick;
    if (count > 0) {
      count--;
    }
  }

  while (count !== 0 && !abort.aborted) {
    // wait for the next tick
    let id: ReturnType<typeof setTimeout> | undefined;
    let listener: (() => void) | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        listener = () => {
          try {
            if (id !== undefined) {
              clearTimeout(id);
              id = undefined;
            }
            if (listener !== undefined) {
              abort.removeEventListener('abort', listener);
              listener = undefined;
            }
            resolve();
          } catch (e) {
            reject(e);
          }
        };
        abort.addEventListener('abort', listener);
        id = setTimeout(resolve, interval - (Date.now() - tick.getTime()));
      });
    } finally {
      if (id !== undefined) {
        clearTimeout(id);
        id = undefined;
      }
      if (listener !== undefined) {
        abort.removeEventListener('abort', listener);
        listener = undefined;
      }
    }

    // guard against aborts
    if (abort.aborted) {
      break;
    }

    tick = new Date();
    yield tick;
    if (count > 0) {
      count--;
    }
  }
}
