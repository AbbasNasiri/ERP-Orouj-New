# Field extraction contract

Every row is verified against `src/smart.js` (`parseOrderText`, `wordsToDigits`, `analyzeItem`, `estimateCost`) and `src/smartorder.js` (`splitOrderText`, `extractItems`). Column "when missing" is the current behaviour, not the desired one — the desired gate is in the last column.

Text is normalised first: Persian/Arabic digits → Latin, `ي→ی`, `ك→ک`, `ة→ه`, ZWNJ → space, `٫ → .`. Numeric reads run on a `wordsToDigits` copy so spoken numerals (`دو هزار و پانصد`, `هفتاد گرم`) reach the form; wording reads (`رنگ`, `صحافی`, `جلد`) run on the normalised original.

| Field | Read from | When missing | Gate before save |
| --- | --- | --- | --- |
| productType | longest substring of the configured product types (`سایر` excluded) | `''` → the segment is dropped unless it has qty/pages/paper | ask "برای چه محصولی؟" |
| size (قطع) | substring of `TRIM_SIZES` keys (وزیری، رقعی، رحلی، خشتی، جیبی، پالتویی، A3–A5، B5) | falls back to two numbers `≤60` split by `× / x / * / در` as custom size | `analyzeItem` errors: «قطع محصول مشخص نیست» |
| pages | `(\d+)\s*(صفحه\|ص…)` on the numeric copy | for a book: `analyzeItem` errors; for a flat job it is unused | confirm aloud value digit by digit |
| qty (تیراژ) | `تیراژ\|شمارگان\|تعداد` + digits; else a number followed by `نسخه\|عدد` (preferred) or `برگه\|برگ\|جلد\|دست\|بسته\|تا`; else `…هزار`. The unit must be followed by **a non-letter** (`(?!\p{L})`), not by "outside the Arabic Unicode block" — ASR text closes every phrase with the Persian comma `،` (U+060C), and an end-of-block lookahead silently rejects it and falls through to the `…هزار` guess | `analyzeItem` errors: «شمارگان وارد نشده» | if it came from `برگ`/`برگه` a confirmation note is emitted — never drop it |
| text paper kind | substring of `PAPER_KINDS` | `''`; stock lookup then just matches the category | ask; do not let a generic stock row absorb the job |
| text gsm | `(\d{2,3})\s*(گرم\|گرمی\|g\|gr)` on the numeric copy, or the 2–3 digits right after the kind | `analyzeItem` errors: «گرماژ کاغذ مشخص نیست» | ask |
| print colours | digits `1–5` + `رنگ` — **note: `3` is returned as `4`**; `تمام رنگی/چهار رنگ/cmyk/فول کالر`→4, `دو رنگ`→2, `تک رنگ/یک رنگ/مشکی/سیاه`→1, bare `رنگی`→4 | `analyzeItem` uses **1 colour**; a note is emitted when the word `رنگ` appeared but nothing matched | owner decision (OPEN-03): what «سه رنگ» and Pantone mean for plate count and price |
| sides | `یک رو/تک رو/یکرو`→1, `دو رو/دورو/پشت و رو/رو و پشت`→2 | for a book `analyzeItem` forces 2; flat jobs default to 1 | confirm for flat jobs |
| cover vs body split | positions of `جلد`, `داخل|متن`, `صحافی` slice the sentence | everything lands in the body read, cover stays disabled | if the job mentions `جلد` but no cover attributes were captured, ask |
| cover gsm | same as text gsm inside the cover slice | defaults to `calc.defaultCoverGsm` (250) **with a warning** | show the assumed 250 in the form |
| lamination | word `سلفون` present → `مات` if `مات|سافت` else **`براق`** | no lamination line at all | UV / موضعی / برجسته are not parsed — must be entered manually |
| binding | `گالینگور|جلد سخت`، `شومیز|چسب گرم|چسبی`، `سیمی|فنری|مفتولی|منگنه`، `جعبه` | `''` → the binding line disappears from the estimate silently | ask; a book without binding is not a finished order |
| print method | `دیجیتال` else `افست|آفست` | `''`; `suggestMethod` proposes دیجیتال ≤400 sheets, افست at ≥500 copies or >400 sheets | operator confirms the machine, then zinc maths follows the press label |
| services | exact substrings of configured service types | none added | gold foil / embossing wording may need manual entry |
| stock match | `findPaper` by category + gsm + kind, preferring the customer's own stock then positive stock | warning «کاغذ … در انبار پیدا نشد» and **sheet size assumed 70×100** | the assumed sheet size changes form count and zinc count — confirm |
| rounding | pages rounded up to a multiple of 4 with a warning; binding forms have a floor of 10; make-ready is `calc.makeReadyPerForm` (default 100) per form, prorated per copy for books | — | matches the shop rules for رحلی only for some cuts — OPEN-05 |
| rates | `calc.printRatePer1000`, `cellophaneRate`, `bindingRates`, `plateCostFallback`, `digitalRatePerSide` default to `0` | the line is added with amount `0` and a parenthesised note | an estimate containing a zero-rate line is not a quotable price |
| money authority | renderer `estimateCost` → advisory; backend `calculateQuote` → saved | — | only manager/finance can save; markup applies to services only |

## Intake hazards specific to dictated text

1. Hesitation and self-correction (`نه، دو هزار و پانصد`) — the first number can be picked up instead of the corrected one. Keep the transcript editable and show every captured number.
2. `برگ` = sheet and `برگه` = leaf; `ورق` = sheet. Neither is a copy count.
3. `یک` is both the article "a" and the number 1; `دو رنگ` is a colour count, not a quantity. Colour/binding wording is therefore read from the un-converted text.
4. Machine names (`هایدلبرگ SM72`, `GTO`, `دو ورقی`, `چهار و نیم ورقی`) decide the zinc maths via `pressLabelFor`; an unrecognised name falls back to the size bucket, which changes plate counts.
5. Customer requests composed by `CustomerRequestForm` use the labels `محصول/تعداد/مشخصات/موعد پیشنهادی/شماره تماس` — the parser must keep reading `تعداد`, otherwise the request loses its quantity when it becomes an order.
