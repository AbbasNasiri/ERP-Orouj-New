'use strict';

// Pure quotation arithmetic. This module does not read stock, book values or tariffs.
// Rates and returned money are integer minor units of the caller's currency label.
// Fractional quantities/percentages are allowed. Round half up per line, markup,
// then tax; decimal inputs are evaluated as their decimal strings using BigInt.
const MAX_MONEY = BigInt(Number.MAX_SAFE_INTEGER);

function nonNegative(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite non-negative number`);
  }
  return value;
}

function integer(value, name) {
  nonNegative(value, name);
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be a safe integer`);
  return value;
}

function rejectInvalidNumbers(value, path = 'input', ancestors = new Set()) {
  if (typeof value === 'number') nonNegative(value, path);
  if (!value || typeof value !== 'object') return;
  if (ancestors.has(value)) throw new TypeError('Cyclic input is not supported');
  ancestors.add(value);
  for (const [key, child] of Object.entries(value)) {
    rejectInvalidNumbers(child, `${path}.${key}`, ancestors);
  }
  ancestors.delete(value);
}

function decimal(value, name) {
  nonNegative(value, name);
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const scale = fraction.length - Number(exponent);
  const numerator = BigInt(whole + fraction);
  return scale >= 0
    ? [numerator, 10n ** BigInt(scale)]
    : [numerator * 10n ** BigInt(-scale), 1n];
}

function money(value, name) {
  if (value < 0n || value > MAX_MONEY) throw new RangeError(`${name} exceeds safe integer money`);
  return Number(value);
}

function roundRatio(numerator, denominator, name) {
  return money((numerator * 2n + denominator) / (denominator * 2n), name);
}

function sum(values, name) {
  return money(values.reduce((total, value) => total + BigInt(value), 0n), name);
}

function percentOf(amount, percent, name) {
  const [numerator, denominator] = decimal(percent, name);
  return roundRatio(BigInt(amount) * numerator, denominator * 100n, name);
}

function lineItems(lines, materials) {
  if (!Array.isArray(lines)) throw new TypeError('Line items must be an array');
  return lines.map((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      throw new TypeError(`Line ${index} must be an object`);
    }
    const [qtyNumerator, qtyDenominator] = decimal(line.qty, `line ${index}.qty`);
    integer(line.rate, `line ${index}.rate`);
    if (materials && line.customerSupplied !== undefined && typeof line.customerSupplied !== 'boolean') {
      throw new TypeError('customerSupplied must be boolean');
    }
    const cost = materials && line.customerSupplied
      ? 0
      : roundRatio(qtyNumerator * BigInt(line.rate), qtyDenominator, `line ${index} cost`);
    // Return new objects and retain quantities even when customer supplies materials.
    return { ...line, ...(materials ? { consumedQty: line.qty } : {}), cost };
  });
}

/**
 * A full block is charged for any nonzero run up to blockSize, per plate.
 * Above one block the caller MUST select proportional or ceilBlocks. The former
 * prorates the entire run; the latter charges complete blocks. No market policy
 * is inferred. The result uses the same monetary unit as ratePerBlock.
 */
function offsetPrintCost({ plates, run, ratePerBlock, blockSize = 5000, mode } = {}) {
  rejectInvalidNumbers({ plates, run, ratePerBlock, blockSize });
  integer(plates, 'plates');
  integer(run, 'run');
  integer(ratePerBlock, 'ratePerBlock');
  integer(blockSize, 'blockSize');
  if (blockSize === 0) throw new RangeError('blockSize must be positive');
  if (mode !== undefined && !['proportional', 'ceilBlocks'].includes(mode)) {
    throw new TypeError('Unknown offset pricing mode');
  }
  if (run > blockSize && mode === undefined) {
    throw new RangeError('Runs above one block require an explicit pricing mode');
  }
  if (run === 0 || plates === 0) return 0;
  const base = BigInt(plates) * BigInt(ratePerBlock);
  if (run <= blockSize) return money(base, 'offset print cost');
  if (mode === 'ceilBlocks') {
    const blocks = (BigInt(run) + BigInt(blockSize) - 1n) / BigInt(blockSize);
    return money(base * blocks, 'offset print cost');
  }
  return roundRatio(base * BigInt(run), BigInt(blockSize), 'offset print cost');
}

/**
 * Markup is added only to service cost, never material cost. taxPercent is an
 * explicit parameter (default zero), not a statement of applicable tax law.
 * Offers are free customer services, NOT alternate markup scenarios. Their
 * optional internalCost is separate from sales totals; absent cost stays unknown.
 */
function calculateQuote(input = {}) {
  rejectInvalidNumbers(input);
  const {
    materials = [], services = [], serviceMarkupPercent = 0, taxPercent = 0,
    currency = 'IRR', offers = [], discount = 0,
  } = input;
  if (typeof currency !== 'string' || !currency.trim()) throw new TypeError('currency must be a nonempty string');
  nonNegative(serviceMarkupPercent, 'serviceMarkupPercent');
  nonNegative(taxPercent, 'taxPercent');
  integer(discount, 'discount');
  if (!Array.isArray(offers)) throw new TypeError('offers must be an array');
  const materialLines = lineItems(materials, true);
  const serviceLines = lineItems(services, false);
  const materialsCost = sum(materialLines.map(line => line.cost), 'materialsCost');
  const servicesCost = sum(serviceLines.map(line => line.cost), 'servicesCost');
  const baseCost = sum([materialsCost, servicesCost], 'baseCost');
  const offerLines = offers.map((offer, index) => {
    if (!offer || typeof offer !== 'object' || Array.isArray(offer)) throw new TypeError(`offer ${index} must be an object`);
    if (offer.customerCharge !== undefined && offer.customerCharge !== 0) {
      throw new TypeError('Offers must have zero customerCharge');
    }
    if (offer.qty !== undefined) nonNegative(offer.qty, `offer ${index}.qty`);
    if (offer.rate !== undefined) integer(offer.rate, `offer ${index}.rate`);
    if (offer.internalCost !== undefined) integer(offer.internalCost, `offer ${index}.internalCost`);
    return { ...offer, customerCharge: 0, internalCost: offer.internalCost ?? null };
  });
  const knownOffersInternalCost = sum(offerLines.map(offer => offer.internalCost ?? 0), 'knownOffersInternalCost');

  function totals(markupPercent) {
    const serviceMarkupAmount = percentOf(servicesCost, markupPercent, 'serviceMarkupAmount');
    const subtotal = sum([baseCost, serviceMarkupAmount], 'subtotal');
    if (discount > subtotal) throw new RangeError('discount exceeds subtotal');
    const discountedSubtotal = subtotal - discount;
    const taxAmount = percentOf(discountedSubtotal, taxPercent, 'taxAmount');
    return { serviceMarkupPercent: markupPercent, serviceMarkupAmount, subtotal, discount, discountedSubtotal, taxAmount,
      total: sum([discountedSubtotal, taxAmount], 'total') };
  }

  return {
    currency: currency.trim(), materials: materialLines, services: serviceLines,
    materialsCost, servicesCost, baseCost, taxPercent, ...totals(serviceMarkupPercent),
    offers: offerLines, knownOffersInternalCost,
    offersWithUnknownCost: offerLines.filter(offer => offer.internalCost === null).length,
  };
}

module.exports = { calculateQuote, offsetPrintCost, percentOf };
