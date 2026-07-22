const {supabaseRequest} = require("./_supabase");
const {enforceRateLimit} = require("./_rate-limit");
const {
  validateReportPeriod,
  createReportId,
  buildFinancialReportModel,
  generateFinancialReportPdf
} = require("../server/financial-report");

const PAGE_SIZE = 250;
const MAX_ORDERS = 5000;
const MAX_TRANSACTION_LINES = 10000;
const ALLOWED_INPUT_FIELDS = new Set(["periodType", "startDate", "endDate"]);
const PUBLIC_ERROR_CODES = new Set([
  "METHOD_NOT_ALLOWED",
  "AUTH_REQUIRED",
  "MANAGEMENT_APPROVAL_REQUIRED",
  "INVALID_JSON",
  "INVALID_PERIOD",
  "INVALID_DATE_RANGE",
  "INVALID_WEEK",
  "INVALID_MONTH",
  "DATE_RANGE_TOO_LARGE",
  "UNSUPPORTED_CONTENT_TYPE",
  "UNSUPPORTED_FIELDS",
  "REQUEST_TOO_LARGE",
  "REPORT_TOO_LARGE",
  "NO_DATA"
]);

function sendJson(response, status, payload) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
  return response.status(status).json(payload);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw Object.assign(new Error("Reporting service is not configured"), {code:"CONFIGURATION_ERROR"});
  return value;
}

function bearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : "";
}

async function verifyManagementAuthorization(request) {
  const token = bearerToken(request);
  if (!token) throw Object.assign(new Error("Management login required."), {status:401, code:"AUTH_REQUIRED"});
  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const anonKey = requiredEnv("SUPABASE_ANON_KEY");
  const headers = {
    "apikey":anonKey,
    "Authorization":`Bearer ${token}`,
    "Accept":"application/json"
  };
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {headers});
  if (!userResponse.ok) throw Object.assign(new Error("Management login required."), {status:401, code:"AUTH_REQUIRED"});
  const user = await userResponse.json().catch(() => null);
  if (!user?.id) throw Object.assign(new Error("Management login required."), {status:401, code:"AUTH_REQUIRED"});

  // This is the same database authorization function used by Management RLS. It checks active
  // approval and enforces aal2 when the approved profile requires MFA.
  const approvalResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/is_management_user`, {
    method:"POST",
    headers:{...headers, "Content-Type":"application/json"},
    body:"{}"
  });
  const approved = approvalResponse.ok ? await approvalResponse.json().catch(() => false) : false;
  if (approved !== true) {
    throw Object.assign(new Error("Approved Management access is required."), {status:403, code:"MANAGEMENT_APPROVAL_REQUIRED"});
  }
  return user;
}

function requestBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { /* handled below */ }
  }
  throw Object.assign(new Error("A valid JSON request body is required."), {status:400, code:"INVALID_JSON"});
}

function validateRequestBody(request) {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw Object.assign(new Error("Content-Type must be application/json."), {status:415, code:"UNSUPPORTED_CONTENT_TYPE"});
  }
  const contentLength = Number(request.headers["content-length"] || 0);
  if (contentLength > 4096) throw Object.assign(new Error("The report request is too large."), {status:413, code:"REQUEST_TOO_LARGE"});
  const body = requestBody(request);
  const unexpectedFields = Object.keys(body).filter(key => !ALLOWED_INPUT_FIELDS.has(key));
  if (unexpectedFields.length) {
    throw Object.assign(new Error("The report request contains unsupported fields."), {status:400, code:"UNSUPPORTED_FIELDS"});
  }
  return validateReportPeriod(body);
}

function paidOrdersPath(period, offset) {
  const select = [
    "id", "order_number", "resident_name", "unit_number",
    "subtotal_cents", "processing_fee_cents", "total_cents",
    "status", "payment_status", "payment_at", "created_at", "internal_note",
    "payment_provider", "payment_processor_reference", "square_payment_id",
    "stripe_checkout_session_id", "stripe_payment_intent_id", "stripe_charge_id",
    "order_items(id,resident_name_snapshot,internal_name_snapshot,gl_code_snapshot,quantity,unit_price_cents,created_at)"
  ].join(",");
  return [
    `orders?select=${select}`,
    "payment_status=eq.Paid",
    "status=neq.Cancelled",
    `payment_at=gte.${encodeURIComponent(period.startUtc)}`,
    `payment_at=lt.${encodeURIComponent(period.endUtcExclusive)}`,
    "order=payment_at.asc,order_number.asc",
    `limit=${PAGE_SIZE}`,
    `offset=${offset}`
  ].join("&");
}

async function loadPaidOrders(period) {
  const orders = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await supabaseRequest(paidOrdersPath(period, offset));
    const rows = Array.isArray(page) ? page : [];
    orders.push(...rows);
    if (orders.length > MAX_ORDERS) {
      throw Object.assign(new Error("The selected period contains too many paid orders. Choose a shorter range."), {status:413, code:"REPORT_TOO_LARGE"});
    }
    if (rows.length < PAGE_SIZE) break;
  }
  const lineCount = orders.reduce((sum, order) => sum + (Array.isArray(order.order_items) ? order.order_items.length : 0), 0);
  if (lineCount > MAX_TRANSACTION_LINES) {
    throw Object.assign(new Error("The selected period contains too many transaction lines. Choose a shorter range."), {status:413, code:"REPORT_TOO_LARGE"});
  }
  return orders;
}

async function countZeroDollarOrders(period) {
  let count = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const path = [
      "orders?select=id",
      `payment_status=eq.${encodeURIComponent("No Payment Required")}`,
      `created_at=gte.${encodeURIComponent(period.startUtc)}`,
      `created_at=lt.${encodeURIComponent(period.endUtcExclusive)}`,
      `limit=${PAGE_SIZE}`,
      `offset=${offset}`
    ].join("&");
    const page = await supabaseRequest(path);
    const rows = Array.isArray(page) ? page : [];
    count += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }
  return count;
}

function safeFilename(model) {
  return `BrickellHouse-Financial-Statement-${model.period.startDate}_to_${model.period.endDate}-${model.reportId}.pdf`;
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, {success:false, code:"METHOD_NOT_ALLOWED", message:"Method not allowed."});
  }

  try {
    const period = validateRequestBody(request);
    const user = await verifyManagementAuthorization(request);
    enforceRateLimit(request, {namespace:`management-financial-report:${user.id}`, limit:10, windowMs:10 * 60 * 1000});
    // Service-role reads begin only after the caller's user token and MFA-aware Management
    // authorization have both been verified above.
    const [orders, zeroDollarOrderCount] = await Promise.all([
      loadPaidOrders(period),
      countZeroDollarOrders(period)
    ]);
    if (!orders.length) {
      return sendJson(response, 404, {
        success:false,
        code:"NO_DATA",
        message:"No paid transactions were found for the selected period.",
        zeroDollarOrderCount
      });
    }
    const generatedAt = new Date();
    const model = buildFinancialReportModel({
      orders,
      period,
      zeroDollarOrderCount,
      reportId:createReportId(generatedAt),
      generatedAt
    });
    const pdf = await generateFinancialReportPdf(model);
    const filename = safeFilename(model);
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    response.setHeader("Content-Length", String(pdf.length));
    response.setHeader("X-Report-Id", model.reportId);
    return response.end(pdf);
  } catch (error) {
    const status = Number(error?.status) || 500;
    const safeStatus = [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(status) ? status : 500;
    const code = String(error?.code || "REPORT_GENERATION_FAILED");
    let safeMessage = "The financial report could not be generated. Please try again.";
    if (PUBLIC_ERROR_CODES.has(code)) safeMessage = String(error.message);
    else if (safeStatus === 422) safeMessage = "Paid transaction data could not be reconciled for the selected period.";
    else if (safeStatus === 429) safeMessage = "Too many report requests. Please try again later.";
    console.error("Management financial report request failed", {
      status:safeStatus,
      code,
      type:String(error?.name || "Error")
    });
    return sendJson(response, safeStatus, {
      success:false,
      code:PUBLIC_ERROR_CODES.has(code) ? code : "REPORT_GENERATION_FAILED",
      message:safeMessage
    });
  }
};
