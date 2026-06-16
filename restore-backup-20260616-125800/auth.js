const isLoginPage = document.body.classList.contains("auth-page");
let supabaseClient = null;
let managementProfile = null;
let authRedirectInProgress = false;
const MANAGEMENT_AUTH_WAIT_MS = 9000;
const MANAGEMENT_AUTH_RETRY_MS = 300;

function authMessage(selector, message, success = false) {
  const element = document.querySelector(selector);
  if (!element) return;
  element.textContent = message;
  element.classList.remove("hidden");
  element.classList.toggle("success", success);
}

function managementLoginUrl(params = {}) {
  const search = new URLSearchParams({next:"/#management", ...params});
  return `/login.html?${search.toString()}`;
}

function redirectOnce(url) {
  if (authRedirectInProgress) return;
  authRedirectInProgress = true;
  location.replace(url);
}

window.requestManagementAccess = () => redirectOnce(managementLoginUrl());

function safeNextUrl(value) {
  if (!value) return "/#management";
  try {
    const url = new URL(value, location.href);
    if (url.origin !== location.origin) return "/#management";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/#management";
  }
}

function managementRedirectUrl() {
  return `${location.origin}${location.pathname.replace(/\/[^/]*$/, "/")}login.html`;
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForApprovedManagement(timeoutMs = MANAGEMENT_AUTH_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() <= deadline) {
    try {
      const session = await currentVerifiedSession();
      if (session?.user) {
        const profile = await approvedProfile(session.user);
        if (profile) {
          managementProfile = profile;
          return {session, profile};
        }
        return {session, profile:null};
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(MANAGEMENT_AUTH_RETRY_MS);
  }

  if (lastError) throw lastError;
  return {session:null, profile:null};
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
    if (redirect) redirectOnce(managementLoginUrl());
    return null;
  }
  const profile = await approvedProfile(session.user);
  if (!profile) {
    await supabaseClient.auth.signOut();
    if (redirect) redirectOnce(`login.html?error=${encodeURIComponent("This account is not approved for management access.")}`);
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

function openPasswordChange() {
  document.querySelector("#adminShell")?.classList.remove("open");
  document.querySelector("#passwordChangeModal")?.classList.add("open");
}

async function initializePortalAuth() {
  const adminOpen = document.querySelector("#adminOpen");
  const adminShell = document.querySelector("#adminShell");
  const adminLogout = document.querySelector("#adminLogout");
  const needsManagement = location.hash === "#management";
  const {session, profile} = await waitForApprovedManagement(needsManagement ? MANAGEMENT_AUTH_WAIT_MS : 1200);

  if (profile) {
    window.managementAccessGranted = true;
    adminOpen.classList.remove("hidden");
    adminOpen.textContent = "Management";
    document.querySelector("#adminUserEmail").textContent = profile.email || session.user.email;
    adminOpen.onclick = () => {
      if (managementProfile.force_password_change) return openPasswordChange();
      adminShell.classList.add("open");
      renderAdmin();
    };
    if (needsManagement) {
      if (profile.force_password_change) openPasswordChange();
      else {
        adminShell.classList.add("open");
        renderAdmin();
      }
    }
  }

  if (needsManagement && !managementProfile) {
    if (session?.user) {
      await supabaseClient.auth.signOut();
      redirectOnce(managementLoginUrl({error:"This account is not approved for management access."}));
    } else {
      redirectOnce(managementLoginUrl());
    }
    return;
  }

  adminLogout.onclick = async () => {
    await logManagementAction("logout", "management_user", managementProfile?.user_id || null);
    await supabaseClient.auth.signOut();
    window.managementAccessGranted = false;
    adminShell.classList.remove("open");
    adminOpen.classList.add("hidden");
    clearManagementDom();
    redirectOnce("./#home");
  };

  const passwordForm = document.querySelector("#passwordChangeForm");
  passwordForm.onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(passwordForm));
    if (data.password !== data.confirmation) {
      authMessage("#passwordChangeMessage", "Passwords do not match.");
      return;
    }
    if (data.password.length < 12) {
      authMessage("#passwordChangeMessage", "Use at least 12 characters.");
      return;
    }
    const submit = passwordForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const {error:updateError} = await supabaseClient.auth.updateUser({password:data.password});
      if (updateError) throw updateError;
      const {error:profileError} = await supabaseClient
        .from("management_users")
        .update({force_password_change:false})
        .eq("user_id", managementProfile.user_id);
      if (profileError) throw profileError;
      managementProfile.force_password_change = false;
      await logManagementAction("password_change", "management_user", managementProfile.user_id);
      document.querySelector("#passwordChangeModal").classList.remove("open");
      adminShell.classList.add("open");
      renderAdmin();
      passwordForm.reset();
    } catch (error) {
      authMessage("#passwordChangeMessage", error.message || "Unable to update password.");
    } finally {
      submit.disabled = false;
    }
  };

  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      window.managementAccessGranted = false;
      adminShell.classList.remove("open");
      adminOpen.classList.add("hidden");
      clearManagementDom();
    }
  });
}

function clearManagementDom() {
  ["#adminOverview","#productTable","#orderTable","#feedbackAdminList"].forEach(selector => {
    const element = document.querySelector(selector);
    if (element) element.innerHTML = "";
  });
}

async function initializeManagementAuth() {
  try {
    supabaseClient = await loadSupabaseClient();
    if (isLoginPage) await initializeLoginPage();
    else await initializePortalAuth();
  } catch (error) {
    if (isLoginPage) authMessage("#loginMessage", `${error.message}. Run the Supabase setup before signing in.`);
    else {
      const adminOpen = document.querySelector("#adminOpen");
      if (adminOpen) adminOpen.classList.add("hidden");
      if (location.hash === "#management") redirectOnce(managementLoginUrl());
    }
  }
}

initializeManagementAuth();
