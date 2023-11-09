/**
 * Creates an asynchronous ticker that yields Date objects at a specified
 * interval. The ticker will adjust the interval or drop ticks, to make up for
 * slow receivers. It avoids drift by using the time from the last tick as the
 * basis for the next tick.
 *
 * @param interval {number} The interval duration, in milliseconds.
 *   Must be a number >= 0.
 * @param count {number} The number of times to tick. A negative value
 *   indicates an unlimited number of times. Defaults to -1 (unlimited).
 * @param initial {boolean} If true, the ticker will immediately yield the
 *   current Date as the first tick. Defaults to false.
 * @param start {Date} The start time for the ticker. Defaults to the current
 *   time. This is useful if you want to lock your ticker to certain wall times
 *   (requires picking an interval that divides evenly into 24 hours).
 *   This parameter interacts with the initial parameter. If initial is true,
 *   the first tick will be at the start time. Otherwise, the first tick will
 *   be at the start time + interval.
 *
 * @returns An AsyncGenerator that yields Dates at the given interval.
 */
export const newTicker = (
  interval: number,
  count = -1,
  initial = false,
  start?: ConstructorParameters<typeof Date>[0]
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

  const abort = new AbortController();
  return new TickerGenerator(
    abort,
    tickerGenerator(
      abort.signal,
      interval,
      count,
      initial,
      start !== undefined ? new Date(start) : new Date()
    )
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
    if (Date.now() >= tick.getTime()) {
      yield tick;
      if (count > 0) {
        count--;
      }
    } else {
      // the tick is in the future - adjust it backwards, so the first tick will be our start time
      tick.setTime(tick.getTime() - interval);
    }
  }

  let diff: number;
  while (count !== 0 && !abort.aborted) {
    // determine the diff from the last yielded tick
    diff = tick.getTime() - Date.now() + interval;

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

    if (interval === 0) {
      tick = new Date();
    } else if (diff < -interval) {
      // this simulates a make(chan time.Time, 1) being sent on an interval in Go
      // ("drops" missed ticks, by skipping / not yielding 1-n ticks)
      // NOTE: diff was calculated using the time after yielding back, before
      // waiting for the next tick - ergo, the calculation below should always
      // result in a tick less than or equal to the current time
      tick = new Date(tick.getTime() - Math.floor(diff / interval) * interval);
    } else {
      tick = new Date(tick.getTime() + interval);
    }

    yield tick;
    if (count > 0) {
      count--;
    }
  }
}
