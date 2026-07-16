"use strict";

const fs = require("fs");
const path = require("path");
const {
  validateReportPeriod,
  createReportId,
  buildFinancialReportModel,
  assertFinancialReportModel,
  generateFinancialReportPdf
} = require("../server/financial-report");

const FAKE_RESIDENTS = [
  ["Alex Example", "TEST-1201"],
  ["Jordan Sample Resident", "TEST-2307"],
  ["Morgan Demonstration", "TEST-3412"],
  ["Taylor Long-Name Layout Verification Resident", "TEST-PH99"]
];

const FAKE_PRODUCTS = [
  {id:"test-key", resident:"Mailbox Key Copy", internal:"Mailbox Key Copy GL-40090", gl:"40090", unitPriceCents:100},
  {id:"test-filter", resident:"Smoke Detector Battery Replacement", internal:"Smoke Detector Battery Replacement GL-40090", gl:"40090", unitPriceCents:2500},
  {id:"test-valet", resident:"Valet Service Subscription", internal:"Monthly Valet Service GL-40033", gl:"40033", unitPriceCents:25000},
  {id:"test-long", resident:"Extra Long Synthetic Product Name for Wrapping and Pagination Verification", internal:"Synthetic Internal Accounting Description for Layout Verification GL-40090", gl:"40090", unitPriceCents:4500}
];

function makeFakeOrders() {
  const orders = [];
  for (let index = 0; index < 36; index += 1) {
    const [residentName, unitNumber] = FAKE_RESIDENTS[index % FAKE_RESIDENTS.length];
    const selected = index % 3 === 0
      ? [FAKE_PRODUCTS[index % FAKE_PRODUCTS.length], FAKE_PRODUCTS[(index + 2) % FAKE_PRODUCTS.length]]
      : [FAKE_PRODUCTS[index % FAKE_PRODUCTS.length]];
    const orderItems = selected.map((product, itemIndex) => {
      const itemQuantity = itemIndex === 0 && index % 5 === 0 ? 2 : 1;
      return {
        id:`00000000-0000-4000-8000-${String(index * 10 + itemIndex).padStart(12, "0")}`,
        resident_name_snapshot:product.resident,
        internal_name_snapshot:product.internal,
        gl_code_snapshot:product.gl,
        quantity:itemQuantity,
        unit_price_cents:product.unitPriceCents,
        created_at:`2026-07-${String((index % 28) + 1).padStart(2, "0")}T14:0${itemIndex}:00.000Z`
      };
    });
    const subtotalCents = orderItems.reduce((sum, item) => sum + item.quantity * item.unit_price_cents, 0);
    const processingFeeCents = Math.round(subtotalCents * 0.03);
    const historicalReference = `BH-07${String((index % 28) + 1).padStart(2, "0")}2025-SYNTHETIC-${String(index + 1).padStart(4, "0")}`;
    orders.push({
      id:`10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      order_number:index % 9 === 0 ? historicalReference : `BH-${String(index + 2).padStart(5, "A")}`,
      resident_name:residentName,
      unit_number:unitNumber,
      subtotal_cents:subtotalCents,
      processing_fee_cents:processingFeeCents,
      total_cents:subtotalCents + processingFeeCents,
      status:index % 4 === 0 ? "Completed" : "Received",
      payment_status:"Paid",
      payment_at:`2026-07-${String((index % 28) + 1).padStart(2, "0")}T16:30:00.000Z`,
      created_at:`2026-07-${String((index % 28) + 1).padStart(2, "0")}T16:00:00.000Z`,
      payment_provider:index % 9 === 0 ? "square" : "stripe",
      stripe_payment_intent_id:index % 9 === 0 ? null : `pi_test_financial_report_${String(index).padStart(8, "0")}`,
      stripe_checkout_session_id:index % 9 === 0 ? null : `cs_test_financial_report_${String(index).padStart(8, "0")}`,
      payment_processor_reference:index % 9 === 0 ? `synthetic_historical_reference_${String(index).padStart(8, "0")}` : null,
      square_payment_id:null,
      order_items:orderItems
    });
  }
  return orders;
}

async function main() {
  const outputArgument = process.argv.indexOf("--output");
  const outputPath = outputArgument >= 0 && process.argv[outputArgument + 1]
    ? path.resolve(process.argv[outputArgument + 1])
    : path.join(__dirname, "generated", "financial-report-preview.pdf");
  const period = validateReportPeriod({periodType:"monthly", startDate:"2026-07-01", endDate:"2026-07-31"});
  const model = buildFinancialReportModel({
    orders:makeFakeOrders(),
    period,
    zeroDollarOrderCount:3,
    reportId:createReportId(new Date("2026-07-16T16:30:00.000Z")),
    generatedAt:new Date("2026-07-16T16:30:00.000Z")
  });
  assertFinancialReportModel(model);
  const pdf = await generateFinancialReportPdf(model);
  fs.mkdirSync(path.dirname(outputPath), {recursive:true});
  fs.writeFileSync(outputPath, pdf);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    bytes:pdf.length,
    reportId:model.reportId,
    paidOrders:model.totals.orderCount,
    transactionLines:model.totals.lineCount,
    grossCents:model.totals.grossCents,
    feeCents:model.totals.feeCents,
    netCents:model.totals.netCents,
    glGrossCents:model.glSummary.reduce((sum, row) => sum + row.grossCents, 0),
    glFeeCents:model.glSummary.reduce((sum, row) => sum + row.feeCents, 0),
    glNetCents:model.glSummary.reduce((sum, row) => sum + row.netCents, 0)
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`Financial report preview failed: ${error.message}\n`);
  process.exitCode = 1;
});
