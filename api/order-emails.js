const {Resend} = require("resend");

const SENDER = "BrickellHouse <orders@brickellhouse.org>";
const MANAGEMENT_RECIPIENT = "admin@brickellhouse.net";
const PORTAL_URL = "https://portal.brickellhouse.org/";
const CONTACTS = Object.freeze({
  managementEmail:"admin@brickellhouse.net",
  managementPhone:"305-400-9661",
  managementExtension:"7002",
  frontDeskEmail:"frontdesk@brickellhouse.net",
  frontDeskExtension:"7000"
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[character]);
}

function safeText(value, fallback = "") {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function cents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function money(value) {
  return new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(cents(value) / 100);
}

function dateTime(value) {
  const candidate = value ? new Date(value) : new Date();
  const date = Number.isNaN(candidate.getTime()) ? new Date() : candidate;
  return new Intl.DateTimeFormat("en-US", {
    timeZone:"America/New_York",month:"long",day:"numeric",year:"numeric",
    hour:"numeric",minute:"2-digit",timeZoneName:"short"
  }).format(date);
}

function normalizedItems(items) {
  return (Array.isArray(items) ? items : []).map(item => ({
    name:safeText(item?.name, "Order item"),
    quantity:Math.max(1, Math.round(Number(item?.quantity) || 1)),
    unitPriceCents:cents(item?.unitPriceCents)
  }));
}

function accountingDetails(value) {
  const name = safeText(value, "Internal name not provided");
  const match = name.match(/\bGL[-\s]?(\d{4,})\b/i);
  return {name, glCode:match ? match[1] : "Not provided"};
}

function normalizeOrder(order) {
  const items = normalizedItems(order?.items);
  const managementSource = normalizedItems(order?.managementItems || order?.items);
  const subtotalFromItems = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const totalCents = cents(order?.totalCents);
  const subtotalCents = order?.subtotalCents == null ? subtotalFromItems : cents(order.subtotalCents);
  const processingFeeCents = order?.processingFeeCents == null
    ? Math.max(0, totalCents - subtotalCents)
    : cents(order.processingFeeCents);
  const noPaymentRequired = totalCents === 0 || safeText(order?.paymentStatus).toLowerCase() === "no payment required";

  return {
    orderNumber:safeText(order?.orderNumber, "Not provided"),
    residentName:safeText(order?.residentName, "Resident"),
    unit:safeText(order?.unit, "Not provided"),
    email:safeText(order?.email, "Not provided"),
    phone:safeText(order?.phone, "Not provided"),
    paymentMethod:safeText(order?.paymentMethod, noPaymentRequired ? "No payment required" : "Stripe"),
    paymentReference:safeText(order?.paymentReference),
    legalNoticeVersion:safeText(order?.legalNoticeVersion),
    legalAcceptedAt:safeText(order?.legalAcceptedAt),
    status:safeText(order?.status, "Received"),
    createdAt:order?.createdAt,
    items,
    managementItems:managementSource.map((item, index) => ({
      ...item,
      residentName:items[index]?.name || "Order item",
      accounting:accountingDetails(item.name)
    })),
    subtotalCents,
    processingFeeCents,
    totalCents,
    noPaymentRequired
  };
}

function statusPresentation(order) {
  const status = order.status.toLowerCase();
  const completed = status === "completed";
  const ready = status.includes("ready");
  const processing = status === "processing";
  const cancelled = status === "cancelled" || status === "canceled";

  if (cancelled) {
    return {headline:"Order Update",label:"Unable to Complete",tone:"warning"};
  }
  if (completed) return {headline:"Order Completed",label:"Completed",tone:"success"};
  if (ready) return {headline:"Order Ready",label:"Ready",tone:"success"};
  if (processing) return {headline:"Order in Progress",label:"Processing",tone:"success"};
  return {
    headline:order.noPaymentRequired ? "Order Received" : "Order Confirmed",
    label:order.noPaymentRequired ? "No Payment Required" : "Paid",
    tone:"success"
  };
}

function emailShell({preheader,serviceLabel,title,content,footerNote}) {
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{color-scheme:light dark;supported-color-schemes:light dark}
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
    table{border-collapse:collapse!important}
    .brand-highlight{animation:brand-highlight 9s ease-in-out infinite}
    @keyframes brand-highlight{0%,100%{background-color:#a68b54}50%{background-color:#dfc995}}
    @media (prefers-reduced-motion:reduce){.brand-highlight{animation:none!important;background-color:#a68b54!important}}
    @media screen and (max-width:600px){
      .email-wrap{width:100%!important}
      .mobile-pad{padding-left:20px!important;padding-right:20px!important}
      .header-pad{padding:18px 20px!important}
      .brand-wordmark{font-size:23px!important;line-height:27px!important}
      .service-label{font-size:9px!important;line-height:13px!important;letter-spacing:.5px!important}
      .hero-title{font-size:29px!important;line-height:34px!important}
      .detail-column{display:block!important;width:100%!important;padding:0 0 14px!important}
      .item-table{font-size:11px!important}
      .item-table th,.item-table td{padding-left:4px!important;padding-right:4px!important}
    }
  </style>
  <!--[if mso]><style type="text/css">.neutral-header{background-color:#ffffff!important}.brand-monogram,.brand-wordmark{color:#111111!important}.item-head,.footer-surface{background-color:#111111!important;color:#ffffff!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;width:100%;background-color:#f5f5f5;color:#111111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}&#847;&zwnj;&#160;&#847;&zwnj;&#160;&#847;&zwnj;&#160;</div>
  <table role="presentation" class="email-bg" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f5f5f5" style="width:100%;background-color:#f5f5f5;">
    <tr><td align="center" style="padding:24px 12px;">
      <!--[if mso]><table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
      <table role="presentation" class="email-wrap" width="640" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:640px;background-color:#ffffff;border:1px solid #d0d0d0;">
        <tr><td class="header-pad neutral-header" bgcolor="#ffffff" style="padding:20px 34px;background-color:#ffffff;border-bottom:1px solid #d0d0d0;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;">
            <tr>
              <td class="brand-monogram" width="40" height="40" align="center" valign="middle" style="width:40px;height:40px;border:1px solid #111111;border-left:3px solid #a68b54;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:40px;font-weight:700;letter-spacing:1px;mso-line-height-rule:exactly;"><a href="${PORTAL_URL}" aria-label="BrickellHouse" style="display:block;color:#111111;text-decoration:none;">BH</a></td>
              <td width="14" style="width:14px;font-size:0;line-height:0;">&nbsp;</td>
              <td valign="middle">
                <a class="brand-wordmark" href="${PORTAL_URL}" style="display:inline-block;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:25px;line-height:29px;font-weight:600;letter-spacing:.2px;text-decoration:none;white-space:nowrap;">BrickellHouse</a>
                <div class="service-label" style="margin-top:2px;color:#314334;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:14px;font-weight:600;letter-spacing:1.1px;text-transform:uppercase;">${escapeHtml(serviceLabel)}</div>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td class="brand-highlight" height="3" style="height:3px;background-color:#a68b54;font-size:0;line-height:0;">&nbsp;</td></tr>
        ${content}
        <tr><td class="mobile-pad footer-surface" bgcolor="#111111" style="padding:25px 34px;background-color:#111111;border-top:1px solid #111111;color:#ffffff;font-size:12px;line-height:19px;">
          <p class="footer-title" style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:16px;color:#ffffff;">BrickellHouse Condominium</p>
          <p class="footer-text" style="margin:0 0 8px;color:#ffffff;">${escapeHtml(footerNote)}</p>
          <p class="footer-text" style="margin:0;color:#ffffff;"><a class="footer-link" href="${PORTAL_URL}" style="color:#d8bd7b;text-decoration:underline;">portal.brickellhouse.org</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;&copy; ${year} BrickellHouse</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}

function statusHero(order, presentation, management = false) {
  const intro = management
    ? (order.noPaymentRequired ? "A new order is ready for review. No payment was required." : "A paid order is ready for review.")
    : (order.noPaymentRequired
      ? "Thank you. We received your order and sent it to Management."
      : "Thank you. We received your payment and sent your order to Management.");
  const icon = presentation.tone === "warning" ? "!" : "&#10003;";
  const iconColor = presentation.tone === "warning" ? "#8a5a16" : "#3f5b43";

  return `<tr><td class="mobile-pad content-surface" bgcolor="#ffffff" style="padding:38px 34px 30px;background-color:#ffffff;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
      <td width="58" valign="top" style="width:58px;padding-right:17px;">
        <div style="width:48px;height:48px;border-radius:24px;background-color:${iconColor};color:#ffffff;font-size:25px;line-height:48px;text-align:center;font-family:Arial,sans-serif;">${icon}</div>
      </td>
      <td valign="top">
        <div class="muted-text" style="margin:0 0 8px;color:#76571d;font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:1.1px;font-weight:600;">${management ? "Management" : "Resident Services"}</div>
        <h1 class="hero-title heading-text" style="margin:0 0 11px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:40px;font-weight:400;color:#111111;">${escapeHtml(management ? "New Order" : presentation.headline)}</h1>
        <p class="body-text" style="margin:0;color:#222222;font-size:15px;line-height:24px;">${escapeHtml(intro)}</p>
      </td>
    </tr></table>
  </td></tr>`;
}

function orderIdentity(order, presentation, management = false) {
  const statusCell = management ? `<td class="detail-column" width="38%" valign="top" style="padding:18px 20px 18px 14px;">
    <div class="info-label" style="font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:1px;color:#333333;">Status</div>
    <div style="display:inline-block;margin-top:5px;padding:4px 9px;background-color:#3f5b43;color:#ffffff;font-size:12px;line-height:16px;font-weight:600;">${escapeHtml(presentation.label)}</div>
  </td>` : "";
  return `<tr><td class="mobile-pad" style="padding:0 34px 30px;">
    <table role="presentation" class="info-card" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #c8c8c8;">
      <tr>
        <td class="detail-column" width="${management ? "34%" : "55%"}" valign="top" style="padding:18px 14px 18px 20px;">
          <div class="info-label" style="font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:1px;color:#333333;">Order number</div>
          <div class="info-value" style="margin-top:5px;font-size:17px;line-height:22px;font-weight:600;color:#111111;">${escapeHtml(order.orderNumber)}</div>
        </td>
        <td class="detail-column" width="${management ? "28%" : "45%"}" valign="top" style="padding:18px ${management ? "14px" : "20px"} 18px 14px;">
          <div class="info-label" style="font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:1px;color:#333333;">${management ? "Resident unit" : "Unit"}</div>
          <div class="info-value" style="margin-top:5px;font-size:15px;line-height:22px;color:#111111;">${escapeHtml(order.unit)}</div>
        </td>
        ${statusCell}
      </tr>
    </table>
  </td></tr>`;
}

function residentItemsTable(order) {
  const rows = order.items.map(item => `<tr class="item-row">
    <td class="item-text" style="padding:13px 7px;border-bottom:1px solid #d0d0d0;color:#111111;">${escapeHtml(item.name)}</td>
    <td class="item-text" align="center" style="padding:13px 4px;border-bottom:1px solid #d0d0d0;color:#111111;">${item.quantity}</td>
    <td class="item-text" align="right" style="padding:13px 4px;border-bottom:1px solid #d0d0d0;color:#111111;white-space:nowrap;">${money(item.unitPriceCents)}</td>
    <td class="item-text" align="right" style="padding:13px 7px;border-bottom:1px solid #d0d0d0;color:#111111;white-space:nowrap;">${money(item.unitPriceCents * item.quantity)}</td>
  </tr>`).join("");

  return `<table role="presentation" class="item-table" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;table-layout:fixed;font-size:12px;line-height:18px;">
    <thead><tr class="item-head" bgcolor="#111111" style="background-color:#111111;color:#ffffff;">
      <th width="46%" align="left" style="padding:11px 7px;font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:.6px;font-weight:600;">Item</th>
      <th width="10%" align="center" style="padding:11px 4px;font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:.6px;font-weight:600;">Qty</th>
      <th width="20%" align="right" style="padding:11px 4px;font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:.6px;font-weight:600;">Price</th>
      <th width="24%" align="right" style="padding:11px 7px;font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:.6px;font-weight:600;">Total</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function managementItemsTable(order) {
  const rows = order.managementItems.map(item => `<tr class="item-row">
    <td class="item-text" style="padding:14px 7px;border-bottom:1px solid #d0d0d0;color:#111111;">
      <div style="font-weight:600;">${escapeHtml(item.residentName)}</div>
      <div class="accounting-meta" style="margin-top:4px;color:#333333;font-size:11px;line-height:16px;">Internal: ${escapeHtml(item.accounting.name)}</div>
      <div style="margin-top:5px;display:inline-block;padding:3px 7px;background-color:#111111;color:#ffffff;font-size:10px;line-height:14px;">GL ${escapeHtml(item.accounting.glCode)}</div>
    </td>
    <td class="item-text" align="center" style="padding:14px 4px;border-bottom:1px solid #d0d0d0;color:#111111;">${item.quantity}</td>
    <td class="item-text" align="right" style="padding:14px 4px;border-bottom:1px solid #d0d0d0;color:#111111;white-space:nowrap;">${money(item.unitPriceCents)}</td>
    <td class="item-text" align="right" style="padding:14px 7px;border-bottom:1px solid #d0d0d0;color:#111111;white-space:nowrap;">${money(item.unitPriceCents * item.quantity)}</td>
  </tr>`).join("");

  return `<table role="presentation" class="item-table" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;table-layout:fixed;font-size:12px;line-height:18px;">
    <thead><tr class="item-head" bgcolor="#111111" style="background-color:#111111;color:#ffffff;">
      <th width="52%" align="left" style="padding:11px 7px;font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:.6px;font-weight:600;">Resident / Accounting Item</th>
      <th width="10%" align="center" style="padding:11px 4px;font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:.6px;font-weight:600;">Qty</th>
      <th width="18%" align="right" style="padding:11px 4px;font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:.6px;font-weight:600;">Price</th>
      <th width="20%" align="right" style="padding:11px 7px;font-size:10px;line-height:15px;text-transform:uppercase;letter-spacing:.6px;font-weight:600;">Total</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function totals(order, management = false) {
  const totalLabel = order.noPaymentRequired ? "Order total" : management ? "Total paid" : "Total Paid";
  return `<table role="presentation" class="total-card" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="margin-top:16px;background-color:#ffffff;border:1px solid #c8c8c8;">
    <tr><td class="muted-text" style="padding:14px 18px 5px;color:#333333;font-size:12px;">Subtotal</td><td class="item-text" align="right" style="padding:14px 18px 5px;color:#111111;font-size:12px;">${money(order.subtotalCents)}</td></tr>
    <tr><td class="muted-text" style="padding:5px 18px 13px;color:#333333;font-size:12px;">Processing fee</td><td class="item-text" align="right" style="padding:5px 18px 13px;color:#111111;font-size:12px;">${money(order.processingFeeCents)}</td></tr>
    <tr><td class="heading-text" style="padding:15px 18px;border-top:1px solid #c8c8c8;color:#111111;font-family:Georgia,'Times New Roman',serif;font-size:18px;">${escapeHtml(totalLabel)}</td><td class="heading-text" align="right" style="padding:15px 18px;border-top:1px solid #c8c8c8;color:#111111;font-size:18px;font-weight:600;">${money(order.totalCents)}</td></tr>
  </table>`;
}

function detailsCard(order, management = false) {
  const rows = management ? [
    ["Resident",order.residentName],["Unit",order.unit],["Email",order.email],["Phone",order.phone],
    ["Submitted",dateTime(order.createdAt)],["Payment method",order.paymentMethod]
  ] : [
    ["Resident",order.residentName],["Unit",order.unit],["Order date",dateTime(order.createdAt)],
    ["Contact email",order.email]
  ];
  if (management && order.paymentReference) rows.push(["Payment reference",order.paymentReference]);
  if (management && order.legalNoticeVersion) rows.push(["Legal notice",order.legalNoticeVersion]);
  if (management && order.legalAcceptedAt) rows.push(["Legal accepted",dateTime(order.legalAcceptedAt)]);

  return `<table role="presentation" class="info-card" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #c8c8c8;">
    ${rows.map(([label,value]) => `<tr><td class="info-label" valign="top" style="padding:8px 16px;color:#333333;font-size:12px;line-height:18px;">${escapeHtml(label)}</td><td class="info-value" valign="top" align="right" style="padding:8px 16px;color:#111111;font-size:12px;line-height:18px;word-break:break-word;">${escapeHtml(value)}</td></tr>`).join("")}
  </table>`;
}

function residentContactCard() {
  return `<table role="presentation" class="contact-card" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #c8c8c8;border-left:4px solid #4d5f49;">
    <tr>
      <td class="detail-column" width="50%" valign="top" style="padding:18px 18px 18px 20px;">
        <div class="info-value" style="margin-bottom:5px;color:#111111;font-size:13px;font-weight:600;">Management</div>
        <div class="body-text" style="color:#222222;font-size:12px;line-height:19px;"><a class="contact-link" href="mailto:${CONTACTS.managementEmail}" style="color:#314f38;text-decoration:underline;">${CONTACTS.managementEmail}</a><br><a class="contact-link" href="tel:+13054009661" style="color:#314f38;text-decoration:none;">${CONTACTS.managementPhone}</a><br>Extension ${CONTACTS.managementExtension}</div>
      </td>
      <td class="detail-column" width="50%" valign="top" style="padding:18px 20px 18px 18px;">
        <div class="info-value" style="margin-bottom:5px;color:#111111;font-size:13px;font-weight:600;">Front Desk</div>
        <div class="body-text" style="color:#222222;font-size:12px;line-height:19px;"><a class="contact-link" href="mailto:${CONTACTS.frontDeskEmail}" style="color:#314f38;text-decoration:underline;">${CONTACTS.frontDeskEmail}</a><br>Extension ${CONTACTS.frontDeskExtension}</div>
      </td>
    </tr>
  </table>`;
}

function contentSection(title, content, last = false) {
  return `<tr><td class="mobile-pad content-surface" bgcolor="#ffffff" style="padding:0 34px ${last ? "38px" : "32px"};background-color:#ffffff;">
    <h2 class="heading-text" style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:26px;font-weight:400;color:#111111;">${escapeHtml(title)}</h2>
    ${content}
  </td></tr>`;
}

function residentPlainText(order, presentation) {
  const itemLines = order.items.map(item => `- ${safeText(item.name)} x ${item.quantity} at ${money(item.unitPriceCents)}: ${money(item.unitPriceCents * item.quantity)}`).join("\n");
  const intro = order.noPaymentRequired
    ? "Thank you. We received your order and sent it to Management."
    : "Thank you. We received your payment and sent your order to Management.";
  return `${presentation.headline}\n\nHello ${safeText(order.residentName)},\n\n${intro}\n\nOrder Number: ${safeText(order.orderNumber)}\nUnit: ${safeText(order.unit)}\nOrder Date: ${dateTime(order.createdAt)}\n\nItems:\n${itemLines}\n\nSubtotal: ${money(order.subtotalCents)}\nProcessing Fee: ${money(order.processingFeeCents)}\n${order.noPaymentRequired ? "Order Total" : "Total Paid"}: ${money(order.totalCents)}\n\nWhat Happens Next\nManagement will contact you once your order is ready.\n\nManagement\n${CONTACTS.managementEmail}\n${CONTACTS.managementPhone}\nExtension ${CONTACTS.managementExtension}\n\nFront Desk\n${CONTACTS.frontDeskEmail}\nExtension ${CONTACTS.frontDeskExtension}\n\nThis email was sent automatically for your BrickellHouse order. Please do not reply; contact Management directly with questions.\n\nBrickellHouse Condominium\nportal.brickellhouse.org`;
}

function managementPlainText(order) {
  const itemLines = order.managementItems.map(item => `- Resident item: ${safeText(item.residentName)}\n  Internal name: ${safeText(item.accounting.name)}\n  GL code: ${safeText(item.accounting.glCode)}\n  Quantity: ${item.quantity}\n  Unit price: ${money(item.unitPriceCents)}\n  Line total: ${money(item.unitPriceCents * item.quantity)}`).join("\n");
  const optional = [
    order.paymentReference ? `Payment Reference: ${safeText(order.paymentReference)}` : "",
    order.legalNoticeVersion ? `Legal Notice Version: ${safeText(order.legalNoticeVersion)}` : "",
    order.legalAcceptedAt ? `Legal Accepted: ${dateTime(order.legalAcceptedAt)}` : ""
  ].filter(Boolean).join("\n");
  return `New Order\n\nOrder Number: ${safeText(order.orderNumber)}\nResident: ${safeText(order.residentName)}\nUnit: ${safeText(order.unit)}\nEmail: ${safeText(order.email)}\nPhone: ${safeText(order.phone)}\nSubmitted: ${dateTime(order.createdAt)}\nPayment Method: ${safeText(order.paymentMethod)}\nPayment Status: ${order.noPaymentRequired ? "No payment required" : "Paid"}${optional ? `\n${optional}` : ""}\n\nItems:\n${itemLines}\n\nSubtotal: ${money(order.subtotalCents)}\nProcessing Fee: ${money(order.processingFeeCents)}\n${order.noPaymentRequired ? "Order Total" : "Total Paid"}: ${money(order.totalCents)}\n\nNext Action\nReview this order in the Management Dashboard. Contact the resident if access, scheduling, or more information is needed.`;
}

function buildResidentEmail(rawOrder) {
  const order = normalizeOrder(rawOrder);
  const presentation = statusPresentation(order);
  const content = [
    statusHero(order, presentation),
    orderIdentity(order, presentation),
    contentSection("Order Summary", `${residentItemsTable(order)}${totals(order)}`),
    contentSection("Resident Details", detailsCard(order)),
    contentSection("What Happens Next", `<table role="presentation" class="next-card" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #c8c8c8;border-left:4px solid #a68b54;"><tr><td class="body-text" style="padding:18px 20px;color:#222222;font-size:14px;line-height:23px;">Management will contact you once your order is ready.</td></tr></table>`),
    contentSection("Contact BrickellHouse", residentContactCard(), true)
  ].join("");

  return {
    from:SENDER,
    to:order.email,
    subject:"BrickellHouse Order Confirmation",
    html:emailShell({
      preheader:`Your BrickellHouse order has been ${order.noPaymentRequired ? "received" : "confirmed"}. Order ${order.orderNumber}.`,
      serviceLabel:"Resident Services",
      title:presentation.headline,
      content,
      footerNote:"This email was sent automatically for your BrickellHouse order. Please do not reply; contact Management directly with questions."
    }),
    text:residentPlainText(order, presentation)
  };
}

function buildManagementEmail(rawOrder) {
  const order = normalizeOrder(rawOrder);
  const presentation = statusPresentation(order);
  const content = [
    statusHero(order, presentation, true),
    orderIdentity(order, presentation, true),
    contentSection("Order Details", detailsCard(order, true)),
    contentSection("Items and Accounting", `${managementItemsTable(order)}${totals(order, true)}`),
    contentSection("Next Action", `<table role="presentation" class="next-card" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #c8c8c8;border-left:4px solid #4d5f49;"><tr><td class="body-text" style="padding:18px 20px;color:#222222;font-size:14px;line-height:23px;"><strong class="heading-text" style="color:#111111;">Review this order in the Management Dashboard.</strong><br>Contact the resident if access, scheduling, or more information is needed.</td></tr></table>`, true)
  ].join("");

  return {
    from:SENDER,
    to:MANAGEMENT_RECIPIENT,
    subject:"New BrickellHouse Store Order",
    html:emailShell({
      preheader:`New order ${order.orderNumber} for Unit ${order.unit}.`,
      serviceLabel:"Management",
      title:"New Order",
      content,
      footerNote:"This email was sent automatically to help Management review a new order."
    }),
    text:managementPlainText(order)
  };
}

function recurringBreakdownCard() {
  return `<table role="presentation" class="total-card" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #c8c8c8;">
    <tr><td class="muted-text" style="padding:14px 18px 5px;color:#333333;font-size:12px;">Valet Parking</td><td class="item-text" align="right" style="padding:14px 18px 5px;color:#111111;font-size:12px;">${money(25000)}/month</td></tr>
    <tr><td class="muted-text" style="padding:5px 18px 13px;color:#333333;font-size:12px;">Processing Fee</td><td class="item-text" align="right" style="padding:5px 18px 13px;color:#111111;font-size:12px;">${money(755)}/month</td></tr>
    <tr><td class="heading-text" style="padding:15px 18px;border-top:1px solid #c8c8c8;color:#111111;font-family:Georgia,'Times New Roman',serif;font-size:18px;">Monthly Total</td><td class="heading-text" align="right" style="padding:15px 18px;border-top:1px solid #c8c8c8;color:#111111;font-size:18px;font-weight:600;">${money(25755)}/month</td></tr>
  </table>`;
}

function recurringCallout(title, text) {
  return `<table role="presentation" class="next-card" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #c8c8c8;border-left:4px solid #a68b54;"><tr><td class="body-text" style="padding:18px 20px;color:#222222;font-size:14px;line-height:23px;"><strong class="heading-text" style="display:block;margin-bottom:6px;color:#111111;">${escapeHtml(title)}</strong>${text}</td></tr></table>`;
}

function recurringDetailsCard(rows) {
  return `<table role="presentation" class="info-card" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;border:1px solid #c8c8c8;">
    ${rows.map(([label,value]) => `<tr><td class="info-label" valign="top" style="padding:8px 16px;color:#333333;font-size:12px;line-height:18px;">${escapeHtml(label)}</td><td class="info-value" valign="top" align="right" style="padding:8px 16px;color:#111111;font-size:12px;line-height:18px;word-break:break-word;">${escapeHtml(value)}</td></tr>`).join("")}
  </table>`;
}

function recurringHero({eyebrow, title, intro}) {
  return `<tr><td class="mobile-pad content-surface" bgcolor="#ffffff" style="padding:38px 34px 30px;background-color:#ffffff;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
      <td width="58" valign="top" style="width:58px;padding-right:17px;"><div style="width:48px;height:48px;border-radius:24px;background-color:#3f5b43;color:#ffffff;font-size:25px;line-height:48px;text-align:center;font-family:Arial,sans-serif;">&#10003;</div></td>
      <td valign="top">
        <div class="muted-text" style="margin:0 0 8px;color:#76571d;font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:1.1px;font-weight:600;">${escapeHtml(eyebrow)}</div>
        <h1 class="hero-title heading-text" style="margin:0 0 11px;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:40px;font-weight:400;color:#111111;">${escapeHtml(title)}</h1>
        <p class="body-text" style="margin:0;color:#222222;font-size:15px;line-height:24px;">${escapeHtml(intro)}</p>
      </td>
    </tr></table>
  </td></tr>`;
}

function cancellationCard() {
  return recurringCallout(
    "Cancellation instructions",
    `Cancellation requests must be emailed to <a class="contact-link" href="mailto:${CONTACTS.managementEmail}" style="color:#314f38;text-decoration:underline;">${CONTACTS.managementEmail}</a> at least five (5) business days before your next scheduled billing date. Recurring charges continue until Management processes your cancellation.`
  );
}

function buildValetRecurringResidentEmail(rawOrder) {
  const order = normalizeOrder(rawOrder);
  const content = [
    recurringHero({
      eyebrow:"Recurring Monthly Subscription",
      title:"Recurring Monthly Subscription Activated",
      intro:"Your recurring monthly Valet Parking subscription has been successfully activated. This is not a one-time payment."
    }),
    contentSection("Monthly Charges", recurringBreakdownCard()),
    contentSection("Subscription Details", recurringDetailsCard([
      ["Service","Valet Parking"],
      ["Billing frequency","Monthly"],
      ["Status","Active"],
      ["Enrollment date",dateTime(order.createdAt)],
      ["Resident",order.residentName],
      ["Unit",order.unit]
    ])),
    contentSection("Automatic Monthly Payments", recurringCallout(
      "Recurring Monthly Subscription — NOT a one-time payment",
      "Your selected payment method will automatically be charged $257.55 each month until your subscription is canceled."
    )),
    contentSection("Contact BrickellHouse", cancellationCard(), true)
  ].join("");

  return {
    from:SENDER,
    to:order.email,
    subject:"Valet Parking Recurring Monthly Subscription Activated",
    html:emailShell({
      preheader:"Your recurring monthly Valet Parking subscription is active.",
      serviceLabel:"Resident Services",
      title:"Recurring Monthly Valet Subscription Activated",
      content,
      footerNote:"This email confirms your recurring monthly Valet Parking enrollment. Please do not reply; contact Management directly with questions."
    }),
    text:`Recurring Monthly Subscription Activated\n\nThis is a Recurring Monthly Subscription. This is NOT a one-time payment.\n\nService: Valet Parking\nValet: ${money(25000)}/month\nProcessing Fee: ${money(755)}/month\nMonthly Total: ${money(25755)}\nBilling Frequency: Monthly\nStatus: Active\nEnrollment Date: ${dateTime(order.createdAt)}\nResident: ${safeText(order.residentName)}\nUnit: ${safeText(order.unit)}\n\nYour selected payment method will automatically be charged each month until your subscription is canceled.\n\nTo cancel your recurring subscription, please email ${CONTACTS.managementEmail} at least five (5) business days before your next scheduled billing date. Recurring charges continue until Management processes your cancellation.\n\nBrickellHouse Condominium\nportal.brickellhouse.org`
  };
}

function buildValetRecurringManagementEmail(rawOrder) {
  const order = normalizeOrder(rawOrder);
  const content = [
    recurringHero({
      eyebrow:"RECURRING MONTHLY SUBSCRIPTION ENROLLMENT",
      title:"New Valet Enrollment",
      intro:"This resident has enrolled in Automatic Monthly Valet Parking Payments. This is a recurring monthly subscription."
    }),
    contentSection("Resident and Enrollment", recurringDetailsCard([
      ["Resident",order.residentName],
      ["Email",order.email],
      ["Unit",order.unit],
      ["Enrollment date",dateTime(order.createdAt)],
      ["Billing frequency","Monthly"]
    ])),
    contentSection("Monthly Charges", recurringBreakdownCard()),
    contentSection("Next Action", recurringCallout(
      "Review this recurring enrollment in the Management workflow.",
      "Process cancellation requests received at least five business days before the resident’s next scheduled billing date."
    ), true)
  ].join("");

  return {
    from:SENDER,
    to:MANAGEMENT_RECIPIENT,
    subject:"New BrickellHouse Store Order",
    html:emailShell({
      preheader:`Recurring monthly Valet enrollment for Unit ${order.unit}.`,
      serviceLabel:"Management",
      title:"Recurring Monthly Subscription Enrollment",
      content,
      footerNote:"This email was sent automatically to notify Management of a recurring Valet enrollment."
    }),
    text:`RECURRING MONTHLY SUBSCRIPTION ENROLLMENT\n\nThis resident has enrolled in Automatic Monthly Valet Parking Payments.\nThis is a recurring monthly subscription.\n\nResident: ${safeText(order.residentName)}\nEmail: ${safeText(order.email)}\nUnit: ${safeText(order.unit)}\nValet: ${money(25000)}\nProcessing Fee: ${money(755)}\nMonthly Total: ${money(25755)}\nEnrollment Date: ${dateTime(order.createdAt)}\nBilling Frequency: Monthly`
  };
}

function buildValetRecurringRenewalEmail(renewal) {
  const residentName = safeText(renewal?.residentName, "Resident");
  const unit = safeText(renewal?.unit, "Not provided");
  const nextRenewal = renewal?.nextRenewalDate ? dateTime(renewal.nextRenewalDate) : "";
  const details = [
    ["Resident",residentName],
    ["Unit",unit],
    ["Service","Valet Parking"],
    ["Valet amount",money(renewal?.valetCents ?? 25000)],
    ["Processing Fee",money(renewal?.processingFeeCents ?? 755)],
    ["Total paid",money(renewal?.monthlyTotalCents ?? 25755)],
    ["Payment date",dateTime(renewal?.renewalDate)],
    ["Transaction reference",safeText(renewal?.transactionReference, "Not provided")]
  ];
  if (nextRenewal) details.push(["Next renewal date",nextRenewal]);
  const content = [
    recurringHero({
      eyebrow:"Management",
      title:"Valet Subscription Renewed",
      intro:"A recurring monthly Valet Parking payment was successfully completed."
    }),
    contentSection("Renewal Details", recurringDetailsCard(details), true)
  ].join("");
  const nextRenewalText = nextRenewal ? `\nNext Renewal Date: ${nextRenewal}` : "";

  return {
    from:SENDER,
    to:MANAGEMENT_RECIPIENT,
    subject:`Valet Recurring Subscription Renewed \u2013 Unit ${unit}`,
    html:emailShell({
      preheader:`Valet recurring subscription renewed for Unit ${unit}.`,
      serviceLabel:"Management",
      title:"Valet Recurring Subscription Renewed",
      content,
      footerNote:"This email was sent automatically after Stripe confirmed a successful recurring Valet payment."
    }),
    text:`Valet Recurring Subscription Renewed\n\nResident Name: ${residentName}\nUnit: ${unit}\nService: Valet Parking\nValet Amount: ${money(renewal?.valetCents ?? 25000)}\nProcessing Fee: ${money(renewal?.processingFeeCents ?? 755)}\nTotal Paid: ${money(renewal?.monthlyTotalCents ?? 25755)}\nPayment Date: ${dateTime(renewal?.renewalDate)}\nTransaction Reference: ${safeText(renewal?.transactionReference, "Not provided")}${nextRenewalText}`
  };
}

async function deliver(resend, email, label, idempotencyKey) {
  try {
    const result = await resend.emails.send(email, {idempotencyKey});
    if (result?.error) {
      console.error(`Resend ${label} email failed: ${result.error.message || "Unknown error"}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`Resend ${label} email failed: ${error.message || "Unknown error"}`);
    return false;
  }
}

async function sendOrderEmails(order, options = {}) {
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY;
  const resend = options.resend || (apiKey ? new Resend(apiKey) : null);
  if (!resend) {
    console.warn("Order emails skipped: RESEND_API_KEY is not configured.");
    return {resident:false,management:false,skipped:true};
  }

  const keyBase = String(order.paymentId || order.orderNumber).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 180);
  const resident = await deliver(resend, buildResidentEmail(order), "resident confirmation", `brickellhouse-resident-${keyBase}`);
  const management = await deliver(resend, buildManagementEmail(order), "management notification", `brickellhouse-management-${keyBase}`);
  return {resident,management,skipped:false};
}

async function sendValetRecurringEnrollmentEmails(order, options = {}) {
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY;
  const resend = options.resend || (apiKey ? new Resend(apiKey) : null);
  if (!resend) {
    console.warn("Recurring Valet enrollment emails skipped: RESEND_API_KEY is not configured.");
    return {resident:false,management:false,skipped:true};
  }

  const keyBase = String(order.paymentId || order.orderNumber).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 160);
  const sendResident = options.sendResident !== false;
  const sendManagement = options.sendManagement !== false;
  const resident = sendResident
    ? await deliver(resend, buildValetRecurringResidentEmail(order), "recurring Valet resident enrollment", `brickellhouse-valet-recurring-resident-${keyBase}`)
    : true;
  const management = sendManagement
    ? await deliver(resend, buildValetRecurringManagementEmail(order), "recurring Valet management enrollment", `brickellhouse-valet-recurring-management-${keyBase}`)
    : true;
  return {resident,management,skipped:false};
}

async function sendValetRecurringRenewalEmail(renewal, options = {}) {
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY;
  const resend = options.resend || (apiKey ? new Resend(apiKey) : null);
  if (!resend) {
    console.warn("Recurring Valet renewal email skipped: RESEND_API_KEY is not configured.");
    return false;
  }
  const keyBase = String(renewal?.invoiceId || "renewal").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 180);
  return deliver(resend, buildValetRecurringRenewalEmail(renewal), "recurring Valet management renewal", `brickellhouse-valet-recurring-renewal-${keyBase}`);
}

module.exports = {
  sendOrderEmails,
  sendValetRecurringEnrollmentEmails,
  sendValetRecurringRenewalEmail,
  buildResidentEmail,
  buildManagementEmail,
  buildValetRecurringResidentEmail,
  buildValetRecurringManagementEmail,
  buildValetRecurringRenewalEmail,
  SENDER,
  MANAGEMENT_RECIPIENT
};
