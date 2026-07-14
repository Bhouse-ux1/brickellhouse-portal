const fs = require("fs");
const path = require("path");
const {buildResidentEmail, buildManagementEmail} = require("../api/order-emails");

const outputDirectory = path.join(__dirname, "email-previews");
const productionLogoUrl = "https://portal.brickellhouse.org/bh-logo-transparent.png";
const localPreviewLogoUrl = "../../bh-logo-transparent.png";
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

function localPreviewHtml(email, simulateAutomaticDarkMode = false) {
  const darkModeSimulation = simulateAutomaticDarkMode
    ? `
  <!-- Preview-only approximation of automatic client inversion. This is not sent in production email. -->
  <style id="preview-auto-dark-simulation">
    html{background-color:#000000!important}
    body{filter:invert(1) hue-rotate(180deg)}
  </style>`
    : "";

  return email.html
    .replace(productionLogoUrl, localPreviewLogoUrl)
    .replace("<head>", "<head>\n  <!-- Local preview uses the checked-in logo; sent email uses the production asset URL. -->")
    .replace("</head>", `${darkModeSimulation}\n</head>`)
    .replace(/[ \t]+$/gm, "");
}

function writePreview(name, email) {
  const localHtml = localPreviewHtml(email);
  const darkHtml = localPreviewHtml(email, true);
  fs.writeFileSync(path.join(outputDirectory, `${name}.html`), localHtml, "utf8");
  fs.writeFileSync(path.join(outputDirectory, `${name}-dark.html`), darkHtml, "utf8");
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
  assert(!/<img\b[^>]*onerror/i.test(residentInjection.html), "resident dynamic HTML was not escaped");
  assert(!/<img\b[^>]*onerror/i.test(managementInjection.html), "Management dynamic HTML was not escaped");
  assert((resident.html.match(/<img\b/g) || []).length === 1, "resident email should contain only the approved logo image");
  assert((management.html.match(/<img\b/g) || []).length === 1, "Management email should contain only the approved logo image");
  assert(resident.html.includes('src="https://portal.brickellhouse.org/bh-logo-transparent.png"'), "resident email is missing the approved production logo URL");
  assert(management.html.includes('src="https://portal.brickellhouse.org/bh-logo-transparent.png"'), "Management email is missing the approved production logo URL");
  assert(resident.html.includes('<meta name="color-scheme" content="light dark">'), "supported color-scheme metadata is missing");
  assert(resident.html.includes(":root{color-scheme:light dark;supported-color-schemes:light dark}"), "supported color-scheme declaration is missing");
  assert(!resident.html.includes("prefers-color-scheme:dark") && !resident.html.includes("[data-ogsc]"), "sent email contains a forced custom dark theme");
  assert(!/class="brand-logo"[^>]*style="[^"]*(?:background-color|padding:)/i.test(resident.html), "logo still has a boxed background or padding tile");
  assert(/class="item-head"[^>]*bgcolor="#111111"/.test(resident.html), "order table is missing its resilient black header");
  assert(/class="[^"]*footer-surface[^"]*"[^>]*bgcolor="#111111"/.test(resident.html), "footer is missing its resilient black surface");
  assert(resident.html.includes("@media screen and (max-width:600px)") && resident.html.includes(".email-wrap{width:100%!important}"), "320px mobile fallback rules are missing");
  assert(localPreviewHtml(resident, true).includes('id="preview-auto-dark-simulation"'), "simulated automatic-dark preview is missing");
  assert(/class="brand-highlight"[^>]*background-color:#a68b54/.test(resident.html), "static brand highlight fallback is missing");
  assert(resident.html.includes("@keyframes brand-highlight") && resident.html.includes("prefers-reduced-motion:reduce"), "progressive brand highlight safeguards are missing");
  assert(resident.text.includes("Subtotal:") && resident.text.includes("Processing Fee:") && resident.text.includes("Total Paid:"), "resident plain text is incomplete");
  assert(management.text.includes("Next Action"), "Management plain text is incomplete");
  assert(!/Order Status|Management Processing|Ready \/ Completed|Payment Confirmed/.test(resident.html), "resident status timeline was not fully removed");
  assert(!/Payment Status:/.test(resident.text), "resident plain text still contains a payment-status line");
  assert(/<h1[^>]*>New Order<\/h1>/.test(management.html), "Management visible heading is not New Order");
  assert(management.text.startsWith("New Order\n"), "Management plain-text heading is not New Order");
  assert(resident.html.includes("Management will contact you once your order is ready."), "resident next-step wording is incorrect");
  assert(resident.text.includes("Management will contact you once your order is ready."), "resident plain-text next-step wording is incorrect");
  assert(resident.html.includes("305-400-9661") && resident.html.includes("Extension 7002"), "Management phone or extension is incorrect");
  assert(resident.html.includes("Extension 7000") && resident.text.includes("Extension 7000"), "Front Desk extension changed unexpectedly");
  assert(resident.text.includes("Extension 7002"), "Management extension is missing from resident plain text");
  assert(!/payment (has been )?confirmed|payment status: paid|total paid/i.test(`${zeroDollar.html}\n${zeroDollar.text}`), "zero-dollar wording incorrectly implies payment");
  assert(/Order Received|order has been received/.test(`${zeroDollar.html}\n${zeroDollar.text}`), "zero-dollar wording is missing an order-received state");

  writePreview("resident-paid-order", resident);
  writePreview("management-paid-order", management);
  console.log(`Generated email previews in ${outputDirectory}`);
}

run();
