// Dual-scale recovery rider for cbBTC/USDC, 1-minute bars.
//
// Idea: cbBTC on a 24h window drifts more than it trends, and one full
// round trip costs ~26 bps (4 fee + 2 slippage + ~10 impact per leg at
// $1,000 size, ~7-10 bps of it price impact). So the bot only trades a
// move that has already proved itself on TWO timescales at once: the
// price must be up over the last hour AND over the last 90 minutes, and
// above its 4-hour average. That combination fires only on a genuine
// multi-hour recovery, never on a one-minute spike. Once in, it rides
// the move with a take-profit and a trailing stop, and otherwise sits
// in cash. At most two round trips per window, with a cooldown after
// each exit, so a whipsaw cannot bleed the account.
//
// All arithmetic is integer (BigInt) on the harness's raw price units,
// so two runs on the same data produce identical orders. No clock,
// no randomness, no environment reads.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- entry: both momentum windows must clear their bar, price above trend ---
const SHORT_WIN = 60; // minutes for the fast momentum window
const LONG_WIN = 90; // minutes for the slow momentum window
const SMA_WIN = 240; // minutes for the trend average
const SHORT_MIN_BPS = 45; // fast window must be up at least this much
const LONG_MIN_BPS = 70; // slow window must be up at least this much

// --- exit: first of these that triggers ---
const TAKE_PROFIT_BPS = 130; // bank the move
const TRAIL_BPS = 80; // give back at most this much from the peak
const MAX_HOLD_BARS = 360; // 6 hours, then out regardless

// --- pacing ---
const MAX_TRIPS = 2; // round trips per window, at most
const COOLDOWN_BARS = 90; // quiet bars after an exit before re-entering
const LAST_ENTRY_SEQ = 1320; // no new entries in the final ~2 hours
const MAX_SLIP_BPS = 100; // slippage cap on every order
const MIN_NOTIONAL = 1_000_000n; // 1 USDC, in quote units

// Basis points of the move from `back` to `now`, truncated toward zero.
function moveBps(now: bigint, back: bigint): bigint {
  return ((now - back) * 10_000n) / back;
}

await runBars({
  // Close history, oldest first, raw price units (price_scale 5).
  closes: [] as bigint[],
  // Running sum of the last SMA_WIN closes, for the trend average.
  smaSum: 0n,

  // Live trade state, keyed off the fills the harness reports back.
  entryPx: 0n, // fill price of the open position, 0 when flat
  peakPx: 0n, // highest close since entry
  entrySeq: -1, // seq of the bar the buy filled on
  trips: 0, // completed round trips
  coolUntil: -1, // no entries before this seq

  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return []; // a gap minute: nothing to learn, nothing to do
    if (state.warmingUp) return [];

    // Fold the fills of the previous batch into the trade state first.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL || fill.status !== 'filled') continue;
      if (fill.side === 'buy') {
        this.entryPx = BigInt(fill.price);
        this.peakPx = this.entryPx;
        this.entrySeq = fill.fill_bar;
      } else {
        this.entryPx = 0n;
        this.peakPx = 0n;
        this.entrySeq = -1;
        this.trips += 1;
        this.coolUntil = state.seq + COOLDOWN_BARS;
      }
    }

    const close = BigInt(bar.c);
    this.closes.push(close);
    this.smaSum += close;
    if (this.closes.length > SMA_WIN) {
      this.smaSum -= this.closes[this.closes.length - SMA_WIN - 1]!;
    }

    const held = state.positions.get(SYMBOL);
    const qty = held?.qty ?? 0n;

    if (qty > 0n && this.entryPx > 0n) {
      // --- manage the open position ---
      if (close > this.peakPx) this.peakPx = close;
      const gain = moveBps(close, this.entryPx);
      // Give-back from the peak, measured against the peak itself —
      // the same (peak - close) / peak the backtester uses.
      const giveback = ((this.peakPx - close) * 10_000n) / this.peakPx;
      const heldBars = state.seq - this.entrySeq;
      if (
        gain >= TAKE_PROFIT_BPS ||
        giveback >= TRAIL_BPS ||
        heldBars >= MAX_HOLD_BARS
      ) {
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIP_BPS }];
      }
      return [];
    }

    // --- flat: look for a two-timescale recovery ---
    if (this.trips >= MAX_TRIPS) return [];
    if (state.seq < this.coolUntil) return [];
    if (state.seq > LAST_ENTRY_SEQ) return [];
    if (this.closes.length <= SMA_WIN) return [];

    const n = this.closes.length;
    const fast = moveBps(close, this.closes[n - 1 - SHORT_WIN]!);
    const slow = moveBps(close, this.closes[n - 1 - LONG_WIN]!);
    const aboveTrend = close * BigInt(SMA_WIN) > this.smaSum;
    if (fast < SHORT_MIN_BPS || slow < LONG_MIN_BPS || !aboveTrend) return [];

    const room = state.weightRoom(SYMBOL);
    const spend = state.cash < room ? state.cash : room;
    if (spend < MIN_NOTIONAL) return [];
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIP_BPS }];
  },
});
