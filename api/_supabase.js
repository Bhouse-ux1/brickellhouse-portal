function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function supabaseConfig() {
  return {
    url: requiredEnv("SUPABASE_URL").replace(/\/$/, ""),
    serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY")
  };
}

async function supabaseRequest(path, {method = "GET", body, prefer = "return=representation"} = {}) {
  const {url, serviceRoleKey} = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers:{
      "apikey":serviceRoleKey,
      "Authorization":`Bearer ${serviceRoleKey}`,
      "Content-Type":"application/json",
      "Accept":"application/json",
      "Prefer":prefer
    },
    body:body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = {message:text};
  }
  if (!response.ok) {
    const parts = [
      payload?.message || payload?.error_description || "Supabase request failed",
      payload?.code ? `code ${payload.code}` : "",
      payload?.hint ? `hint: ${payload.hint}` : ""
    ].filter(Boolean);
    const message = parts.join("; ");
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function assertSupabaseStorageReady() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing");
  }
  await supabaseRequest("orders?select=id&limit=1", {method:"GET", prefer:""});
  await supabaseRequest("order_items?select=id&limit=1", {method:"GET", prefer:""});
  await supabaseRequest("payment_events?select=id&limit=1", {method:"GET", prefer:""});
}

module.exports = {supabaseRequest, assertSupabaseStorageReady};
