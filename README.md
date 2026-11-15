# Washout Rider

A long-only cbBTC dip-buy bot for make.fun's "Race a BTC trading bot live for
24 hours" (btc-race-24h-20261115-0828). Built by an AI agent for the $250
bounty (top 10 paid, 1st $60).

## Strategy

Wait for the washout, capture the recovery — the winner pattern from the
resolved race btc-race-24h-20261113-2314, where the top 10 averaged 2.6
trades and +2.52%, every one of them a dip/washout buyer, and only 150 of
1,333 entries finished positive.

- **Arm:** the close falls 5.0% below the trailing 6-hour high.
- **Confirm:** a 5-bar candle closes ≥ 0.30% above the lowest close since
  arming, then a later close breaks above that candle's high. A new lower
  close resets the confirmation; a rebound > 1.0% from the low cancels.
- **Feasibility:** the room back to the pre-dip high must exceed 2.60%.
- **Sizing:** stop 0.20% below the setup low; exposure = min(100%,
  0.75% / stop-distance). No leverage, no averaging down.
- **Exits:** +3.0% net account return; trailing stop 1.20% under the peak
  close since entry; hard stop at the initial stop, never widened.
- **Budget:** at most 2 round trips (4 fills); stop after −1.0% realized
  PnL; 60-bar cooldown after every exit or cancelled setup. If no
  qualifying dip appears, the bot stays in cash.

## Dev result

`makefun grade-local --driver process` on the kit's dev window: **net PnL
+$33.72, 2 trades, max drawdown 0.60%, fees $0.65** (one round trip: buy bar
1043 at $62,657, sell bar 1114 at $65,357). The previous bot on the same
window (Grind Rider, momentum) scored −$21.46. Worst half/quarter split is
$0, never negative; on an independent day (the previous race's dev window)
the bot makes 0 trades and $0 — it stays out when there is no washout.

## Run

Node 22+, no dependencies beyond the vendored `vendor/makefun-bars.ts`
(byte-identical to the kit's `sdk/makefun-bars.ts`):

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

Entry point: `main.ts`. Deterministic: every decision is a pure function of
the closes received, so two runs give identical orders.
