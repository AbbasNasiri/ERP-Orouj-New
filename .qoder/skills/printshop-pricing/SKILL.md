---
name: printshop-pricing
description: Print-shop quoting and cost rules for the print-shop-desktop system — the authoritative backend pricing engine, the owner's reference book example, plate/zinc and offset-block arithmetic, material-vs-service markup separation, customer-supplied stock, versioned rate snapshots and the weekly market-rate review. Use when changing or reviewing any price, rate, quote, invoice figure or cost formula.
when_to_use: Editing electron/pricing.js, electron/quote.js, src/smart.js estimateCost, src/quote-money.mjs, rates in settings, or anything that changes what the customer is charged.
argument-hint: "<order specs or the figure being priced>"
---

# Print-shop pricing

## Overview

One rule decides every dispute: **`electron/pricing.js` is the only authority for money that is saved or printed.** The renderer estimate in `src/smart.js` is a fast, explainable draft and is never a quotation. Rates belong to the shop's calendar week, not to the code.

## Engine invariants (verified by `scripts/check-pricing.cjs`)

1. `serviceMarkupPercent` in  applies to **services only**. Materials are passed at their day price and must not receive margin again — the owner's rule: «سود فقط بر خدمات».
2. Materials the customer brings have `customerSupplied: true` → sale amount `0`, but `consumedQty` is kept so warehouse consumption still books.
3. Free offers («آفر») have `customerCharge: 0` and an optional `internalCost` tracked separately; they never enter the customer total.
4. Offset print has a minimum full block up to 5000 sheets per plate. Above one block the caller must pass `mode: 'proportional' | 'ceilBlocks'` — the engine throws instead of guessing. At 10001 sheets these differ materially (4,000,400 vs 6,000,000 per plate in the current example rate).
5. Discount is subtracted **before** tax. `taxPercent` is a parameter, never an assertion about the current legal rate.
6. All money is integer minor units of the caller's declared `currency` (`IRR`/`IRT`); the engine rounds half-up per line, then markup, then tax, using BigInt decimals. Never pre-computed amounts from the UI.
7. Non-negative, finite, non-cyclic input only; a forged negative or `NaN` amount is rejected rather than zeroed.

## The reference example (acceptance test)

400-page two-colour Rahli book, 2000 copies, تیراژ + 100 باطله, customer supplies text paper and cover board, glossy laminate, hot-melt binding, free cutting/packing/shipping:

| Line | Amount (تومان) |
| --- | --- |
| کاغذ متن / مقوای جلد (customer supplied) | 0 |
| زینک متن ۲۰۰ + جلد ۴ | 408,000,000 |
| چاپ متن ۲۰۰ ورق + چاپ جلد | 410,000,000 |
| سلفون جلد (۵۰×۳۵÷۱۰۰ × تیراژ) | 17,500,000 |
| صحافی ۵۱ فرم × تیراژ | 204,000,000 |
| base | 1,039,500,000 |
| + 20% markup on services | 1,247,400,000 |
| + 10% VAT (only for a formal invoice) | 1,372,140,000 |

If a change makes these numbers move, it is a bug unless the owner approved the new rule. Run:

```
node scripts/check-pricing.cjs        # engine invariants
npm test                              # full project suite (backend + renderer + UI)
```

## Rate discipline

- Rates in `references/rate-register.md` are the owner's working numbers, **not** verified market prices. Before using them in a quote, confirm the effective date.
- The owner asked for a weekly (Saturday) market review from Iranian price sites; that job does not exist yet and no automated price change is authorised. A proposal is allowed, an unattended write to rates is not.
- Every saved quote keeps a snapshot of the rates used plus a revision number; saving an old revision, injecting amounts from the UI, or repricing after production permission is blocked by the backend. Only manager and finance roles can compute or save a quote, and money fields are withheld from other roles.

## When something looks wrong

1. Reproduce with the two commands above; a failing invariant is reported before any edit.
2. State which line moved and by how much — never adjust a rate to make a total match.
3. If the dispute is a business rule (what «سه رنگ» costs, the block above 5000, VAT, «اتمام سفارش» for invoicing), stop and ask the owner; those are recorded as OPEN-03, OPEN-06, OPEN-07, OPEN-11 in `docs/requirements-fa.md`.
4. Known divergence to be retired in its own step: the renderer's `estimateCost` in `src/smart.js` applies `marginPercent` to materials as well. It only shows in the Finance tab estimate, but it must not be quoted until unified with the engine.

## Resources

- `scripts/check-pricing.cjs` — invariants + reference example; `--root=<project dir>` if the project lives elsewhere.
- `references/rate-register.md` — current working rates, the formulas behind each line, and the open questions blocking them.
