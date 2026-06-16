const {supabaseRequest} = require("./_supabase");

function send(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

function validEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return send(response, 405, {success:false,message:"Method not allowed"});
  }

  const {name, unit, email, category, message} = request.body || {};
  if (!String(name || "").trim()) return send(response, 400, {success:false,message:"Please enter your name."});
  if (!String(unit || "").trim()) return send(response, 400, {success:false,message:"Please enter your unit number."});
  if (!String(category || "").trim()) return send(response, 400, {success:false,message:"Please choose a feedback category."});
  if (!String(message || "").trim()) return send(response, 400, {success:false,message:"Please enter a feedback message."});
  if (!validEmail(email)) return send(response, 400, {success:false,message:"Please enter a valid email address."});

  try {
    const rows = await supabaseRequest("feedback", {
      method:"POST",
      body:[{
        resident_name:String(name).trim(),
        unit_number:String(unit).trim(),
        email:String(email || "").trim().toLowerCase() || null,
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
