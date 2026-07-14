const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {Resend} = require("resend");
const {buildResidentEmail, buildManagementEmail} = require("../api/order-emails");

const USAGE = "Usage: npm run send:test-email -- you@example.com";
const BLOCKED_PRODUCTION_RECIPIENTS = new Set([
  "admin@brickellhouse.net",
  "frontdesk@brickellhouse.net",
  "orders@brickellhouse.org"
]);

const syntheticOrder = Object.freeze({
  paymentId:"pi_local_email_test_only",
  paymentReference:"pi_local_email_test_only",
  orderNumber:"BH-TEST-1001",
  residentName:"Test Resident",
  unit:"TEST-000",
  email:"test@example.invalid",
  phone:"305-555-0100",
  items:[
    {name:"Mailbox Key Copy",quantity:2,unitPriceCents:100},
    {name:"AC Drain Line Cleaning",quantity:1,unitPriceCents:4500},
    {name:"Monthly Valet Service",quantity:2,unitPriceCents:7500}
  ],
  managementItems:[
    {name:"Mailbox Key Copy GL-40090",quantity:2,unitPriceCents:100},
    {name:"AC Drain Line Cleaning GL-40090",quantity:1,unitPriceCents:4500},
    {name:"Monthly Valet Service GL-40033",quantity:2,unitPriceCents:7500}
  ],
  subtotalCents:19700,
  processingFeeCents:591,
  totalCents:20291,
  paymentMethod:"Stripe test display",
  status:"Received",
  legalNoticeVersion:"TEST-ONLY",
  legalAcceptedAt:"2026-07-14T14:29:00.000Z",
  createdAt:"2026-07-14T14:30:00.000Z"
});

function validRecipient(value) {
  const address = String(value || "").trim().toLowerCase();
  return /^[^\s@<>,;:]+@[^\s@<>,;:]+\.[^\s@<>,;:]+$/.test(address)
    && !BLOCKED_PRODUCTION_RECIPIENTS.has(address);
}

function loadResendApiKey() {
  const configured = String(process.env.RESEND_API_KEY || "").trim();
  if (configured) return configured;
  if (typeof process.loadEnvFile !== "function") return "";

  for (const filename of [".env.local", ".env"]) {
    const candidate = path.join(__dirname, "..", filename);
    if (!fs.existsSync(candidate)) continue;
    process.loadEnvFile(candidate);
    const loaded = String(process.env.RESEND_API_KEY || "").trim();
    if (loaded) return loaded;
  }
  return "";
}

function testEnvelope(email, recipient, subject) {
  return {
    from:email.from,
    to:recipient,
    subject,
    html:email.html,
    text:email.text
  };
}

async function sendOne(resend, email, idempotencyKey) {
  try {
    const result = await resend.emails.send(email, {idempotencyKey});
    return !result?.error;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !validRecipient(args[0])) {
    console.error(USAGE);
    console.error("Provide one personal test inbox; production BrickellHouse operational addresses are blocked.");
    process.exitCode = 1;
    return;
  }

  const recipient = args[0].trim();
  let apiKey = "";
  try {
    apiKey = loadResendApiKey();
  } catch {
    console.error("Unable to read the local Resend configuration. No email was sent.");
    process.exitCode = 1;
    return;
  }

  if (!apiKey) {
    console.error("RESEND_API_KEY is not configured locally. No email was sent.");
    process.exitCode = 1;
    return;
  }

  const resident = testEnvelope(
    buildResidentEmail(syntheticOrder),
    recipient,
    "[TEST] BrickellHouse Resident Order Confirmation"
  );
  const management = testEnvelope(
    buildManagementEmail(syntheticOrder),
    recipient,
    "[TEST] BrickellHouse Management New Order"
  );
  const runId = crypto.randomUUID();
  const resend = new Resend(apiKey);
  const [residentSent, managementSent] = await Promise.all([
    sendOne(resend, resident, `brickellhouse-local-test-resident-${runId}`),
    sendOne(resend, management, `brickellhouse-local-test-management-${runId}`)
  ]);

  console.log(`Resident test: ${residentSent ? "sent" : "failed"}`);
  console.log(`Management test: ${managementSent ? "sent" : "failed"}`);
  if (!residentSent || !managementSent) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(() => {
    console.error("Test email delivery failed. No secret information was printed.");
    process.exitCode = 1;
  });
}

module.exports = {syntheticOrder,validRecipient,testEnvelope};
