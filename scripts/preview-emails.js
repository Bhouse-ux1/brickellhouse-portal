const fs = require("fs");
const path = require("path");
const {buildResidentEmail, buildManagementEmail} = require("../api/order-emails");

const outputDirectory = path.join(__dirname, "email-previews");
const fixture = Object.freeze({
  paymentId:"pi_preview_only",
  orderNumber:"BH-PREVIEW-1042",
  residentName:"Avery Example",
  unit:"1204",
  email:"resident@example.invalid",
  phone:"+1 305 555 0100",
  items:[
    {name:"Mailbox Key Copy",quantity:2,unitPriceCents:100},
    {name:"AC Drain Line Cleaning",quantity:1,unitPriceCents:4500}
  ],
  managementItems:[
    {name:"Mailbox Key Copy GL-40090",quantity:2,unitPriceCents:100},
    {name:"AC Drain Line Cleaning GL-40090",quantity:1,unitPriceCents:4500}
  ],
  subtotalCents:4700,
  processingFeeCents:141,
  totalCents:4841,
  paymentMethod:"Stripe",
  status:"Received",
  createdAt:"2026-07-14T14:30:00.000Z"
});

function assert(condition, message) {
  if (!condition) throw new Error(`Email preview safety check failed: ${message}`);
}

function writePreview(name, email) {
  fs.writeFileSync(path.join(outputDirectory, `${name}.html`), email.html, "utf8");
  fs.writeFileSync(path.join(outputDirectory, `${name}.txt`), email.text, "utf8");
}

function run() {
  fs.mkdirSync(outputDirectory, {recursive:true});

  const resident = buildResidentEmail(fixture);
  const management = buildManagementEmail(fixture);
  const zeroDollar = buildResidentEmail({
    ...fixture,
    items:[{name:"Thermostat Replacement",quantity:1,unitPriceCents:0}],
    managementItems:[{name:"Thermostat Replacement GL-40090",quantity:1,unitPriceCents:0}],
    subtotalCents:0,
    processingFeeCents:0,
    totalCents:0,
    paymentMethod:"No payment required",
    paymentStatus:"No Payment Required"
  });
  const unsafeMarkup = "<img src=x onerror=alert('x')>";
  const injectionOrder = {
    ...fixture,
    orderNumber:unsafeMarkup,
    residentName:unsafeMarkup,
    unit:unsafeMarkup,
    email:`resident+${unsafeMarkup}@example.invalid`,
    phone:unsafeMarkup,
    items:[{name:unsafeMarkup,quantity:1,unitPriceCents:100}],
    managementItems:[{name:`${unsafeMarkup} GL-40090`,quantity:1,unitPriceCents:100}]
  };
  const residentInjection = buildResidentEmail(injectionOrder);
  const managementInjection = buildManagementEmail(injectionOrder);

  assert(!/GL[-\s]?40090|internal name|accounting/i.test(`${resident.html}\n${resident.text}`), "resident output contains internal accounting data");
  assert(/GL 40090/.test(`${management.html}\n${management.text}`), "Management output is missing the authorized GL code");
  assert(/Mailbox Key Copy GL-40090/.test(`${management.html}\n${management.text}`), "Management output is missing the internal accounting name");
  assert(!residentInjection.html.includes("<img"), "resident dynamic HTML was not escaped");
  assert(!managementInjection.html.includes("<img"), "Management dynamic HTML was not escaped");
  assert(resident.text.includes("Subtotal:") && resident.text.includes("Processing Fee:") && resident.text.includes("Total Paid:"), "resident plain text is incomplete");
  assert(management.text.includes("Next Action"), "Management plain text is incomplete");
  assert(!/payment (has been )?confirmed|payment status: paid|total paid/i.test(`${zeroDollar.html}\n${zeroDollar.text}`), "zero-dollar wording incorrectly implies payment");
  assert(/Order Received|order has been received/.test(`${zeroDollar.html}\n${zeroDollar.text}`), "zero-dollar wording is missing an order-received state");

  writePreview("resident-paid-order", resident);
  writePreview("management-paid-order", management);
  console.log(`Generated email previews in ${outputDirectory}`);
}

run();
