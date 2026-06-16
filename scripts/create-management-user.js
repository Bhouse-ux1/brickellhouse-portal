const fs = require("node:fs");
const path = require("node:path");

function loadLocalEnvironment() {
  for (const filename of [".env.local", ".env"]) {
    const file = path.join(process.cwd(), filename);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.msg || payload.message || payload.error_description || `Request failed (${response.status})`);
  return payload;
}

async function main() {
  loadLocalEnvironment();
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = (process.env.MANAGEMENT_EMAIL || "admin@brickellhouse.net").trim().toLowerCase();
  const password = process.env.MANAGEMENT_TEMP_PASSWORD;
  if (!url || !serviceKey || !password) {
    throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and MANAGEMENT_TEMP_PASSWORD are required.");
  }

  const headers = {
    "apikey":serviceKey,
    "Authorization":`Bearer ${serviceKey}`,
    "Content-Type":"application/json"
  };
  let user;
  try {
    user = await request(`${url}/auth/v1/admin/users`, {
      method:"POST",
      headers,
      body:JSON.stringify({
        email,
        password,
        email_confirm:true,
        user_metadata:{force_password_change:true}
      })
    });
  } catch (createError) {
    const users = await request(`${url}/auth/v1/admin/users?page=1&per_page=1000`, {headers});
    user = users.users?.find(candidate => candidate.email?.toLowerCase() === email);
    if (!user) throw createError;
  }

  await request(`${url}/rest/v1/management_users?on_conflict=user_id`, {
    method:"POST",
    headers:{...headers,"Prefer":"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify({
      user_id:user.id,
      email,
      role:"admin",
      active:true,
      force_password_change:true
    })
  });
  console.log(`Management user is ready: ${email}`);
  console.log("The user must change the temporary password on first login.");
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
