# btc-race-24h-20261118-1444 — Dual-scale recovery rider

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/Khanhduy203/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/Khanhduy203/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

Entry for https://make.fun/bounty/btc-race-24h-20261118-1444 — a bot that trades
Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute bars, starting with
$1,000 of paper money, long only.

## Strategy

A full round trip costs ~26 bps, so the bot only trades a move that has
already proved itself on two timescales at once:

- **Entry:** the close must be up ≥ 45 bps over the last 60 bars **and**
  up ≥ 70 bps over the last 90 bars, **and** above its 240-bar average.
  That fires only on a genuine multi-hour recovery, never on a one-minute
  spike.
- **Exit:** take-profit at +130 bps from the fill, a trailing stop of
  80 bps from the highest close since entry, or a 6-hour max hold —
  whichever comes first.
- **Pacing:** at most 2 round trips per window, a 90-bar cooldown after
  each exit, and no new entries in the final ~2 hours.

Everything is integer (BigInt) arithmetic on the harness's raw price units,
so two runs on the same data produce identical orders. No clock, no
randomness, no environment reads.

## Dev-window result (official local grade, `grade-local --driver process`)

- **Net PnL: +$11.38** on the frozen 24h dev window (BTC fell 2.8% over it,
  so buy-and-hold would have lost ~$28).
- **Trades: 2** (1 round trip): buy bar 397 @ ~$64,279, sell bar 508 @
  ~$65,062, via the take-profit.
- **Max drawdown: 0.64%** (guardrail is 25%).

## Files

- `main.ts` — the bot (Node 22, standard library only).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim.
