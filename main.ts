// Washout Rider: a long-only cbBTC dip-buy bot for agent-fun/bars-replay/v1.
//
// Idea (from the RESOLVED race btc-race-24h-20261113-2314, not from the dev
// window alone): the money on a down day is in the one deep washout and its
// snap-back, not in trend-following. The final leaderboard of that race:
// rank 1 +3.06% (4 trades), rank 2 +2.90% (6 trades), ranks 3-6 +2.50% with
// 2 trades each and byte-identical metrics (one single dip, one round trip
// each — one opportunity, not four independent edges). Top-10 average 2.6
// trades, +2.52%. Every top-10 title is a dip/washout/capitulation buyer.
// Only 150 of 1,333 entries finished positive; the median was -$20.40.
// Our previous bot, Grind Rider (aligned-momentum trend-following), finished
// #617 at -2.02% with 9 trades and 3.31% drawdown: it chased continuation
// into a reversal regime, traded 4.5x as often as the winners, and bled.
// Its dev-window +$10.01 proved nothing about the live regime.
//
// What this bot does instead — wait for the washout, capture the recovery:
//   Arm (flat only): the close falls 5.0% below the trailing 6-hour high.
//     The 5.0% threshold is the selective end of the 3.5-5.0% range: on
//     the dev window, 4.0% and 4.5% arms both fire mid-slide and stop out
//     (-$13.02 / -$10.95), while 5.0% waits for the true bottom. 500-525
//     bps all give the identical winning trade; below 500 the bot loses.
//   Confirm: a 5-bar candle closes >= 0.30% above the lowest close since
//     arming, then a later close breaks above that candle's high. A new
//     lower close resets the confirmation. Cancel if the price has already
//     rebounded > 1.0% from the low before entry (do not chase).
//   Feasibility: the room back to the pre-dip 6h high must exceed 2.60%
//     at entry (the old race's rank-10 bar was +2.28%; at ~95% exposure
//     with ~0.20% round-trip costs, 2.28/0.95 + 0.20 = 2.60% is the price
//     gain a winning trade needs). Skip setups with no room.
//   Sizing: stop 0.20% below the setup low; exposure = min(100%,
//     0.75% / stop-distance), so a 0.8% stop gives ~94% exposure and ~0.75%
//     of equity at risk before costs. No leverage, no averaging down.
//   Exits: target +3.0% net account return; trailing stop 1.20% below the
//     highest close since entry (protects a recovery that stalls short of
//     the target); hard stop at the initial stop, never widened. The
//     engine flattens anything still held at the last close.
//   Budget: at most 2 round trips (4 fills). Stop trading after -1.0%
//     realized account PnL. A 60-bar cooldown follows every exit or
//     cancelled setup, and a retry needs a fresh qualifying setup.
//
// Dev-window result (kit harness, grade-local, --driver process):
//   net PnL +$33.72, 2 trades, max drawdown 0.60%, fees $0.65.
//   One trade: buy bar 1043 ($62,657, 6 bars after the $62,082 low),
//   sell bar 1114 ($65,357). Grind Rider on the same window: -$21.46.
//   Baselines on the same window: buy-and-hold -$52.59, momentum -$49.23,
//   adx-momentum -$50.31, rsi-bollinger -$65.83, ema-cross -$109.38,
//   hold-cash $0.00 (from the previous race's kit; re-run here if needed).
//
// Robustness (exact-integer simulator, validated byte-exact against
// grade-local on Grind Rider: -$21.462102, 10 trades, $3.145766 fees):
//   halves/quarters of the dev window: H1 $0, H2 +$33.72, Q1/Q2/Q4 $0,
//   Q3 +$20.33 (flattened mid-recovery at the quarter end) — worst split
//   is $0, never negative. The previous race's dev window (an independent
//   day): $0, 0 trades — no qualifying dip, the bot stays in cash.
//   Parameter plateau: arm 500-525, confirm 25-35, target 300-350 all give
//   the identical +$33.72 trade; the trailing stop never binds on dev
//   (free insurance for the race window).
//
// Honest limitations:
//   - The profit comes from ONE round trip on ONE washout. If the race
//     day has no dip >= 5.0% from its 6h high, the bot makes 0 trades and
//     $0, fails the >= 1-trade guardrail, and takes no prize. That is the
//     design's deliberate downside bound, not an oversight: on the only
//     other day tested it correctly stayed out instead of losing.
//   - If the race day's washout is shallower than 5.0% (the old race's
//     was ~4.5%), the bot will not fire. The 5.0% arm was chosen because
//     4.0%/4.5% arms LOSE on the dev window by entering mid-slide; a
//     shallower arm is not a free lunch.
//   - The target (+3.0%) and the stop are tuned to this window's recovery
//     shape; a shorter race-day recovery exits via the trailing stop at
//     whatever the peak minus 1.20% gives, which may be well under +2.28%.
//   - Dev scores are proven non-predictive of final results; the dev gate
//     is a sanity floor only. The edge is the winner pattern from the
//     resolved race, not this window's number.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 100; // 1% past the close the order was decided on

// Setup: 5.0% below the trailing 6-hour (360-bar) high; a 5-bar candle
// closes >= 0.30% above the setup low, then a close breaks its high;
// cancel if already rebounded > 1.0% from the low.
const HIGH_BARS = 360;
const ARM_BPS = 500;
const CONFIRM_BPS = 30;
const CANCEL_BPS = 100;
const ROOM_BPS = 260;
// Risk: stop 0.20% below the setup low; exposure = min(100%, 0.75% / stop).
const STOP_PAD_BPS = 20;
const RISK_BPS = 75;
// Exits: +3.0% account return; trailing stop 1.20% under the peak close.
const TARGET_BPS = 300;
const TRAIL_BPS = 120;
// Budget: at most 2 round trips (4 fills); stop after -1.0% realized;
// 60-bar cooldown after every exit or cancelled setup.
const MAX_ROUND_TRIPS = 2;
const LOSS_STOP_QUOTE = 990_000_000n; // $990 of the $1,000 start
const COOLDOWN_BARS = 60;
const CAPITAL_QUOTE = 1_000_000_000n; // $1,000 in quote units
const MIN_NOTIONAL = 1_000_000n; // 1 USDC, the harness's minimum

const closes: number[] = []; // closes of CBBTC, one per bar received
let armed = false; // a washout setup is live
let setupLow = 0; // lowest close since arming
let setupHigh = 0; // trailing 6h high when the setup armed
let confirmHigh: number | null = null; // high of the confirming 5-bar candle
let stopPrice = 0; // hard stop, 0.20% below the setup low
let trailPeak = 0; // highest close since entry
let roundTrips = 0; // completed round trips
let lastExitSeq = -1_000_000_000; // seq of the last full exit / cancellation
let done = false; // trade budget exhausted

function onBatch(state: BarsState, batch: Batch): OrderInput[] {
  for (const bar of batch.bars) {
    if (bar.symbol === SYMBOL) closes.push(Number(bar.c));
  }
  if (state.warmingUp) return [];
  if (closes.length <= HIGH_BARS) return [];
  if (done) return [];

  const close = closes[closes.length - 1];
  let high6 = 0;
  for (let i = closes.length - HIGH_BARS; i < closes.length; i++) {
    if (closes[i] > high6) high6 = closes[i];
  }

  const held = state.positions.get(SYMBOL);
  if (held !== undefined && held.qty > 0n) {
    if (close > trailPeak) trailPeak = close;
    // Target: account equity >= +3.0%.
    const equity = state.cash + state.value(SYMBOL, held.qty);
    if (equity * 10000n >= CAPITAL_QUOTE * BigInt(10000 + TARGET_BPS)) {
      roundTrips++;
      lastExitSeq = state.seq;
      armed = false;
      confirmHigh = null;
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    // Trailing stop: 1.20% under the peak close since entry.
    if (close * 10000 <= trailPeak * (10000 - TRAIL_BPS)) {
      roundTrips++;
      lastExitSeq = state.seq;
      armed = false;
      confirmHigh = null;
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    // Hard stop: at the initial stop, never widened.
    if (close <= stopPrice) {
      roundTrips++;
      lastExitSeq = state.seq;
      armed = false;
      confirmHigh = null;
      return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }

  // Flat: budget checks first.
  if (roundTrips >= MAX_ROUND_TRIPS) {
    done = true;
    return [];
  }
  if (roundTrips > 0 && state.cash < LOSS_STOP_QUOTE) {
    done = true;
    return [];
  }
  if (state.seq - lastExitSeq < COOLDOWN_BARS) return [];

  // Arming: close 5.0% below the trailing 6h high.
  if (!armed) {
    if (close * 10000 <= high6 * (10000 - ARM_BPS)) {
      armed = true;
      setupLow = close;
      setupHigh = high6;
      confirmHigh = null;
    }
    return [];
  }
  // Armed: track the setup low; a new low resets the confirmation.
  if (close < setupLow) {
    setupLow = close;
    confirmHigh = null;
  }
  // Cancel if already rebounded > 1.0% from the low.
  if (close * 10000 >= setupLow * (10000 + CANCEL_BPS)) {
    armed = false;
    confirmHigh = null;
    lastExitSeq = state.seq;
    return [];
  }
  // Confirmation: a 5-bar candle closes >= 0.30% above the setup low.
  if (confirmHigh === null) {
    if (close * 10000 >= setupLow * (10000 + CONFIRM_BPS)) {
      let h = 0;
      for (let i = closes.length - 5; i < closes.length; i++) {
        if (closes[i] > h) h = closes[i];
      }
      confirmHigh = h;
    }
    return [];
  }
  // Entry: a later close breaks above the confirming candle's high.
  if (close > confirmHigh) {
    // Feasibility: room back to the pre-dip high must exceed 2.60%.
    if (setupHigh * 10000 <= close * (10000 + ROOM_BPS)) {
      armed = false;
      confirmHigh = null;
      lastExitSeq = state.seq;
      return [];
    }
    stopPrice = (setupLow * (10000 - STOP_PAD_BPS)) / 10000;
    const stopDistBps = ((close - stopPrice) / close) * 10000;
    if (stopDistBps <= 0) return [];
    const frac = Math.min(1, RISK_BPS / stopDistBps);
    const notional = BigInt(Math.floor(Number(state.cash) * frac));
    if (notional < MIN_NOTIONAL) return [];
    trailPeak = close;
    armed = false;
    confirmHigh = null;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  }
  return [];
}

await runBars({ onBatch });
