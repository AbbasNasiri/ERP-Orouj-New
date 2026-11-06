# Rate register (working numbers, not market-verified)

Source: the owner's own notes «اصلاحات 6/7», ۲۰۲۶-۱۰-۲۲. Amounts in تومان. Status column is what the code currently does, which is not always what the note says.

| Item | Working number | Where it lives | Status |
| --- | --- | --- | --- |
| Zinc (plate), 2-up press | 2,000,000 per sheet, both colours priced per pass | litho unit tariff | owner-stated; needs versioned tariff entry, not a literal |
| Offset print, text | 2,000,000 per zinc sheet per block up to 5000 sheets | `offsetPrintCost({ plates, run, ratePerBlock, blockSize: 5000 })` | in engine; block mode above 5000 undecided (OPEN-03) |
| Offset print, cover 4-colour on 250g board | 10,000,000 flat for 1–5000 sheets | cover line in the quote | owner-stated flat rate; must be a parameter |
| Hot-melt binding (شومیز) | 2,000 per 8-page form × copies, floor of 10 forms | `calc.bindingRates` + `analyzeItem` bindingForms | floor implemented; per-form rate is a tariff |
| Lamination (سلفون) | (cover length × cover width ÷ 100) × rate × tirage | `analyzeItem` coverArea100 + `cellophaneRate` | basis differs from the note: code uses the printed sheet area, the note uses the cover blank (۵۰×۳۵). Confirm (OPEN-05) |
| Text paper | band = 500 sheets; day price per band incl. freight and merchant margin | inventory `unitMode: band_sheet` | code sells at `unitValue`; the note warns the *warehouse book value* is not the selling rate |
| Cover board | 100×70 sheet → 4 covers; priced per kg when the customer brings none | `paperQty` roll_kg conversion | in code |
| Make-ready / waste | +100 sheets per form; +100 text and +200 cover copies for laminate+binding jobs | `calc.makeReadyPerForm`, `coverMakeReady` | note allows +100/+200 as job-specific; defaults are 100/0 |
| Form completeness | رحلی on a 2-up press: only whole forms or a half (4-page) remainder; رقعی/وزیری also allow 0.25/0.75 | `analyzeItem` rounds pages up to a multiple of 4 | only the 4-page rule exists (OPEN-05) |
| Profit | 20% or 30% on services only | `serviceMarkupPercent` | rate is per quote, not yet per service (OPEN-04) |
| VAT / formal invoice | 10% added when a formal invoice is requested | `taxPercent` | parameter only; legal basis unverified (OPEN-11) |
| Free offer (cutting, packing, shipping) | charged 0 to the customer, internal cost recorded | `offers[].internalCost` | in engine |

## Form and plate maths the engine reproduces

For the reference book (400 pages, رحلی, 2-colour text, 2-up press, 4-colour cover):

```
pagesRounded  = ceil(400 / 4) * 4          = 400
press pages   = 4 per side × 2 sides       = 8 per form
full forms    = 400 / 8                    = 50      → 50 × 2 plates = 100
zinc per colour                            = 200 sheets   (text)
zinc, cover                               = 4 sheets     (4-colour, 2-up)
binding forms = 400/8 + 1 cover            = 51
text paper    = 400/16 × (2000 + 100) / 500 = 105 bands
cover board   = (2000 + 200) / 4            = 550 sheets
```

Machine sheet sizes used for plate maths: `GTO 35×50`, `2 ورقی 50×70`, `4.5 ورقی 70×100`; a press label is derived from the machine name in `pressLabelFor`, and the zinc count follows it, so a mis-named machine silently changes the price.

## Weekly review job (requested, not built)

Owner's rule: «این اعداد ۲ میلیون رو باید هر هفته طبق عرف بازار محاسبه کنیم» — a Saturday check against the price sources he listed (naghshealmas, chapez, pishgamdp, chapdana, irankohan, hamchap; paper rates: piconweb, chapazon, iranpapernet). Constraints for whoever builds it: read-only browsing, a proposal diff for approval, no automatic write to rates, and every change versioned with effective date and who approved it.

## Questions that block exact pricing

1. «سه رنگ» — three plates, or four (CMYK minus one)? The current offline reader treats a digit `3` as 4 and an unknown colour word as needing confirmation.
2. Pantone / «رنگ ساختگی» — surcharge per plate or per pass? Not modelled.
3. Above 5000 sheets — proportional or per begun block? The engine refuses to guess.
4. Lamination basis — printed sheet area or cover blank?
5. When is a job "finished" for issuing the final invoice (OPEN-07)?
6. Who may approve a tariff change and what is the ceiling for outsourcing a stage (OPEN-02, OPEN-04, OPEN-06)?
