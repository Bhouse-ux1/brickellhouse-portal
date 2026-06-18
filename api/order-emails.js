const {Resend} = require("resend");

const SENDER = "BrickellHouse <orders@brickellhouse.org>";
const MANAGEMENT_RECIPIENT = "admin@brickellhouse.net";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[character]);
}

function money(cents) {
  return new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(Number(cents || 0) / 100);
}

function dateTime(value) {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat("en-US", {
    timeZone:"America/New_York",month:"long",day:"numeric",year:"numeric",
    hour:"numeric",minute:"2-digit",timeZoneName:"short"
  }).format(date);
}

function itemRows(items) {
  return items.map(item => `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #e5e5e5;color:#252928;">${escapeHtml(item.name)}</td>
    <td style="padding:10px 0;border-bottom:1px solid #e5e5e5;text-align:center;color:#252928;">${Number(item.quantity)}</td>
    <td style="padding:10px 0;border-bottom:1px solid #e5e5e5;text-align:right;color:#252928;">${money(item.unitPriceCents * item.quantity)}</td>
  </tr>`).join("");
}

function itemText(items) {
  return items.map(item => `- ${item.name} x ${item.quantity}: ${money(item.unitPriceCents * item.quantity)}`).join("\n");
}

function emailShell(title, content, footer = "", header = "BrickellHouse") {
  return `<!doctype html><html><body style="margin:0;background:#f2f3f0;color:#252928;font-family:Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:28px 16px;">
      <div style="background:#202524;color:#fff;padding:22px 28px;font-size:18px;letter-spacing:.08em;">${escapeHtml(header)}</div>
      <div style="background:#fff;padding:32px 28px;">
        <h1 style="margin:0 0 24px;font-family:Georgia,serif;font-size:30px;font-weight:400;">${escapeHtml(title)}</h1>
        ${content}
      </div>
      ${footer ? `<div style="padding:20px 28px;color:#6c716f;font-size:12px;line-height:1.6;">${footer}</div>` : ""}
    </div>
  </body></html>`;
}

function buildResidentEmail(order) {
  const content = `
    <p style="line-height:1.7;">Hello ${escapeHtml(order.residentName)},</p>
    <p style="line-height:1.7;">Thank you for your order. Your BrickellHouse order has been received and payment has been successfully processed.</p>
    <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px;">
      <tr><td style="padding:7px 0;color:#707573;">Order number</td><td style="padding:7px 0;text-align:right;font-weight:bold;">${escapeHtml(order.orderNumber)}</td></tr>
      <tr><td style="padding:7px 0;color:#707573;">Unit</td><td style="padding:7px 0;text-align:right;">${escapeHtml(order.unit)}</td></tr>
      <tr><td style="padding:7px 0;color:#707573;">Order date</td><td style="padding:7px 0;text-align:right;">${escapeHtml(dateTime(order.createdAt))}</td></tr>
      <tr><td style="padding:7px 0;color:#707573;">Payment status</td><td style="padding:7px 0;text-align:right;">Paid</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px;">
      <thead><tr><th style="padding:10px 0;border-bottom:2px solid #252928;text-align:left;">Item</th><th style="padding:10px 0;border-bottom:2px solid #252928;">Qty</th><th style="padding:10px 0;border-bottom:2px solid #252928;text-align:right;">Amount</th></tr></thead>
      <tbody>${itemRows(order.items)}</tbody>
    </table>
    <p style="text-align:right;font-size:18px;"><strong>Total paid: ${money(order.totalCents)}</strong></p>
    <p style="margin:28px 0;padding:18px;background:#f1f3ef;line-height:1.7;"><strong>Management will contact you once your order is ready.</strong></p>
    <p style="line-height:1.7;">Management Office:<br><a href="mailto:admin@brickellhouse.net">admin@brickellhouse.net</a><br>305-400-9661</p>
    <p style="line-height:1.7;">Front Desk:<br><a href="mailto:frontdesk@brickellhouse.net">frontdesk@brickellhouse.net</a><br>Extension 7000</p>`;
  const footer = "This is an automated message from the BrickellHouse Portal. Please do not reply to this email. If you have any questions regarding your order, please contact the Management Office directly.";
  return {
    from:SENDER,to:order.email,subject:"BrickellHouse Order Confirmation",
    html:emailShell("Order Confirmation", content, footer),
    text:`Hello ${order.residentName},\n\nThank you for your order. Your BrickellHouse order has been received and payment has been successfully processed.\n\nOrder Number: ${order.orderNumber}\nUnit: ${order.unit}\nOrder Date: ${dateTime(order.createdAt)}\nPayment Status: Paid\n\nItems:\n${itemText(order.items)}\n\nTotal Paid: ${money(order.totalCents)}\n\nManagement will contact you once your order is ready.\n\nManagement Office:\nadmin@brickellhouse.net\n305-400-9661\n\nFront Desk:\nfrontdesk@brickellhouse.net\nExtension 7000\n\n${footer}\n\nBrickellHouse Management`
  };
}

function buildManagementEmail(order) {
  const content = `
    <p style="line-height:1.7;">A new BrickellHouse store order has been placed.</p>
    <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px;">
      <tr><td style="padding:7px 0;color:#707573;">Order number</td><td style="padding:7px 0;text-align:right;font-weight:bold;">${escapeHtml(order.orderNumber)}</td></tr>
      <tr><td style="padding:7px 0;color:#707573;">Resident</td><td style="padding:7px 0;text-align:right;">${escapeHtml(order.residentName)}</td></tr>
      <tr><td style="padding:7px 0;color:#707573;">Unit</td><td style="padding:7px 0;text-align:right;">${escapeHtml(order.unit)}</td></tr>
      <tr><td style="padding:7px 0;color:#707573;">Email</td><td style="padding:7px 0;text-align:right;">${escapeHtml(order.email)}</td></tr>
      <tr><td style="padding:7px 0;color:#707573;">Phone</td><td style="padding:7px 0;text-align:right;">${escapeHtml(order.phone || "Not provided")}</td></tr>
      <tr><td style="padding:7px 0;color:#707573;">Payment method</td><td style="padding:7px 0;text-align:right;">${escapeHtml(order.paymentMethod || "Square")}</td></tr>
      <tr><td style="padding:7px 0;color:#707573;">Payment status</td><td style="padding:7px 0;text-align:right;">Paid</td></tr>
      <tr><td style="padding:7px 0;color:#707573;">Date/time</td><td style="padding:7px 0;text-align:right;">${escapeHtml(dateTime(order.createdAt))}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin:24px 0;font-size:14px;">
      <thead><tr><th style="padding:10px 0;border-bottom:2px solid #252928;text-align:left;">Item</th><th style="padding:10px 0;border-bottom:2px solid #252928;">Qty</th><th style="padding:10px 0;border-bottom:2px solid #252928;text-align:right;">Amount</th></tr></thead>
      <tbody>${itemRows(order.items)}</tbody>
    </table>
    <p style="text-align:right;font-size:18px;"><strong>Total paid: ${money(order.totalCents)}</strong></p>
    <p style="margin-top:28px;line-height:1.7;">Please review this order in the Management Dashboard.</p>`;
  return {
    from:SENDER,to:MANAGEMENT_RECIPIENT,subject:"New BrickellHouse Store Order",
    html:emailShell("New Store Order", content, "", "BrickellHouse Management Notification"),
    text:`A new BrickellHouse store order has been placed.\n\nOrder Number: ${order.orderNumber}\nResident: ${order.residentName}\nUnit: ${order.unit}\nEmail: ${order.email}\nPhone: ${order.phone || "Not provided"}\nPayment Method: ${order.paymentMethod || "Square"}\nPayment Status: Paid\nDate/Time: ${dateTime(order.createdAt)}\n\nItems:\n${itemText(order.items)}\n\nTotal Paid: ${money(order.totalCents)}\n\nPlease review this order in the Management Dashboard.`
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

module.exports = {sendOrderEmails,buildResidentEmail,buildManagementEmail,SENDER,MANAGEMENT_RECIPIENT};
