const {supabaseRequest} = require("./_supabase");

const MAX_ROWS = 1000;
const VALID_STATUSES = new Set(["New", "Reviewed", "Resolved", "Ignored"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function requireApprovedManagement(request, response) {
  const token = bearerToken(request);
  if (!token) {
    send(response, 401, {success:false,message:"Management login required."});
    return null;
  }

  const user = await getSupabaseUser(token);
  if (!user?.id) {
    send(response, 401, {success:false,message:"Management login required."});
    return null;
  }

  const profile = await approvedManagementUser(user.id);
  if (!profile) {
    send(response, 403, {success:false,message:"Approved management access required."});
    return null;
  }

  return {user,profile};
}

async function getConversationReviews(response) {
  const since = encodeURIComponent(isoDaysAgo(90));
  const select = [
    "id",
    "conversation_id",
    "created_at",
    "last_message_at",
    "detected_language",
    "detected_topic",
    "category",
    "confidence",
    "status",
    "management_note",
    "messages",
    "privacy_redacted",
    "reviewed_at",
    "reviewed_by",
    "updated_at"
  ].join(",");
  await supabaseRequest("rpc/purge_old_luna_conversation_reviews", {
    method:"POST",
    body:{},
    prefer:"return=minimal"
  });
  const rows = await supabaseRequest(`luna_conversation_reviews?select=${select}&last_message_at=gte.${since}&order=last_message_at.desc&limit=${MAX_ROWS}`);
  return send(response, 200, {success:true,conversations:Array.isArray(rows) ? rows : []});
}

async function updateConversationReview(request, response, user) {
  const conversationId = String(request.body?.conversationId || "").trim();
  const status = String(request.body?.status || "").trim();
  const managementNote = String(request.body?.managementNote ?? "").trim().slice(0, 2000);

  if (!UUID_PATTERN.test(conversationId)) {
    return send(response, 400, {success:false,message:"Valid conversation ID is required."});
  }
  if (!VALID_STATUSES.has(status)) {
    return send(response, 400, {success:false,message:"Valid review status is required."});
  }

  const reviewed = status === "New" ? {reviewed_at:null,reviewed_by:null} : {
    reviewed_at:new Date().toISOString(),
    reviewed_by:user.id
  };
  const body = {
    status,
    management_note:managementNote,
    updated_at:new Date().toISOString(),
    ...reviewed
  };
  const rows = await supabaseRequest(`luna_conversation_reviews?conversation_id=eq.${encodeURIComponent(conversationId)}&select=*`, {
    method:"PATCH",
    body,
    prefer:"return=representation"
  });
  if (!Array.isArray(rows) || !rows[0]) {
    return send(response, 404, {success:false,message:"Conversation review not found."});
  }
  return send(response, 200, {success:true,conversation:rows[0]});
}

module.exports = async function handler(request, response) {
  if (!["GET", "PATCH"].includes(request.method)) {
    response.setHeader("Allow", "GET, PATCH");
    return send(response, 405, {success:false,message:"Method not allowed"});
  }

  try {
    const approved = await requireApprovedManagement(request, response);
    if (!approved) return;

    if (request.method === "GET") return getConversationReviews(response);
    return updateConversationReview(request, response, approved.user);
  } catch (error) {
    console.error("Luna conversation review route failed", error?.message || "Error");
    return send(response, 500, {success:false,message:"Luna conversation review is unavailable."});
  }
};

