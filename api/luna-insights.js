const {supabaseRequest} = require("./_supabase");

const MAX_ROWS = 1500;

function send(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function bearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

async function getSupabaseUser(token) {
  const url = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const result = await fetch(`${url}/auth/v1/user`, {
    headers:{
      "apikey":serviceRoleKey,
      "Authorization":`Bearer ${token}`,
      "Accept":"application/json"
    }
  });
  if (!result.ok) return null;
  return result.json();
}

async function approvedManagementUser(userId) {
  const encodedUserId = encodeURIComponent(userId);
  const rows = await supabaseRequest(`management_users?select=user_id,email,role,active&user_id=eq.${encodedUserId}&active=eq.true&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return send(response, 405, {success:false,message:"Method not allowed"});
  }

  try {
    const token = bearerToken(request);
    if (!token) return send(response, 401, {success:false,message:"Management login required."});

    const user = await getSupabaseUser(token);
    if (!user?.id) return send(response, 401, {success:false,message:"Management login required."});

    const profile = await approvedManagementUser(user.id);
    if (!profile) return send(response, 403, {success:false,message:"Approved management access required."});

    const since = encodeURIComponent(isoDaysAgo(365));
    const select = [
      "id",
      "created_at",
      "detected_language",
      "detected_topic",
      "category",
      "confidence",
      "clarification_requested",
      "outcome",
      "source",
      "redacted_question_snippet",
      "response_kind",
      "history_message_count"
    ].join(",");
    const rows = await supabaseRequest(`luna_insights?select=${select}&created_at=gte.${since}&order=created_at.desc&limit=${MAX_ROWS}`);
    return send(response, 200, {success:true,insights:Array.isArray(rows) ? rows : []});
  } catch (error) {
    console.error("Luna insights route failed", error?.message || "Error");
    return send(response, 500, {success:false,message:"Luna insights are unavailable."});
  }
};
