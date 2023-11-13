// eslint-disable-next-line node/no-unpublished-import
import {jest} from '@jest/globals';
// eslint-disable-next-line node/no-unpublished-import
import {Chan, CloseOfClosedChannelError, yieldToMacrotaskQueue} from 'ts-chan';
import {newTicker, tickerGenerator} from '../src/newTicker';

describe('newTicker', () => {
  beforeEach(() => {
    jest.useRealTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('drops missed timers and adjusts for slow receivers', async () => {
    jest.useFakeTimers({
      // used by ts-chan and this test
      doNotFake: ['setImmediate'],
    });

    // since we need to fake timers, and the timer doesn't get registered until
    // _after_ waiting for the timer (which will block forever if we don't
    // increment the time), test for ticks by sending them to a channel
    const chan = new Chan<Date>();

    const interval = 10_000; // 10 seconds

    const startedAt = Date.now();
    const allOffsets: number[] = [];

    // start the ticker
    const ticker = newTicker(interval);

    // increment the time - ticker has already started, so this should get picked up
    jest.advanceTimersByTime(interval - 2);

    // test the ticker behavior, while concurrently receiving from the ticker
    await Promise.all([
      (async () => {
        try {
          // should not send until our interval has passed
          await yieldToMacrotaskQueue();
          expect(chan.tryRecv()).toBeUndefined();

          // increment to just before our interval, same deal
          jest.advanceTimersByTime(1);
          await yieldToMacrotaskQueue();
          expect(chan.tryRecv()).toBeUndefined();

          // increment to our interval
          jest.advanceTimersByTime(1);
          // it should now send the first tick
          await yieldToMacrotaskQueue();
          let tick = chan.tryRecv();
          expect(tick?.value).toBeInstanceOf(Date);
          const firstTick = tick!.value!.getTime();
          expect(firstTick).toBe(Date.now());

          // increment to just before our interval, again, not ready
          jest.advanceTimersByTime(interval - 1);
          await yieldToMacrotaskQueue();
          expect(chan.tryRecv()).toBeUndefined();

          // increment past our interval by 1s - it will send our tick, and basically function as if the timer ran late
          // (because we didn't yield back to the event loop when the time was at the tick interval)
          // even though the timer itself ran late, the tick will be the last "on time" one
          jest.advanceTimersByTime(1_001);
          await yieldToMacrotaskQueue();
          tick = chan.tryRecv();
          expect(tick!.value!.getTime()).toBe(Date.now() - 1_000);
          expect(tick!.value!.getTime()).toBe(firstTick + interval);

          // our next interval should be "on time", based on the last tick
          jest.advanceTimersByTime(interval - 1000 - 1);
          await yieldToMacrotaskQueue();
          expect(chan.tryRecv()).toBeUndefined();
          jest.advanceTimersByTime(1);
          await yieldToMacrotaskQueue();
          tick = chan.tryRecv();
          expect(tick!.value!.getTime()).toBe(Date.now());
          expect(tick!.value!.getTime()).toBe(firstTick + interval * 2);

          // definitely nothing buffered or ready
          await yieldToMacrotaskQueue();
          jest.advanceTimersByTime(0);
          await yieldToMacrotaskQueue();
          jest.advanceTimersByTime(0);
          await yieldToMacrotaskQueue();
          expect(chan.tryRecv()).toBeUndefined();

          // now we'll advance to the next tick, yield back to the event loop,
          // which will cause a tick to be sent to the channel, blocking iteration of the ticker
          jest.advanceTimersByTime(interval);
          const tickBeforeSlow = Date.now();
          await yieldToMacrotaskQueue();

          // start the timer (normally we receive a value which gives it time to start)
          await yieldToMacrotaskQueue();

          // enqueue a tick we will be slow to receive
          jest.advanceTimersByTime(interval);
          await yieldToMacrotaskQueue();

          // advance again, by 100ms less than the interval, to simulate a slow receiver
          jest.advanceTimersByTime(interval - 100);
          await yieldToMacrotaskQueue();

          // receive the first tick we've buffered (the one that was to block the ticker)
          tick = chan.tryRecv();
          expect(tick!.value!.getTime()).toBe(tickBeforeSlow);
          expect(tick!.value!.getTime()).toBe(firstTick + interval * 3);

          // now, lets receive the tick which was delayed - it will be a value exactly one interval from the prior tick, (interval - 100 in the past)
          await yieldToMacrotaskQueue();
          jest.advanceTimersByTime(0);
          await yieldToMacrotaskQueue();
          tick = chan.tryRecv();
          expect(tick!.value!.getTime()).toBe(firstTick + interval * 4);
          expect(tick!.value!.getTime()).toBe(Date.now() - (interval - 100));

          // advance to just before the next tick, just for sanity's sake
          jest.advanceTimersByTime(99);
          await yieldToMacrotaskQueue();
          jest.advanceTimersByTime(0);
          await yieldToMacrotaskQueue();
          jest.advanceTimersByTime(0);
          await yieldToMacrotaskQueue();
          expect(chan.tryRecv()).toBeUndefined();

          // check we're back in sync
          jest.advanceTimersByTime(1);
          await yieldToMacrotaskQueue();
          await yieldToMacrotaskQueue();
          tick = chan.tryRecv();
          expect(tick!.value!.getTime()).toBe(firstTick + interval * 5);
          expect(tick!.value!.getTime()).toBe(Date.now());

          // finally, let's test dropping ticks

          // don't consume anything for 3*interval+1, to simulate dropping a tick
          // 1. for buffering into chan
          // 2. for blocking the ticker
          // 3. to simulate the duration expiring
          for (let i = 0; i < 3 * interval + 1; i++) {
            await yieldToMacrotaskQueue();
            jest.advanceTimersByTime(1);
            await yieldToMacrotaskQueue();
          }

          // our current time, for reference
          expect(Date.now()).toBe(firstTick + interval * 8 + 1);

          // receive the buffered tick
          tick = chan.tryRecv();
          expect(tick!.value!.getTime()).toBe(firstTick + interval * 6);
          await yieldToMacrotaskQueue();
          jest.advanceTimersByTime(0);
          await yieldToMacrotaskQueue();

          // receive our dropped tick, which should be the current time - 1
          await yieldToMacrotaskQueue();
          jest.advanceTimersByTime(0);
          await yieldToMacrotaskQueue();
          tick = chan.tryRecv();
          expect(tick!.value!.getTime()).toBe(firstTick + interval * 8);
          expect(tick!.value!.getTime()).toBe(Date.now() - 1);

          // advance to just before the next tick
          jest.advanceTimersByTime(interval - 2);
          for (let i = 0; i < 10; i++) {
            await yieldToMacrotaskQueue();
            jest.advanceTimersByTime(0);
            await yieldToMacrotaskQueue();
            expect(chan.tryRecv()).toBeUndefined();
          }

          // ...and we're back in sync
          jest.advanceTimersByTime(1);
          await yieldToMacrotaskQueue();
          tick = chan.tryRecv();
          expect(tick!.value!.getTime()).toBe(firstTick + interval * 9);
          expect(tick!.value!.getTime()).toBe(Date.now());
        } finally {
          try {
            // stop the ticker
            await expect(ticker.return()).resolves.toStrictEqual({
              done: true,
              value: undefined,
            });
          } finally {
            // unblock any send attempt
            chan.close();
          }
        }
      })(),
      (async () => {
        for await (const date of ticker) {
          try {
            await chan.send(date);
          } catch (e) {
            if (!(e instanceof CloseOfClosedChannelError)) {
              throw e;
            }
          }
          allOffsets.push(date.getTime() - startedAt);
        }
      })(),
    ]);

    expect(allOffsets).toStrictEqual([
      10000, 20000, 30000, 40000, 50000, 60000, 70000, 90000, 100000,
    ]);
  });

  it('should finish on abort', async () => {
    const abort = new AbortController();
    const ticker = tickerGenerator(abort.signal, 10_000, -1, false, new Date());
    const expectedError = Symbol('expected error');
    setTimeout(() => abort.abort(expectedError), 100);
    await expect(ticker.next()).resolves.toStrictEqual({
      done: true,
      value: undefined,
    });
    await expect(ticker.return()).resolves.toStrictEqual({
      done: true,
      value: undefined,
    });
  });

  it('should not bubble abort error on return if not handled via next if the generator was active', async () => {
    const abort = new AbortController();
    const ticker = tickerGenerator(abort.signal, 0, -1, false, new Date());
    await ticker.next();
    await new Promise(resolve => setTimeout(resolve, 50));
    abort.abort();
    await expect(ticker.return()).resolves.toStrictEqual({
      done: true,
      value: undefined,
    });
  });

  it('should not bubble abort error on return if the generator was not active', async () => {
    const abort = new AbortController();
    const ticker = tickerGenerator(abort.signal, 0, -1, false, new Date());
    await new Promise(resolve => setTimeout(resolve, 50));
    abort.abort();
    await ticker.return();
  });

  it('should not bubble abort error on return if the generator was not active even if the abort was preemptive', async () => {
    const abort = new AbortController();
    abort.abort();
    const ticker = tickerGenerator(abort.signal, 0, -1, false, new Date());
    await ticker.return();
  });

  it('yields Date objects at the specified rate', async () => {
    const rate = 100; // milliseconds
    const count = 5;
    const initial = false;
    const expectedInterval = rate;
    let previousDate: Date | null = null;
    let yieldedCount = 0;

    for await (const date of newTicker(rate, count, initial)) {
      if (previousDate !== null) {
        const interval = date.getTime() - previousDate.getTime();
        expect(interval).toBeGreaterThanOrEqual(expectedInterval - 10);
        expect(interval).toBeLessThanOrEqual(expectedInterval + 10);
      }
      previousDate = date;
      yieldedCount++;
    }

    expect(yieldedCount).toBe(count);
  });

  it('yields Date objects at the specified rate with initial set to true', async () => {
    const rate = 100; // milliseconds
    const count = 5;
    const initial = true;
    const expectedInterval = rate;
    let previousDate: Date | null = null;
    let yieldedCount = 0;

    for await (const date of newTicker(rate, count, initial)) {
      if (previousDate !== null) {
        const interval = date.getTime() - previousDate.getTime();
        expect(interval).toBeGreaterThanOrEqual(expectedInterval - 10);
        expect(interval).toBeLessThanOrEqual(expectedInterval + 10);
      }
      previousDate = date;
      yieldedCount++;
    }

    expect(yieldedCount).toBe(count);
  });

  it('immediately yields the current Date when initial is true', async () => {
    const rate = 100; // milliseconds
    const initial = true;

    const ticker = newTicker(rate, 1, initial);
    const firstDate = await ticker.next();

    expect(firstDate.done).toBeFalsy();
    expect(firstDate.value).toBeInstanceOf(Date);
    expect(firstDate.value!.getTime()).toBeCloseTo(Date.now(), -3);
  });

  it('throws an error if rate is not a positive number or a future Date', () => {
    const invalidRate = -100; // Negative milliseconds, invalid
    const count = 5;
    const initial = false;

    expect(() => newTicker(invalidRate, count, initial)).toThrow();
  });

  it('throws an error if count is not a valid integer', () => {
    const rate = 100;
    const invalidCount = 1.5; // Not an integer
    const initial = false;

    expect(() => newTicker(rate, invalidCount, initial)).toThrow();
  });

  it('yields an unlimited number of times when count is negative', async () => {
    const rate = 100; // milliseconds
    const count = -1; // Infinite
    const initial = false;
    const executionTime = 350; // milliseconds
    let yieldedCount = 0;

    const startTime = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _date of newTicker(rate, count, initial)) {
      yieldedCount++;
      if (Date.now() - startTime > executionTime) {
        break;
      }
    }

    const expectedYields = Math.floor(executionTime / rate);
    expect(yieldedCount).toBeGreaterThanOrEqual(expectedYields);
  });

  it('does not yield if count is 0', async () => {
    const values: number[] = [];
    for await (const value of newTicker(100, 0)) {
      values.push(value.getTime());
    }
    expect(values).toStrictEqual([]);
  });

  it('does not yield if the generator was returned', async () => {
    const values: number[] = [];
    const gen = newTicker(100, 1);
    void gen.return();
    for await (const value of newTicker(100, 0)) {
      values.push(value.getTime());
    }
    expect(values).toStrictEqual([]);
  });

  it('does not yield if the generator was thrown', async () => {
    const values: number[] = [];
    const gen = newTicker(100, 1);
    void gen.throw('error').catch(() => undefined);
    for await (const value of gen) {
      values.push(value.getTime());
    }
    expect(values).toStrictEqual([]);
  });

  describe('should not yield until start even if interval is 0', () => {
    test.each([true, false])('initial: %p', async initial => {
      jest.useFakeTimers({
        doNotFake: ['setImmediate'],
      });

      const startedAt = Date.now();
      const allOffsets: number[] = [];
      const allDates: Date[] = [];

      // start the ticker
      const ticker = newTicker(0, 3, initial, new Date(startedAt + 1000));

      // test the ticker behavior, while concurrently receiving from the ticker
      let running = true;
      await Promise.all([
        (async () => {
          try {
            for await (const date of ticker) {
              const delta = Date.now() - date.getTime();
              expect(delta).toBeGreaterThanOrEqual(0);
              expect(delta).toBeLessThanOrEqual(3);
              allDates.push(date);
              allOffsets.push(date.getTime() - startedAt);
            }
          } finally {
            running = false;
          }
        })(),
        (async () => {
          try {
            while (running) {
              // increment the time
              await yieldToMacrotaskQueue();
              jest.advanceTimersByTime(1);
              await yieldToMacrotaskQueue();
            }
          } finally {
            // stop the ticker
            await expect(ticker.return()).resolves.toStrictEqual({
              done: true,
              value: undefined,
            });
          }
        })(),
      ]);

      expect(allOffsets).toStrictEqual([1000, 1001, 1002]);
      expect(allDates.map(d => d.getTime() - startedAt)).toStrictEqual(
        allOffsets
      );
      expect(new Set(allDates).size).toBe(allDates.length);
    });
  });

  describe('should use the current time for yielded dates if the interval is 0', () => {
    test.each([true, false])('initial: %p', async initial => {
      jest.useFakeTimers({
        doNotFake: ['setImmediate'],
      });

      const startedAt = Date.now();
      const allOffsets: number[] = [];
      const allDates: Date[] = [];

      // start the ticker
      const ticker = newTicker(0, 10, initial);
      // this should get picked up - won't start from offset 0
      jest.advanceTimersByTime(5);

      // test the ticker behavior, while concurrently receiving from the ticker
      let running = true;
      await Promise.all([
        (async () => {
          try {
            let allowDiff = initial;
            for await (const date of ticker) {
              const delta = Date.now() - date.getTime();
              expect(delta).toBeGreaterThanOrEqual(0);
              if (allowDiff) {
                allowDiff = false;
                expect(delta).toBeGreaterThanOrEqual(5);
                expect(delta).toBeLessThanOrEqual(8);
              } else {
                expect(delta).toBeLessThanOrEqual(3);
              }
              allDates.push(date);
              allOffsets.push(date.getTime() - startedAt);
            }
          } finally {
            running = false;
          }
        })(),
        (async () => {
          try {
            while (running) {
              // increment the time
              await yieldToMacrotaskQueue();
              jest.advanceTimersByTime(1);
              await yieldToMacrotaskQueue();
            }
          } finally {
            // stop the ticker
            await expect(ticker.return()).resolves.toStrictEqual({
              done: true,
              value: undefined,
            });
          }
        })(),
      ]);

      const expected = [6, 7, 8, 9, 10, 11, 12, 13, 14];
      if (initial) {
        expected.unshift(0);
      } else {
        expected.push(15);
      }

      expect(allOffsets).toStrictEqual(expected);
      expect(allDates.map(d => d.getTime() - startedAt)).toStrictEqual(
        allOffsets
      );
      expect(new Set(allDates).size).toBe(allDates.length);
    });
  });

  describe('should correctly yield start in the future', () => {
    test.each([true, false])('initial: %p', async initial => {
      jest.useFakeTimers({
        doNotFake: ['setImmediate'],
      });

      const chan = new Chan<Date>();

      const interval = 10;

      const startedAt = Date.now();
      const allOffsets: number[] = [];

      const startOffset = 1000;
      const firstTickOffset = startOffset + (initial ? 0 : interval);
      const ticker = newTicker(interval, -1, initial, startedAt + startOffset);
      await Promise.all([
        (async () => {
          try {
            // just before the first tick
            await yieldToMacrotaskQueue();
            jest.advanceTimersByTime(firstTickOffset - 1);
            await yieldToMacrotaskQueue();
            expect(chan.tryRecv()).toBeUndefined();

            // first tick
            jest.advanceTimersByTime(1);
            await yieldToMacrotaskQueue();
            let tick = chan.tryRecv();
            expect(tick).not.toBeUndefined();
            expect(tick?.value?.getTime()).toBe(startedAt + firstTickOffset);
            expect(tick?.value?.getTime()).toBe(Date.now());

            // subsequent ticks as per normal

            await yieldToMacrotaskQueue();
            jest.advanceTimersByTime(interval - 1);
            await yieldToMacrotaskQueue();
            expect(chan.tryRecv()).toBeUndefined();

            jest.advanceTimersByTime(1);
            await yieldToMacrotaskQueue();
            tick = chan.tryRecv();
            expect(tick).not.toBeUndefined();
            expect(tick?.value?.getTime()).toBe(
              startedAt + firstTickOffset + interval
            );
            expect(tick?.value?.getTime()).toBe(Date.now());

            await yieldToMacrotaskQueue();
            jest.advanceTimersByTime(interval);
            await yieldToMacrotaskQueue();
            tick = chan.tryRecv();
            expect(tick).not.toBeUndefined();
            expect(tick?.value?.getTime()).toBe(
              startedAt + firstTickOffset + interval * 2
            );
            expect(tick?.value?.getTime()).toBe(Date.now());
          } finally {
            try {
              await expect(ticker.return()).resolves.toStrictEqual({
                done: true,
                value: undefined,
              });
            } finally {
              chan.close();
            }
          }
        })(),
        (async () => {
          for await (const date of ticker) {
            try {
              await chan.send(date);
            } catch (e) {
              if (!(e instanceof CloseOfClosedChannelError)) {
                throw e;
              }
            }
            allOffsets.push(date.getTime() - startedAt);
          }
        })(),
      ]);

      expect(allOffsets).toStrictEqual([
        firstTickOffset,
        firstTickOffset + interval,
        firstTickOffset + interval * 2,
      ]);
    });
  });

  test('start time in the past should not immediately yield if initial was not set', async () => {
    jest.useFakeTimers({
      doNotFake: ['setImmediate'],
    });

    const chan = new Chan<Date>();

    const interval = 10;

    const startedAt = Date.now();
    const allOffsets: number[] = [];

    const startOffset = -1001;

    const ticker = newTicker(interval, -1, false, startedAt + startOffset);

    await Promise.all([
      (async () => {
        try {
          // just before the first tick
          await yieldToMacrotaskQueue();
          jest.advanceTimersByTime(8);
          await yieldToMacrotaskQueue();
          expect(chan.tryRecv()).toBeUndefined();

          // subsequent ticks as per normal

          jest.advanceTimersByTime(1);
          await yieldToMacrotaskQueue();
          let tick = chan.tryRecv();
          expect(tick).not.toBeUndefined();
          expect(tick?.value?.getTime()).toBe(startedAt + 9);
          expect(tick?.value?.getTime()).toBe(Date.now());

          for (let i = 0; i < interval - 1; i++) {
            // just before the first tick
            await yieldToMacrotaskQueue();
            jest.advanceTimersByTime(1);
            await yieldToMacrotaskQueue();
            expect(chan.tryRecv()).toBeUndefined();
          }

          jest.advanceTimersByTime(2);
          await yieldToMacrotaskQueue();
          tick = chan.tryRecv();
          expect(tick).not.toBeUndefined();
          expect(tick?.value?.getTime()).toBe(startedAt + 9 + interval);
          expect(tick?.value?.getTime()).toBe(Date.now() - 1);
        } finally {
          try {
            await expect(ticker.return()).resolves.toStrictEqual({
              done: true,
              value: undefined,
            });
          } finally {
            chan.close();
          }
        }
      })(),
      (async () => {
        for await (const date of ticker) {
          try {
            await chan.send(date);
          } catch (e) {
            if (!(e instanceof CloseOfClosedChannelError)) {
              throw e;
            }
          }
          allOffsets.push(date.getTime() - startedAt);
        }
      })(),
    ]);

    expect(allOffsets).toStrictEqual([9, 19]);
  });
});
