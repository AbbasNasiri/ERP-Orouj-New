---
name: printshop-voice-intake
description: Precision rules for the print-shop order intake chain (Persian voice → text → structured order form). Use when working on voice input, speech-to-text wiring, parseOrderText/extractItems, order-field extraction, or when a transcribed quantity, page count, grammage or print-colour count must reach the order form without being guessed.
when_to_use: Changing src/smart.js, src/smartorder.js, CustomerRequestForm.jsx, the offline ASR engine, or any field the customer dictates.
argument-hint: "<phrase or file to check>"
---

# Print-shop voice intake

## Overview

Guarantees one property: **a dictated order reaches the form with the shop owner's numbers, and anything unreadable is asked, never guessed.** Text understanding is rule-based and offline; the ASR engine is a separate concern and is not installed yet.

Project root default: `C:/Users/LianTech/Desktop/print-shop-desktop-v1.9-secure/print-shop-desktop`. Read `docs/requirements-fa.md` (business rules) and `docs/offline-voice-fa.md` (ASR options) before changing behaviour — they are the source of truth, not this skill.

## The chain and its real status

```
voice ──(1)──> Persian text ──(2)──> parsed fields ──(3)──> line item + analysis ──(4)──> priced quote (backend)
 NOT INSTALLED    parseOrderText      applyParsedToItem      calculateQuote / save_quote
                  extractItems        analyzeItem            (manager or finance only)
```

| Link | State |
| --- | --- |
| (1) audio → text | No model, no mic code, nothing wired. Do not describe it as available. |
| (2) text → fields | `parseOrderText` (offline rules) and `aiExtract` (online, falls back to offline on failure). |
| (3) fields → item | `applyParsedToItem` then `analyzeItem`; missing hard fields produce errors, some missing fields produce **silent defaults** (see contract). |
| (4) → money | Only backend `electron/pricing.js` results are saved; renderer `estimateCost` is advisory. |

## Non-negotiable rules

1. **Never invent a number.** Unknown field = empty + a question to the user. A blank must never become `0`, `1` or a default price on its own.
2. **Spoken digits are first-class.** `wordsToDigits` converts Persian numeral words (including `هزار`, `میلیون`, `میلیارد` compounds) before numeric reads. Colour and binding wording are read from the **original** text so this conversion cannot change them.
3. **Confirmation questions ride on `parsed.notes`** and reach the operator through `offlineQuestions` → `extractItems().questions`. That channel is how the UI shows "تأیید کنید". Add new warnings there, not in a new field.
4. **ASR text is shown editable before extraction** and the important numbers (تیراژ، صفحات، گرماژ، ابعاد، رنگ، مبلغ) are re-displayed individually before saving. No auto-save from voice.
5. **Offline means offline.** A failed local engine must show an error and allow typing. Never fall back to any cloud speech or text service.
6. After any intake change run `node scripts/intake-probe.mjs`, `npm test`, and the rig self-test `node tests/voice/run.mjs --corpus=tests/voice/corpus/manifest.example.json --engine=human --strict` in the project. All must stay green; a new phrase class needs a fixture case.

## Known silent behaviours to guard against

`references/field-contract.md` lists every field, how it is read, and what happens when it is missing. The dangerous ones:

- Missing colour count makes `analyzeItem` price the job as **one colour**; a note is now raised, the price is not fixed.
- `سه رنگ` is not recognised, and `۳ رنگ` (digits) is currently mapped to **4** plates — a business rule that needs the owner's decision (see OPEN-03).
- `برگ`/`برگه`/`ورق` can mean paper sheets, not copies; a quantity read from them is flagged for confirmation. Never remove that note.
- **A unit boundary is not "end of text".** ASR output closes each phrase with the Persian comma `،` (U+060C), which lives inside the Arabic Unicode block. A lookahead like `(?![\u0600-\u06FF])` therefore rejects «۲۰۰ نسخه،» and the quantity silently falls through to the `…هزار` guess. Use `(?!\p{L})`. Any new unit-anchored numeric read needs the same shape, plus a comma-bearing fixture case.
- Missing rates (`printRatePer1000`, `cellophaneRate`, `bindingRates`, `plateCostFallback`) evaluate to `0` in the renderer estimate — the line looks priced but is zero.

## Measuring a speech engine (before anyone claims accuracy)

`tests/voice/` in the project is the measuring rig; `docs/voice-corpus-fa.md` is the recording protocol for the 30-shop-sample corpus. Rules that come from it:

- Judge an engine by **`فراخوانی اعدادِ واحددار` and `درستی فیلد`**, not by WER alone. A transcription that loses «پانصد» and keeps every other word is a perfect sentence and a wrong order.
- `expectedFields` (what the speaker actually asked for, read off the order form) is the criteria of record. Without it the rig falls back to parsing the human reference text, which measures the parser, not the speaker.
- The rig folds spoken numerals («دویست» ⇄ «۲۰۰») before WER so writing style does not look like a recognition error; CER still counts it, because the engine's own choice of notation is evidence.
- `--engine=human` is a self-test of the rig's maths only. It is not a speech measurement — never report its 0% WER as engine accuracy.
- `--engine=onnx` refuses to run without local weights and never reaches the network at test time; only the explicit `--allow-download` preparation step downloads, and it needs `NODE_OPTIONS=--use-system-ca`.
- No corpus audio is in the repository. Until real print-shop audio exists, every accuracy statement about ASR is an assumption, not a measurement.

## Working order for a new change

1. Add the phrase to `references/intake-fixtures.json` and run the probe → see it fail.
2. Change `parseOrderText` / `analyzeItem` minimally; keep old phrase classes passing.
3. Mirror the case in `tests/intake-offline.test.cjs`.
4. Report: which phrases changed, which stay ambiguous, and which business question is now blocking.

## Resources

- `references/field-contract.md` — field-by-field extraction contract with silent defaults and required gates.
- `references/intake-fixtures.json` — phrase set with expected fields (spoken numbers, customer-request text, ambiguous units).
- `scripts/intake-probe.mjs` — runs the fixtures through the real parser; `--root=<project>` overrides the project path.
