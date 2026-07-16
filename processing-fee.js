(function exposeProcessingFee(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BH_PROCESSING_FEE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createProcessingFeeApi() {
  "use strict";

  const RATE_NUMERATOR = 29;
  const RATE_DENOMINATOR = 1000;
  const FIXED_FEE_CENTS = 30;

  function calculateProcessingFeeCents(subtotalCents) {
    const subtotal = Number(subtotalCents);
    if (!Number.isSafeInteger(subtotal) || subtotal < 0) {
      throw new TypeError("Processing-fee subtotal must be a non-negative integer number of cents");
    }
    if (subtotal === 0) return 0;
    return Math.round(subtotal * RATE_NUMERATOR / RATE_DENOMINATOR) + FIXED_FEE_CENTS;
  }

  function calculateProcessingFeeDollars(subtotalDollars) {
    const subtotal = Number(subtotalDollars);
    if (!Number.isFinite(subtotal) || subtotal < 0) {
      throw new TypeError("Processing-fee subtotal must be a non-negative dollar amount");
    }
    return calculateProcessingFeeCents(Math.round(subtotal * 100)) / 100;
  }

  return Object.freeze({
    RATE_NUMERATOR,
    RATE_DENOMINATOR,
    FIXED_FEE_CENTS,
    calculateProcessingFeeCents,
    calculateProcessingFeeDollars
  });
});
