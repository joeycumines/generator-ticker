/**
 * Creates an asynchronous ticker that yields Date objects at a specified
 * interval. The ticker will adjust the interval or drop ticks, to make up for
 * slow receivers. It avoids drift by using the time from the last tick as the
 * basis for the next tick.
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

  if (!Number.isSafeInteger(count)) {
    throw new TypeError('newTicker: count must be a safe integer value');
  }

  // so we can "start" immediately - not on the first call to gen.next()
  const tick = new Date();

  const abort = new AbortController();
  return new TickerGenerator(
    abort,
    tickerGenerator(abort.signal, interval, count, initial, tick)
  );
};

class TickerGenerator implements AsyncGenerator<Date, void> {
  #abort: AbortController;
  #gen: AsyncGenerator<Date, void>;

  constructor(abort: AbortController, gen: AsyncGenerator<Date, void>) {
    this.#abort = abort;
    this.#gen = gen;
  }

  [Symbol.asyncIterator](): AsyncGenerator<Date, void, unknown> {
    return this.#gen[Symbol.asyncIterator]();
  }

  next(v?: unknown): Promise<IteratorResult<Date, void>> {
    return this.#gen.next(v);
  }

  return(
    value?: PromiseLike<void> | void
  ): Promise<IteratorResult<Date, void>> {
    this.#abort.abort(undefined);
    return this.#gen.return(value);
  }

  throw(e?: unknown): Promise<IteratorResult<Date, void>> {
    this.#abort.abort(undefined);
    return this.#gen.throw(e);
  }
}

export async function* tickerGenerator(
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

  let diff: number;
  while (count !== 0 && !abort.aborted) {
    // determine the diff from the last yielded tick
    diff = tick.getTime() - Date.now() + interval;
    if (interval === 0) {
      tick = new Date();
    } else if (diff < -interval) {
      // drop missed ticks, but still use the diff as the timeout
      // this simulates a make(chan time.Time, 1) being sent on an interval in Go
      tick = new Date(tick.getTime() - Math.floor(diff / interval) * interval);
    } else {
      tick = new Date(tick.getTime() + interval);
    }

    // wait for the next tick
    let id: ReturnType<typeof setTimeout> | undefined;
    let listener: (() => void) | undefined;
    try {
      await new Promise<void>(resolve => {
        listener = resolve;
        abort.addEventListener('abort', listener);
        id = setTimeout(resolve, diff);
      });
    } finally {
      if (id !== undefined) {
        clearTimeout(id);
      }
      if (listener !== undefined) {
        abort.removeEventListener('abort', listener);
      }
    }

    // guard against aborts
    if (abort.aborted) {
      break;
    }

    yield tick;
    if (count > 0) {
      count--;
    }
  }
}
