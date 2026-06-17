const {supabaseRequest} = require("./_supabase");

const FEEDBACK_LIMIT_MESSAGE = "Please wait 96 hours before submitting another feedback request. If this matter is urgent, please contact Management at admin@brickellhouse.net or 305-400-9661.";
const FEEDBACK_LIMIT_HOURS = 96;
const FEEDBACK_LIMIT_MAX = 2;

function send(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

function validEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase() || null;
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function normalizeUnit(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase() || null;
}

function getRequestIp(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const candidate = String(firstForwarded || request.headers["x-real-ip"] || request.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
  return candidate || null;
}

function escapePostgrestValue(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

async function enforceFeedbackRateLimit({email, phone, unit, ip}) {
  const checks = [
    email ? `normalized_email.eq."${escapePostgrestValue(email)}"` : "",
    phone ? `normalized_phone.eq."${escapePostgrestValue(phone)}"` : "",
    unit ? `normalized_unit.eq."${escapePostgrestValue(unit)}"` : "",
    ip ? `request_ip.eq."${escapePostgrestValue(ip)}"` : ""
  ].filter(Boolean);
  if (!checks.length) return;
  const since = new Date(Date.now() - FEEDBACK_LIMIT_HOURS * 60 * 60 * 1000).toISOString();
  const query = [
    "select=id",
    `submitted_at=gte.${encodeURIComponent(since)}`,
    `or=(${encodeURIComponent(checks.join(","))})`,
    `limit=${FEEDBACK_LIMIT_MAX}`
  ].join("&");
  const rows = await supabaseRequest(`feedback?${query}`, {method:"GET", prefer:""});
  if ((rows || []).length >= FEEDBACK_LIMIT_MAX) {
    const error = new Error(FEEDBACK_LIMIT_MESSAGE);
    error.status = 429;
    throw error;
  }
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return send(response, 405, {success:false,message:"Method not allowed"});
  }

  const {name, unit, email, phone, category, message} = request.body || {};
  if (!String(name || "").trim()) return send(response, 400, {success:false,message:"Please enter your name."});
  if (!String(unit || "").trim()) return send(response, 400, {success:false,message:"Please enter your unit number."});
  if (!String(category || "").trim()) return send(response, 400, {success:false,message:"Please choose a feedback category."});
  if (!String(message || "").trim()) return send(response, 400, {success:false,message:"Please enter a feedback message."});
  if (!validEmail(email)) return send(response, 400, {success:false,message:"Please enter a valid email address."});

  try {
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);
    const normalizedUnit = normalizeUnit(unit);
    const requestIp = getRequestIp(request);
    await enforceFeedbackRateLimit({
      email:normalizedEmail,
      phone:normalizedPhone,
      unit:normalizedUnit,
      ip:requestIp
    });
    const rows = await supabaseRequest("feedback", {
      method:"POST",
      body:[{
        resident_name:String(name).trim(),
        unit_number:String(unit).trim(),
        email:normalizedEmail,
        phone:normalizedPhone,
        normalized_email:normalizedEmail,
        normalized_phone:normalizedPhone,
        normalized_unit:normalizedUnit,
        request_ip:requestIp,
        category:String(category).trim(),
        message:String(message).trim(),
        status:"New",
        management_response:"",
        internal_notes:"",
        responded_at:null
      }]
    });
    const record = Array.isArray(rows) ? rows[0] : rows;
    return send(response, 200, {success:true,feedback:{id:record.id,submittedAt:record.submitted_at}});
  } catch (error) {
    const message = String(error.message || "Unable to save feedback");
    const permissionHelp = message.toLowerCase().includes("permission denied")
      ? " Feedback storage permissions are not ready. Run the latest Supabase resident persistence grants migration and verify SUPABASE_SERVICE_ROLE_KEY is the service-role key."
      : "";
    return send(response, error.status || 500, {success:false,message:`${message}.${permissionHelp}`.trim()});
  }
};
