const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  RATE_NUMERATOR,
  RATE_DENOMINATOR,
  FIXED_FEE_CENTS,
  calculateProcessingFeeCents,
  calculateProcessingFeeDollars
} = require("../processing-fee");

const cases = [
  [0, 0],
  [1, 30],
  [100, 33],
  [1000, 59],
  [10000, 320]
];

cases.forEach(([subtotalCents, expectedFeeCents]) => {
  assert.strictEqual(calculateProcessingFeeCents(subtotalCents), expectedFeeCents);
});

const multipleItemSubtotalCents = (2500 * 2) + 100 + (4500 * 3);
const multipleItemExpected = Math.round(multipleItemSubtotalCents * RATE_NUMERATOR / RATE_DENOMINATOR) + FIXED_FEE_CENTS;
assert.strictEqual(calculateProcessingFeeCents(multipleItemSubtotalCents), multipleItemExpected);
assert.strictEqual(calculateProcessingFeeCents(10000) - Math.round(10000 * RATE_NUMERATOR / RATE_DENOMINATOR), FIXED_FEE_CENTS);
assert.strictEqual(calculateProcessingFeeDollars(10), 0.59);
assert.strictEqual(calculateProcessingFeeDollars(100), 3.20);
assert.throws(() => calculateProcessingFeeCents(-1), /non-negative integer/);
assert.throws(() => calculateProcessingFeeCents(1.5), /non-negative integer/);

const root = path.join(__dirname, "..");
const stripeSource = fs.readFileSync(path.join(root, "api", "_stripe-checkout.js"), "utf8");
const zeroDollarSource = fs.readFileSync(path.join(root, "api", "create-order.js"), "utf8");
const residentSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const checkoutSource = fs.readFileSync(path.join(root, "checkout.html"), "utf8");
const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
const managementSource = fs.readFileSync(path.join(root, "management", "dashboard.html"), "utf8");
const sharedHelperSource = fs.readFileSync(path.join(root, "processing-fee.js"), "utf8");

const browserContext = {};
vm.createContext(browserContext);
vm.runInContext(sharedHelperSource, browserContext);
assert.strictEqual(browserContext.BH_PROCESSING_FEE.calculateProcessingFeeDollars(10), 0.59);
assert.strictEqual(browserContext.BH_PROCESSING_FEE.calculateProcessingFeeDollars(100), 3.20);

assert(stripeSource.includes("calculateProcessingFeeCents(subtotalCents)"));
assert(zeroDollarSource.includes("calculateProcessingFeeCents(subtotalCents)"));
assert(!stripeSource.includes("PROCESSING_FEE_PERCENT"));
assert(!zeroDollarSource.includes("PROCESSING_FEE_PERCENT"));
assert(!stripeSource.includes("body.processingFee"));
assert(!stripeSource.includes("body.totalCents"));
assert(stripeSource.includes('appendLineItem(params, checkout.accounting.length, "Processing Fee", checkout.processingFeeCents, 1)'));
assert(stripeSource.includes("processing_fee_cents:checkout.processingFeeCents"));
assert(stripeSource.includes("total_cents:checkout.totalCents"));
assert(stripeSource.includes("Number(session.amount_total || 0) !== Number(existing.total_cents || 0)"));
assert(residentSource.includes("BH_PROCESSING_FEE.calculateProcessingFeeDollars"));
assert(residentSource.includes('$("#checkoutFeeLabel").textContent = t("cart.processingFee")'));
assert(!residentSource.includes("feeSettings.amount}%"));
assert(checkoutSource.includes('data-i18n="cart.processingFee">Processing Fee</span>'));
assert(!checkoutSource.includes("2.9%"));
assert(!checkoutSource.includes("$0.30"));
assert(!checkoutSource.toLowerCase().includes("surcharge"));
assert(checkoutSource.indexOf("processing-fee.js") < checkoutSource.indexOf("app.js"));
assert(indexSource.indexOf("processing-fee.js") < indexSource.indexOf("app.js"));
assert(managementSource.includes('value="2.9% + $0.30 per order" readonly'));
assert(!managementSource.includes('id="feeSettingsForm"'));
assert(!managementSource.includes("Save processing fee"));

process.stdout.write(`${JSON.stringify({
  formula:"round(subtotalCents * 29 / 1000) + 30 for positive subtotals",
  cases:cases.map(([subtotalCents, feeCents]) => ({subtotalCents, feeCents})),
  multipleItemSubtotalCents,
  multipleItemFeeCents:multipleItemExpected,
  browserAndServerUseSharedHelper:true,
  browserSuppliedFeeIsNotAuthoritative:true
}, null, 2)}\n`);
