# generator-ticker

[![NPM Package](https://img.shields.io/badge/NPM-generator--ticker-brightgreen)](https://www.npmjs.com/package/generator-ticker)
[![GitHub Repo](https://img.shields.io/badge/GitHub-generator--ticker-blue)](https://github.com/joeycumines/generator-ticker)
[![Code Style: Google](https://img.shields.io/badge/code%20style-google-blueviolet.svg)](https://github.com/google/gts)

## What is this?

Do things, particularly async things, on a regular interval.
Avoid drift, by treating the interval as a maximum rate, adjusting for slow
receivers, and dropping missed ticks if necessary.

This implementation was inspired by Go's
[time.NewTicker](https://pkg.go.dev/time#NewTicker).

## Usage

```ts
const {newTicker} = require('generator-ticker');

// the last three parameters (count, initial, start) are optional
for await (const tick of newTicker(500, 3, false, new Date(0))) {
  console.log(`${tick.getSeconds()}s${tick.getMilliseconds()}ms\n`);
}

// will output something similar to:
// 52s500ms
// 53s0ms
// 53s500ms
```

## Installation

Install or import the NPM package `generator-ticker`. Should work in most
environments, including browsers, Node.js, and Deno.

## API

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

#### Table of Contents

*   [newTicker](#newticker)
    *   [Parameters](#parameters)

### newTicker

Creates an asynchronous ticker that yields Date objects at a specified
interval. The ticker will adjust the interval or drop ticks, to make up for
slow receivers. It avoids drift by using the time from the last tick as the
basis for the next tick.

#### Parameters

*   `interval` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** {number} The interval duration, in milliseconds.
    Must be a number >= 0.
*   `count`  {number} The number of times to tick. A negative value
    indicates an unlimited number of times. Defaults to -1 (unlimited). (optional, default `-1`)
*   `initial`  {boolean} If true, the ticker will immediately yield the
    current Date as the first tick. Defaults to false. (optional, default `false`)
*   `start` **any?** {Date} The start time for the ticker. Defaults to the current
    time. This is useful if you want to lock your ticker to certain wall times
    (requires picking an interval that divides evenly into 24 hours).
    This parameter interacts with the initial parameter. If initial is true,
    the first tick will be at the start time. Otherwise, the first tick will
    be at the start time + interval.

Returns **AsyncGenerator<[Date](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Date), void>** An AsyncGenerator that yields Dates at the given interval.
