const isLoginPage = document.body.classList.contains("auth-page");
let supabaseClient = null;
let managementProfile = null;

function authMessage(selector, message, success = false) {
  const element = document.querySelector(selector);
  if (!element) return;
  element.textContent = message;
  element.classList.remove("hidden");
  element.classList.toggle("success", success);
}

function safeNextUrl(value) {
  if (!value) return "/management/dashboard.html";
  try {
    const url = new URL(value, location.href);
    if (url.origin !== location.origin) return "/management/dashboard.html";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/management/dashboard.html";
  }
}

function managementRedirectUrl() {
  return `${location.origin}${location.pathname.replace(/\/[^/]*$/, "/")}login.html`;
}

function isLocalPrototypeHost() {
  return ["localhost", "127.0.0.1", ""].includes(location.hostname);
}

async function loadSupabaseClient() {
  if (!window.supabase?.createClient) throw new Error("Supabase client library did not load");
  const response = await fetch("/api/supabase-config", {headers:{"Accept":"application/json"}});
  if (!response.ok) throw new Error("Supabase configuration route is unavailable");
  const config = await response.json();
  if (!config.enabled) throw new Error("Supabase Auth is not configured");
  return window.supabase.createClient(config.url, config.anonKey, {
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
}

async function approvedProfile(user) {
  const {data, error} = await supabaseClient
    .from("management_users")
    .select("user_id,email,role,active,force_password_change")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function currentVerifiedSession() {
  const {data:{session}} = await supabaseClient.auth.getSession();
  if (!session?.user) return null;
  const {data:{user}, error} = await supabaseClient.auth.getUser();
  if (error || !user || user.id !== session.user.id) return null;
  return session;
}

async function logManagementAction(action, recordType = "management", recordId = null, beforeData = null, afterData = null) {
  if (!supabaseClient || !managementProfile) return;
  const payload = {
    actor_user_id:managementProfile.user_id,
    action,
    record_type:recordType,
    record_id:recordId,
    before_data:beforeData,
    after_data:afterData
  };
  try {
    await supabaseClient.from("audit_logs").insert(payload);
  } catch (error) {
    console.warn("Management audit log unavailable", error);
  }
}

window.logManagementAction = logManagementAction;
window.getManagementProfile = () => managementProfile;

async function requireApprovedManagement(session, redirect = true) {
  if (!session?.user) {
    return null;
  }
  const profile = await approvedProfile(session.user);
  if (!profile) {
    await supabaseClient.auth.signOut();
    return null;
  }
  managementProfile = profile;
  return profile;
}

async function initializeLoginPage() {
  const form = document.querySelector("#managementLoginForm");
  const resetForm = document.querySelector("#passwordResetForm");
  const recoveryForm = document.querySelector("#passwordRecoveryForm");
  const params = new URLSearchParams(location.search);
  if (params.get("error")) authMessage("#loginMessage", params.get("error"));

  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY" && recoveryForm) {
      form.classList.add("hidden");
      resetForm?.classList.add("hidden");
      recoveryForm.classList.remove("hidden");
      authMessage("#recoveryMessage", "Enter a new password for your management account.", true);
    }
  });

  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    submit.textContent = "Signing in...";
    document.querySelector("#loginMessage").classList.add("hidden");
    try {
      const {data:authData, error} = await supabaseClient.auth.signInWithPassword({
        email:data.email.trim(),
        password:data.password
      });
      if (error) throw error;
      if (authData.session) await supabaseClient.auth.setSession(authData.session);
      const verifiedSession = await currentVerifiedSession();
      if (!verifiedSession) throw new Error("Unable to verify the management session.");
      const profile = await requireApprovedManagement(verifiedSession || authData.session, false);
      if (!profile) throw new Error("This account is not approved for management access.");
      await logManagementAction("login", "management_user", profile.user_id, null, {email:profile.email, role:profile.role});
      const goLink = document.querySelector("#goManagementLink");
      if (goLink) {
        goLink.href = safeNextUrl(params.get("next"));
        goLink.classList.remove("hidden");
      }
      authMessage("#loginMessage", "Signed in successfully. Continue to Management when ready.", true);
      submit.textContent = "Signed in";
    } catch (error) {
      authMessage("#loginMessage", error.message || "Unable to sign in");
      submit.disabled = false;
      submit.textContent = "Sign in securely";
    }
  };

  resetForm.onsubmit = async event => {
    event.preventDefault();
    const submit = resetForm.querySelector('button[type="submit"]');
    const email = new FormData(resetForm).get("email").trim().toLowerCase();
    submit.disabled = true;
    try {
      const {error} = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo:managementRedirectUrl()
      });
      if (error) throw error;
      authMessage("#resetMessage", "If this email is approved for management, Supabase will send a password reset link.", true);
      resetForm.reset();
    } catch (error) {
      authMessage("#resetMessage", error.message || "Unable to send password reset email.");
    } finally {
      submit.disabled = false;
    }
  };

  recoveryForm.onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(recoveryForm));
    if (data.password !== data.confirmation) {
      authMessage("#recoveryMessage", "Passwords do not match.");
      return;
    }
    if (data.password.length < 12) {
      authMessage("#recoveryMessage", "Use at least 12 characters.");
      return;
    }
    const submit = recoveryForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const {error} = await supabaseClient.auth.updateUser({password:data.password});
      if (error) throw error;
      authMessage("#recoveryMessage", "Password updated. Sign in with your new password.", true);
      recoveryForm.reset();
      recoveryForm.classList.add("hidden");
      form.classList.remove("hidden");
      resetForm.classList.remove("hidden");
    } catch (error) {
      authMessage("#recoveryMessage", error.message || "Unable to update password.");
    } finally {
      submit.disabled = false;
    }
  };
}

async function initializeManagementAuth() {
  try {
    supabaseClient = await loadSupabaseClient();
    if (isLoginPage) await initializeLoginPage();
  } catch (error) {
    if (isLoginPage && isLocalPrototypeHost()) {
      const params = new URLSearchParams(location.search);
      const goLink = document.querySelector("#goManagementLink");
      if (goLink) {
        goLink.href = safeNextUrl(params.get("next"));
        goLink.classList.remove("hidden");
      }
      authMessage("#loginMessage", "Local static mode: Supabase login is unavailable here. Continue to Management for prototype testing.", true);
      return;
    }
    if (isLoginPage) authMessage("#loginMessage", `${error.message}. Run the Supabase setup before signing in.`);
  }
}

initializeManagementAuth();
