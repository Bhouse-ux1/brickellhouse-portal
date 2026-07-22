const crypto = require("crypto");
const path = require("path");
const PDFDocument = require("pdfkit");

const OPERATIONAL_TIME_ZONE = "America/New_York";
const MAX_REPORT_DAYS = 366;
const REPORT_SUFFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BRICKELLHOUSE_LOGO_PATH = path.join(__dirname, "..", "bh-logo-transparent.png");

const PAGE = {width:792, height:612, margin:26, contentBottom:558, footerTop:568};
const COLORS = {
  page:"#fbf9f3",
  paper:"#ffffff",
  header:"#6f795f",
  ink:"#292d2a",
  muted:"#666d67",
  olive:"#687360",
  oliveMid:"#7d8878",
  sage:"#aab4a4",
  sageWash:"#eef1eb",
  tableHeader:"#e5eae2",
  sky:"#f2f7f9",
  border:"#d9ded8",
  rule:"#c7cec4",
  white:"#ffffff"
};

class FinancialReportDataError extends Error {
  constructor(message, code = "FINANCIAL_DATA_MISMATCH") {
    super(message);
    this.name = "FinancialReportDataError";
    this.code = code;
    this.status = 422;
  }
}

function parseDateOnly(value) {
  const text = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return {text, year, month, day, date};
}

function addDateDays(value, days) {
  const parsed = parseDateOnly(value);
  if (!parsed) throw new Error("Invalid date");
  const date = new Date(parsed.date.getTime() + Number(days) * 86400000);
  return date.toISOString().slice(0, 10);
}

function daysInclusive(startDate, endDate) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) return 0;
  return Math.floor((end.date.getTime() - start.date.getTime()) / 86400000) + 1;
}

function localMidnightUtc(value) {
  const parsed = parseDateOnly(value);
  if (!parsed) throw new Error("Invalid date");
  const desired = Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0);
  let guess = desired;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone:OPERATIONAL_TIME_ZONE,
    year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23"
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(part => [part.type, part.value]));
    const represented = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second)
    );
    const correction = represented - desired;
    if (!correction) break;
    guess -= correction;
  }
  return new Date(guess).toISOString();
}

function formatDateOnly(value) {
  const parsed = parseDateOnly(value);
  if (!parsed) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone:"UTC", month:"long", day:"numeric", year:"numeric"
  }).format(parsed.date);
}

function formatOperationalDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone:OPERATIONAL_TIME_ZONE, month:"2-digit", day:"2-digit", year:"numeric"
  }).format(date);
}

function formatOperationalDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone:OPERATIONAL_TIME_ZONE,
    month:"long", day:"numeric", year:"numeric",
    hour:"numeric", minute:"2-digit", second:"2-digit", timeZoneName:"short"
  }).format(date);
}

function monthRangeIsValid(start, end) {
  if (start.day !== 1) return false;
  const nextMonth = new Date(Date.UTC(start.year, start.month, 1));
  const expectedEnd = new Date(nextMonth.getTime() - 86400000).toISOString().slice(0, 10);
  return end.text === expectedEnd;
}

function validateReportPeriod(input) {
  const periodType = String(input?.periodType || "").trim().toLowerCase();
  const start = parseDateOnly(input?.startDate);
  const end = parseDateOnly(input?.endDate);
  if (!new Set(["weekly", "monthly", "custom"]).has(periodType)) {
    throw Object.assign(new Error("Choose a valid report period."), {status:400, code:"INVALID_PERIOD"});
  }
  if (!start || !end || end.date < start.date) {
    throw Object.assign(new Error("Choose a valid start and end date."), {status:400, code:"INVALID_DATE_RANGE"});
  }
  const dayCount = daysInclusive(start.text, end.text);
  if (dayCount > MAX_REPORT_DAYS) {
    throw Object.assign(new Error(`Reports are limited to ${MAX_REPORT_DAYS} inclusive days.`), {status:400, code:"DATE_RANGE_TOO_LARGE"});
  }
  if (periodType === "weekly" && (dayCount !== 7 || start.date.getUTCDay() !== 1 || end.date.getUTCDay() !== 0)) {
    throw Object.assign(new Error("Weekly reports must run Monday through Sunday."), {status:400, code:"INVALID_WEEK"});
  }
  if (periodType === "monthly" && !monthRangeIsValid(start, end)) {
    throw Object.assign(new Error("Monthly reports must cover one complete calendar month."), {status:400, code:"INVALID_MONTH"});
  }
  const typeLabel = periodType === "weekly" ? "Weekly" : periodType === "monthly" ? "Monthly" : "Custom";
  return {
    periodType,
    startDate:start.text,
    endDate:end.text,
    dayCount,
    startUtc:localMidnightUtc(start.text),
    endUtcExclusive:localMidnightUtc(addDateDays(end.text, 1)),
    label:`${typeLabel}: ${formatDateOnly(start.text)} - ${formatDateOnly(end.text)}`
  };
}

function createReportId(generatedAt = new Date()) {
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone:OPERATIONAL_TIME_ZONE, year:"numeric", month:"2-digit"
  }).formatToParts(generatedAt).map(part => [part.type, part.value]));
  const bytes = crypto.randomBytes(5);
  let suffix = "";
  for (const byte of bytes) suffix += REPORT_SUFFIX_ALPHABET[byte & 31];
  return `BH-FR-${dateParts.year}${dateParts.month}-${suffix}`;
}

function cleanText(value, maxLength = 240) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u2018\u2019\u201C\u201D\u2026]/gu, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cents(value, field) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new FinancialReportDataError(`Invalid ${field}`);
  }
  return amount;
}

function quantity(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new FinancialReportDataError("Invalid item quantity");
  }
  return amount;
}

function allocateFeeCents(lineGrosses, feeCents) {
  const fee = cents(feeCents, "processing fee");
  const subtotal = lineGrosses.reduce((sum, value) => sum + cents(value, "line gross"), 0);
  if (!subtotal) {
    if (fee) throw new FinancialReportDataError("A zero subtotal cannot carry a processing fee");
    return lineGrosses.map(() => 0);
  }
  const denominator = BigInt(subtotal);
  const allocations = lineGrosses.map((gross, index) => {
    const numerator = BigInt(fee) * BigInt(gross);
    return {index, cents:Number(numerator / denominator), remainder:numerator % denominator};
  });
  let remaining = fee - allocations.reduce((sum, allocation) => sum + allocation.cents, 0);
  const ranked = [...allocations].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });
  for (let index = 0; index < remaining; index += 1) ranked[index].cents += 1;
  return allocations.sort((a, b) => a.index - b.index).map(allocation => allocation.cents);
}

function preferredPaymentReference(order) {
  const recurringRenewalReference = String(order.internal_note || "").startsWith("Recurring monthly Valet renewal for enrollment ")
    ? order.payment_processor_reference
    : "";
  return cleanText(
    recurringRenewalReference
      || order.stripe_payment_intent_id
      || order.stripe_checkout_session_id
      || order.payment_processor_reference
      || order.square_payment_id
      || "Not recorded",
    120
  );
}

function buildFinancialReportModel({orders, period, zeroDollarOrderCount = 0, reportId, generatedAt = new Date()}) {
  if (!Array.isArray(orders) || !orders.length) {
    throw Object.assign(new Error("No paid transactions were found for the selected period."), {status:404, code:"NO_DATA"});
  }
  const generatedDate = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  if (Number.isNaN(generatedDate.getTime())) throw new FinancialReportDataError("Invalid generated timestamp");
  const lines = [];
  const sortedOrders = [...orders].sort((a, b) => {
    const dateDifference = new Date(a.payment_at).getTime() - new Date(b.payment_at).getTime();
    return dateDifference || String(a.order_number).localeCompare(String(b.order_number));
  });

  for (const order of sortedOrders) {
    if (String(order.payment_status) !== "Paid" || String(order.status) === "Cancelled") {
      throw new FinancialReportDataError("A non-qualifying order reached report generation");
    }
    if (!order.payment_at || Number.isNaN(new Date(order.payment_at).getTime())) {
      throw new FinancialReportDataError("A paid order is missing its payment timestamp");
    }
    const items = Array.isArray(order.order_items) ? [...order.order_items] : [];
    if (!items.length) throw new FinancialReportDataError("A paid order is missing item snapshots");
    items.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id || "").localeCompare(String(b.id || "")));
    const itemRows = items.map(item => {
      const itemQuantity = quantity(item.quantity);
      const unitPriceCents = cents(item.unit_price_cents, "unit price");
      const lineGrossCents = unitPriceCents * itemQuantity;
      if (!Number.isSafeInteger(lineGrossCents)) throw new FinancialReportDataError("Line gross exceeds safe integer bounds");
      return {item, itemQuantity, unitPriceCents, lineGrossCents};
    });
    const storedSubtotal = cents(order.subtotal_cents, "order subtotal");
    const storedFee = cents(order.processing_fee_cents, "order processing fee");
    const storedTotal = cents(order.total_cents, "order total");
    const calculatedSubtotal = itemRows.reduce((sum, item) => sum + item.lineGrossCents, 0);
    if (calculatedSubtotal !== storedSubtotal || storedTotal !== storedSubtotal + storedFee) {
      throw new FinancialReportDataError("Stored order totals do not reconcile to item snapshots");
    }
    // The stored processing fee is a resident-paid checkout charge. It is added to line gross,
    // not treated as a Stripe settlement cost, because processor settlement fees are not stored.
    const feeAllocations = allocateFeeCents(itemRows.map(item => item.lineGrossCents), storedFee);
    itemRows.forEach((itemRow, index) => {
      const allocatedFeeCents = feeAllocations[index];
      lines.push({
        paymentDate:formatOperationalDate(order.payment_at),
        paymentAt:order.payment_at,
        orderNumber:cleanText(order.order_number, 80),
        residentName:cleanText(order.resident_name, 100),
        unit:cleanText(order.unit_number, 40),
        product:cleanText(itemRow.item.resident_name_snapshot, 120),
        internalName:cleanText(itemRow.item.internal_name_snapshot, 140),
        quantity:itemRow.itemQuantity,
        glCode:cleanText(itemRow.item.gl_code_snapshot, 32) || "Not recorded",
        unitPriceCents:itemRow.unitPriceCents,
        lineGrossCents:itemRow.lineGrossCents,
        allocatedFeeCents,
        lineNetCents:itemRow.lineGrossCents + allocatedFeeCents,
        paymentReference:preferredPaymentReference(order)
      });
    });
  }

  const glMap = new Map();
  lines.forEach(line => {
    if (!glMap.has(line.glCode)) {
      glMap.set(line.glCode, {glCode:line.glCode, descriptions:new Set(), quantity:0, grossCents:0, feeCents:0, netCents:0});
    }
    const summary = glMap.get(line.glCode);
    summary.descriptions.add(line.internalName || line.product || "Not recorded");
    summary.quantity += line.quantity;
    summary.grossCents += line.lineGrossCents;
    summary.feeCents += line.allocatedFeeCents;
    summary.netCents += line.lineNetCents;
  });
  const glSummary = [...glMap.values()].sort((a, b) => a.glCode.localeCompare(b.glCode)).map(summary => ({
    glCode:summary.glCode,
    internalDescription:[...summary.descriptions].sort().join("; "),
    quantity:summary.quantity,
    grossCents:summary.grossCents,
    feeCents:summary.feeCents,
    netCents:summary.netCents
  }));
  const totals = {
    orderCount:sortedOrders.length,
    lineCount:lines.length,
    grossCents:lines.reduce((sum, line) => sum + line.lineGrossCents, 0),
    feeCents:lines.reduce((sum, line) => sum + line.allocatedFeeCents, 0),
    netCents:lines.reduce((sum, line) => sum + line.lineNetCents, 0)
  };
  const model = {
    reportId:cleanText(reportId || createReportId(generatedDate), 40),
    generatedAt:generatedDate.toISOString(),
    generatedLabel:formatOperationalDateTime(generatedDate),
    timeZone:OPERATIONAL_TIME_ZONE,
    period,
    totals,
    zeroDollarOrderCount:Number.isSafeInteger(Number(zeroDollarOrderCount)) ? Math.max(0, Number(zeroDollarOrderCount)) : 0,
    glSummary,
    lines
  };
  assertFinancialReportModel(model);
  return model;
}

function assertFinancialReportModel(model) {
  const gross = model.lines.reduce((sum, line) => sum + line.lineGrossCents, 0);
  const fees = model.lines.reduce((sum, line) => sum + line.allocatedFeeCents, 0);
  const net = model.lines.reduce((sum, line) => sum + line.lineNetCents, 0);
  const glGross = model.glSummary.reduce((sum, row) => sum + row.grossCents, 0);
  const glFees = model.glSummary.reduce((sum, row) => sum + row.feeCents, 0);
  const glNet = model.glSummary.reduce((sum, row) => sum + row.netCents, 0);
  if (gross !== model.totals.grossCents || fees !== model.totals.feeCents || net !== model.totals.netCents) {
    throw new FinancialReportDataError("Detailed transactions do not reconcile to executive totals");
  }
  if (glGross !== gross || glFees !== fees || glNet !== net || net !== gross + fees) {
    throw new FinancialReportDataError("GL summary does not reconcile to detailed transactions");
  }
  if (model.totals.lineCount !== model.lines.length) throw new FinancialReportDataError("Transaction line count does not reconcile");
  return true;
}

function money(value) {
  return new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"}).format(Number(value || 0) / 100);
}

function drawWatermark(doc) {
  const width = 676;
  const height = width * 149 / 519;
  doc.save();
  doc.opacity(0.02);
  doc.image(BRICKELLHOUSE_LOGO_PATH, (PAGE.width - width) / 2, (PAGE.height - height) / 2, {width});
  doc.restore();
}

function drawHeaderLogo(doc, x, y, width, height) {
  doc.save();
  doc.image(BRICKELLHOUSE_LOGO_PATH, x, y, {
    fit:[width, height],
    align:"left",
    valign:"center"
  });
  doc.restore();
}

function drawMetadataRow(doc, label, value, y) {
  doc.font("Helvetica-Bold").fontSize(5.6).fillColor(COLORS.white)
    .text(label.toUpperCase(), 530, y, {width:50, characterSpacing:0.4, lineBreak:false});
  doc.font("Helvetica").fontSize(6.2).fillColor(COLORS.white)
    .text(value, 588, y, {width:178, align:"right", lineBreak:false});
}

function addPage(doc, model, sectionTitle, first = false) {
  doc.addPage({size:"LETTER", layout:"landscape", margin:0});
  doc.save().fillColor(COLORS.page).rect(0, 0, PAGE.width, PAGE.height).fill().restore();
  doc.save().fillColor(COLORS.header).rect(0, 0, PAGE.width, first ? 127 : 67).fill().restore();
  if (first) {
    drawHeaderLogo(doc, PAGE.margin, 28, 126, 36);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.white)
      .text("BRICKELLHOUSE CONDOMINIUM ASSOCIATION", 174, 25, {characterSpacing:1, lineBreak:false});
    doc.font("Times-Roman").fontSize(15).fillColor(COLORS.white)
      .text("Resident Store", 174, 44, {lineBreak:false});
    doc.font("Times-Roman").fontSize(28).fillColor(COLORS.white)
      .text("Financial Statement", 174, 62, {lineBreak:false});
    doc.font("Helvetica").fontSize(7).fillColor(COLORS.white)
      .text("MONTHLY STATEMENT", 174, 101, {characterSpacing:1.1, lineBreak:false});
    drawMetadataRow(doc, "Report ID", model.reportId, 27);
    drawMetadataRow(doc, "Generated", model.generatedLabel, 43);
    drawMetadataRow(doc, "Timezone", model.timeZone, 59);
    drawMetadataRow(doc, "Period", model.period.label, 75);
    doc.save().strokeColor(COLORS.olive).lineWidth(0.7)
      .moveTo(PAGE.margin, 126).lineTo(PAGE.width - PAGE.margin, 126).stroke().restore();
    return 145;
  } else {
    drawHeaderLogo(doc, PAGE.margin, 20, 105, 30);
    doc.font("Helvetica-Bold").fontSize(6.8).fillColor(COLORS.white)
      .text("BRICKELLHOUSE CONDOMINIUM ASSOCIATION", 151, 18, {characterSpacing:0.75, lineBreak:false});
    doc.font("Times-Roman").fontSize(17).fillColor(COLORS.white)
      .text(sectionTitle, 151, 32, {lineBreak:false});
    doc.font("Helvetica-Bold").fontSize(5.5).fillColor(COLORS.white)
      .text("REPORT ID", 538, 19, {width:45, lineBreak:false});
    doc.font("Helvetica").fontSize(6).fillColor(COLORS.white)
      .text(model.reportId, 590, 19, {width:176, align:"right", lineBreak:false});
    doc.font("Helvetica-Bold").fontSize(5.5).fillColor(COLORS.white)
      .text("PERIOD", 538, 35, {width:45, lineBreak:false});
    doc.font("Helvetica").fontSize(6).fillColor(COLORS.white)
      .text(model.period.label, 590, 35, {width:176, align:"right", lineBreak:false});
    doc.save().strokeColor(COLORS.rule).lineWidth(0.55)
      .moveTo(PAGE.margin, 66).lineTo(PAGE.width - PAGE.margin, 66).stroke().restore();
    return 81;
  }
}

function drawSectionLabel(doc, text, y) {
  doc.font("Times-Roman").fontSize(11.5).fillColor(COLORS.ink);
  const labelWidth = doc.widthOfString(text);
  doc.text(text, PAGE.margin, y, {lineBreak:false});
  doc.save().strokeColor(COLORS.rule).lineWidth(0.45)
    .moveTo(PAGE.margin + labelWidth + 13, y + 8).lineTo(PAGE.width - PAGE.margin, y + 8).stroke().restore();
  return y + 22;
}

function drawExecutiveSummary(doc, model, y) {
  y = drawSectionLabel(doc, "Executive Summary", y);
  const metrics = [
    ["Paid orders", String(model.totals.orderCount)],
    ["Transaction lines", String(model.totals.lineCount)],
    ["Gross revenue", money(model.totals.grossCents)],
    ["Processing fees", money(model.totals.feeCents)],
    ["Net collected", money(model.totals.netCents)]
  ];
  const width = (PAGE.width - PAGE.margin * 2) / metrics.length;
  doc.save().strokeColor(COLORS.rule).lineWidth(0.5)
    .moveTo(PAGE.margin, y).lineTo(PAGE.width - PAGE.margin, y).stroke()
    .moveTo(PAGE.margin, y + 58).lineTo(PAGE.width - PAGE.margin, y + 58).stroke().restore();
  metrics.forEach(([label, value], index) => {
    const x = PAGE.margin + index * width;
    if (index > 0) {
      doc.save().strokeColor(COLORS.border).lineWidth(0.35)
        .moveTo(x, y + 10).lineTo(x, y + 48).stroke().restore();
    }
    doc.font("Helvetica").fontSize(6.2).fillColor(COLORS.muted)
      .text(label.toUpperCase(), x + 10, y + 13, {width:width - 20, characterSpacing:0.55, lineBreak:false});
    doc.font(index === 4 ? "Times-Bold" : "Times-Roman").fontSize(index === 4 ? 18 : 17).fillColor(index === 4 ? COLORS.olive : COLORS.ink)
      .text(value, x + 10, y + 30, {width:width - 20, lineBreak:false});
  });
  doc.font("Helvetica").fontSize(6.2).fillColor(COLORS.muted)
    .text("Net collected equals item gross plus the resident-paid processing fee stored on each paid order. It is not Stripe settlement net.", PAGE.margin, y + 68, {width:PAGE.width - PAGE.margin * 2, lineBreak:false});
  return y + 88;
}

function drawTableHeader(doc, columns, y, height = 24) {
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  doc.save().fillColor(COLORS.tableHeader).rect(PAGE.margin, y, tableWidth, height).fill()
    .strokeColor(COLORS.olive).lineWidth(0.55)
    .moveTo(PAGE.margin, y).lineTo(PAGE.margin + tableWidth, y).stroke()
    .moveTo(PAGE.margin, y + height).lineTo(PAGE.margin + tableWidth, y + height).stroke().restore();
  let x = PAGE.margin;
  columns.forEach(column => {
    doc.font("Helvetica-Bold").fontSize(column.headerSize || 5.5).fillColor(COLORS.ink)
      .text(column.label, x + 4, y + 8, {width:column.width - 8, align:column.align || "left", characterSpacing:0.15, lineBreak:false});
    x += column.width;
  });
  return y + height;
}

function drawGlSummary(doc, model, y) {
  const columns = [
    {key:"glCode", label:"GL CODE", width:70},
    {key:"internalDescription", label:"INTERNAL DESCRIPTION", width:330},
    {key:"quantity", label:"QUANTITY", width:55, align:"right"},
    {key:"grossCents", label:"GROSS AMOUNT", width:95, align:"right"},
    {key:"feeCents", label:"PROCESSING FEES", width:95, align:"right"},
    {key:"netCents", label:"NET AMOUNT", width:95, align:"right"}
  ];
  y = drawSectionLabel(doc, "GL summary", y);
  y = drawTableHeader(doc, columns, y);
  for (let index = 0; index < model.glSummary.length; index += 1) {
    const row = model.glSummary[index];
    const description = wrapText(doc, cleanText(row.internalDescription, 300), columns[1].width - 8, 6.2, 2);
    doc.font("Helvetica").fontSize(6.2);
    const rowHeight = Math.max(28, doc.heightOfString(description, {width:columns[1].width - 8, lineGap:1}) + 13);
    if (y + rowHeight > PAGE.contentBottom - 82) {
      y = addPage(doc, model, "GL Summary - Continued");
      y = drawTableHeader(doc, columns, y);
    }
    doc.save().fillColor(index % 2 ? COLORS.sky : COLORS.paper).rect(PAGE.margin, y, 740, rowHeight).fill()
      .strokeColor(COLORS.border).lineWidth(0.3)
      .moveTo(PAGE.margin, y + rowHeight).lineTo(PAGE.margin + 740, y + rowHeight).stroke().restore();
    const values = {
      ...row,
      internalDescription:description,
      grossCents:money(row.grossCents), feeCents:money(row.feeCents), netCents:money(row.netCents)
    };
    let x = PAGE.margin;
    columns.forEach(column => {
      doc.save();
      doc.font(column.key === "glCode" ? "Helvetica-Bold" : "Helvetica").fontSize(6.2).fillColor(COLORS.ink)
        .text(String(values[column.key]), x + 4, y + 9, {width:column.width - 8, height:rowHeight - 14, align:column.align || "left", lineGap:1, ellipsis:true});
      doc.restore();
      x += column.width;
    });
    y += rowHeight;
  }
  return y;
}

function drawBasisNote(doc, model, y) {
  const note = "This statement includes paid Resident Store transactions with payment dates in the selected reporting period.";
  y += 18;
  if (y + 50 > PAGE.contentBottom) y = addPage(doc, model, "Statement Basis");
  y = drawSectionLabel(doc, "Statement Basis", y);
  doc.font("Helvetica").fontSize(6.5).fillColor(COLORS.muted)
    .text(note, PAGE.margin, y + 1, {width:PAGE.width - PAGE.margin * 2, lineBreak:false});
  doc.save().strokeColor(COLORS.rule).lineWidth(0.35)
    .moveTo(PAGE.margin, y + 22).lineTo(PAGE.width - PAGE.margin, y + 22).stroke().restore();
  return y + 31;
}

function splitLongToken(doc, token, width) {
  const parts = [];
  let current = "";
  for (const character of token) {
    if (current && doc.widthOfString(current + character) > width) {
      parts.push(current);
      current = character;
    } else current += character;
  }
  if (current) parts.push(current);
  return parts;
}

function wrapText(doc, value, width, fontSize, maxLines = 3) {
  doc.fontSize(fontSize);
  const words = cleanText(value, 300).split(/\s+/).filter(Boolean).flatMap(word => doc.widthOfString(word) > width ? splitLongToken(doc, word, width) : [word]);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && doc.widthOfString(candidate) > width) {
      lines.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) lines.push(current);
  if (!lines.length) lines.push("");
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last && doc.widthOfString(`${last}...`) > width) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}...`;
  }
  return lines.join("\n");
}

const DETAIL_COLUMNS = [
  {key:"paymentDate", label:"DATE", width:48},
  {key:"orderNumber", label:"ORDER #", width:68, mono:true},
  {key:"residentName", label:"RESIDENT NAME", width:72},
  {key:"unit", label:"UNIT", width:32, align:"center"},
  {key:"product", label:"PRODUCT", width:80},
  {key:"internalName", label:"INTERNAL NAME", width:80},
  {key:"quantity", label:"QTY", width:26, align:"right"},
  {key:"glCode", label:"GL CODE", width:38, align:"center"},
  {key:"unitPriceCents", label:"UNIT PRICE", width:48, align:"right"},
  {key:"lineGrossCents", label:"LINE GROSS", width:50, align:"right"},
  {key:"allocatedFeeCents", label:"ALLOC. FEE", width:48, align:"right"},
  {key:"lineNetCents", label:"LINE NET", width:50, align:"right"},
  {key:"paymentReference", label:"PAYMENT REFERENCE", width:100, mono:true}
];

function startDetailPage(doc, model, continued = false) {
  let y = addPage(doc, model, continued ? "Detailed Transactions - Continued" : "Detailed Transactions");
  y = drawTableHeader(doc, DETAIL_COLUMNS, y, 27);
  return y;
}

function detailCellValue(line, column) {
  if (["unitPriceCents", "lineGrossCents", "allocatedFeeCents", "lineNetCents"].includes(column.key)) return money(line[column.key]);
  return String(line[column.key] ?? "");
}

function drawDetailedTransactions(doc, model) {
  let y = startDetailPage(doc, model, false);
  model.lines.forEach((line, rowIndex) => {
    const cells = DETAIL_COLUMNS.map(column => {
      const font = column.mono ? "Courier" : "Helvetica";
      const size = column.mono ? 5.1 : 5.6;
      doc.font(font).fontSize(size);
      return {column, font, size, text:wrapText(doc, detailCellValue(line, column), column.width - 6, size, column.mono ? 3 : 2)};
    });
    const rowHeight = Math.max(21, ...cells.map(cell => {
      doc.font(cell.font).fontSize(cell.size);
      return doc.heightOfString(cell.text, {width:cell.column.width - 6, lineGap:0.6}) + 9;
    }));
    if (y + rowHeight > PAGE.contentBottom) y = startDetailPage(doc, model, true);
    doc.save().fillColor(rowIndex % 2 ? COLORS.sky : COLORS.paper).rect(PAGE.margin, y, 740, rowHeight).fill()
      .strokeColor(COLORS.border).lineWidth(0.25)
      .moveTo(PAGE.margin, y + rowHeight).lineTo(PAGE.margin + 740, y + rowHeight).stroke().restore();
    let x = PAGE.margin;
    cells.forEach(cell => {
      doc.save();
      doc.font(cell.font).fontSize(cell.size).fillColor(COLORS.ink)
        .text(cell.text, x + 3, y + 5, {width:cell.column.width - 6, height:rowHeight - 9, align:cell.column.align || "left", lineGap:0.6, ellipsis:true});
      doc.restore();
      x += cell.column.width;
    });
    y += rowHeight;
  });
  if (y + 35 > PAGE.contentBottom) y = startDetailPage(doc, model, true);
  doc.save().fillColor(COLORS.sageWash).rect(PAGE.margin, y + 5, 740, 28).fill()
    .strokeColor(COLORS.olive).lineWidth(0.45)
    .moveTo(PAGE.margin, y + 5).lineTo(PAGE.margin + 740, y + 5).stroke()
    .moveTo(PAGE.margin, y + 33).lineTo(PAGE.margin + 740, y + 33).stroke().restore();
  doc.font("Helvetica-Bold").fontSize(6.5).fillColor(COLORS.olive)
    .text("RECONCILED TOTALS", PAGE.margin + 8, y + 15, {width:350, lineBreak:false})
    .text(`Gross ${money(model.totals.grossCents)}   Fees ${money(model.totals.feeCents)}   Net collected ${money(model.totals.netCents)}`, PAGE.margin + 350, y + 15, {width:382, align:"right", lineBreak:false});
}

function drawFooters(doc, model) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    drawWatermark(doc);
    doc.save().strokeColor(COLORS.rule).lineWidth(0.35).moveTo(PAGE.margin, PAGE.footerTop).lineTo(PAGE.width - PAGE.margin, PAGE.footerTop).stroke().restore();
    doc.font("Helvetica-Bold").fontSize(5.3).fillColor(COLORS.olive)
      .text(model.reportId, PAGE.margin, PAGE.footerTop + 8, {width:210, lineBreak:false});
    doc.font("Helvetica").fontSize(4.9).fillColor(COLORS.muted)
      .text("Generated directly from BrickellHouse Resident Store transaction records.", PAGE.margin, PAGE.footerTop + 19, {width:315, lineBreak:false});
    doc.font("Helvetica").fontSize(5.1).fillColor(COLORS.oliveMid)
      .text("INTERNAL / CONFIDENTIAL ACCOUNTING", 286, PAGE.footerTop + 13, {width:220, align:"center", characterSpacing:0.15, lineBreak:false});
    doc.font("Helvetica").fontSize(5).fillColor(COLORS.muted)
      .text(`Page ${index - range.start + 1} of ${range.count}`, 565, PAGE.footerTop + 6, {width:201, align:"right", lineBreak:false})
      .text("Generated by BrickellHouse Portal", 565, PAGE.footerTop + 16, {width:201, align:"right", lineBreak:false})
      .text(model.generatedLabel, 565, PAGE.footerTop + 26, {width:201, align:"right", lineBreak:false});
  }
}

function generateFinancialReportPdf(model) {
  assertFinancialReportModel(model);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      autoFirstPage:false,
      bufferPages:true,
      compress:true,
      info:{
        Title:"BrickellHouse Resident Store Financial Statement",
        Author:"BrickellHouse Portal",
        Subject:model.period.label,
        Keywords:"BrickellHouse, resident store, financial statement, internal accounting"
      }
    });
    const chunks = [];
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    let y = addPage(doc, model, "Resident Store Financial Statement", true);
    y = drawExecutiveSummary(doc, model, y);
    y = drawGlSummary(doc, model, y);
    drawBasisNote(doc, model, y);
    drawDetailedTransactions(doc, model);
    drawFooters(doc, model);
    doc.end();
  });
}

module.exports = {
  OPERATIONAL_TIME_ZONE,
  MAX_REPORT_DAYS,
  FinancialReportDataError,
  validateReportPeriod,
  createReportId,
  buildFinancialReportModel,
  assertFinancialReportModel,
  allocateFeeCents,
  generateFinancialReportPdf,
  formatOperationalDateTime
};
