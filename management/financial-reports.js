"use strict";

const REPORT_TIME_ZONE = "America/New_York";
let reportSupabaseClient = null;
let reportSession = null;

const byId = id => document.getElementById(id);

function redirectToManagementLogin() {
  const next = encodeURIComponent("/management/financial-reports.html");
  location.replace(`/management/login.html?next=${next}`);
}

function setMessage(message = "", tone = "error") {
  const element = byId("reportMessage");
  element.textContent = message;
  element.className = message ? `report-message ${tone}` : "report-message hidden";
}

function operationalDateOnly(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone:REPORT_TIME_ZONE, year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addUtcDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {timeZone:"UTC", month:"long", day:"numeric", year:"numeric"}).format(date);
}

function currentIsoWeekValue(value = operationalDateOnly()) {
  const local = new Date(`${value}T00:00:00Z`);
  const day = local.getUTCDay() || 7;
  local.setUTCDate(local.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(local.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((local - yearStart) / 86400000) + 1) / 7);
  return `${local.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function resolveIsoWeek(value) {
  const match = /^(\d{4})-W(\d{2})$/.exec(value || "");
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return null;
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryFourthDay = januaryFourth.getUTCDay() || 7;
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - januaryFourthDay + 1 + (week - 1) * 7);
  const startDate = monday.toISOString().slice(0, 10);
  return {startDate, endDate:addUtcDays(startDate, 6)};
}

function resolveMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return {startDate, endDate};
}

function resolvedPeriod() {
  const periodType = byId("reportPeriodType").value;
  if (periodType === "weekly") return {...(resolveIsoWeek(byId("reportWeek").value) || {}), periodType};
  if (periodType === "monthly") return {...(resolveMonth(byId("reportMonth").value) || {}), periodType};
  return {periodType, startDate:byId("reportStartDate").value, endDate:byId("reportEndDate").value};
}

function validDateRange(period) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.startDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(period.endDate || "")) return false;
  return new Date(`${period.endDate}T00:00:00Z`) >= new Date(`${period.startDate}T00:00:00Z`);
}

function updateResolvedPeriod() {
  const period = resolvedPeriod();
  const target = byId("resolvedReportDates");
  if (!validDateRange(period)) {
    target.textContent = "Select a valid period";
    return null;
  }
  target.textContent = `${formatDate(period.startDate)} - ${formatDate(period.endDate)}`;
  return period;
}

function updatePeriodControls() {
  const type = byId("reportPeriodType").value;
  byId("weeklyPeriodControl").classList.toggle("hidden", type !== "weekly");
  byId("monthlyPeriodControl").classList.toggle("hidden", type !== "monthly");
  byId("customPeriodControl").classList.toggle("hidden", type !== "custom");
  setMessage();
  updateResolvedPeriod();
}

function initializePeriodDefaults() {
  const today = operationalDateOnly();
  byId("reportWeek").value = currentIsoWeekValue(today);
  byId("reportMonth").value = today.slice(0, 7);
  byId("reportStartDate").value = `${today.slice(0, 7)}-01`;
  byId("reportEndDate").value = today;
  updateResolvedPeriod();
}

function setBusy(busy) {
  const form = byId("financialReportForm");
  const button = byId("generateFinancialReport");
  form.setAttribute("aria-busy", String(busy));
  button.disabled = busy;
  button.classList.toggle("loading", busy);
}

function safeDownloadFilename(response) {
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"\r\n]+)"/i);
  const candidate = match ? match[1] : `BrickellHouse-Financial-Statement-${operationalDateOnly()}.pdf`;
  return candidate.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
}

function downloadPdf(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function responseError(response) {
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    redirectToManagementLogin();
    return new Error("Management authorization is required.");
  }
  const error = new Error(payload.message || "The financial report could not be generated. Please try again.");
  error.code = payload.code || "REPORT_GENERATION_FAILED";
  return error;
}

async function generateReport(event) {
  event.preventDefault();
  setMessage();
  byId("reportResult").classList.add("hidden");
  const period = updateResolvedPeriod();
  if (!period || !validDateRange(period)) {
    setMessage("Choose a valid reporting period before generating the PDF.");
    return;
  }
  setBusy(true);
  try {
    const {data:{session}} = await reportSupabaseClient.auth.getSession();
    if (!session?.access_token) {
      redirectToManagementLogin();
      return;
    }
    const response = await fetch("/api/management-financial-report", {
      method:"POST",
      cache:"no-store",
      headers:{
        "Accept":"application/pdf, application/json",
        "Content-Type":"application/json",
        "Authorization":`Bearer ${session.access_token}`
      },
      body:JSON.stringify({periodType:period.periodType, startDate:period.startDate, endDate:period.endDate})
    });
    if (!response.ok) throw await responseError(response);
    if (!(response.headers.get("content-type") || "").toLowerCase().startsWith("application/pdf")) {
      throw new Error("The reporting service returned an unexpected response.");
    }
    const filename = safeDownloadFilename(response);
    const blob = await response.blob();
    downloadPdf(blob, filename);
    byId("reportResultDetail").textContent = `${filename} - ${formatDate(period.startDate)} through ${formatDate(period.endDate)} (${REPORT_TIME_ZONE}).`;
    byId("reportResult").classList.remove("hidden");
    setMessage("Financial statement generated successfully. The secure download has started.", "success");
  } catch (error) {
    setMessage(
      error.message || "The financial report could not be generated. Please try again.",
      error.code === "NO_DATA" ? "info" : "error"
    );
  } finally {
    setBusy(false);
  }
}

async function initializeReportPage() {
  try {
    if (!window.supabase?.createClient) throw new Error("Management authentication is unavailable.");
    const configResponse = await fetch("/api/supabase-config", {cache:"no-store", headers:{"Accept":"application/json"}});
    const config = await configResponse.json().catch(() => ({}));
    if (!configResponse.ok || !config.enabled) throw new Error("Management authentication is unavailable.");
    reportSupabaseClient = window.supabase.createClient(config.url, config.anonKey, {
      auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}
    });
    const {data:{session}} = await reportSupabaseClient.auth.getSession();
    if (!session?.user) return redirectToManagementLogin();
    const {data:{user}, error:userError} = await reportSupabaseClient.auth.getUser();
    if (userError || !user || user.id !== session.user.id) return redirectToManagementLogin();
    const {data:approved, error:approvalError} = await reportSupabaseClient.rpc("is_management_user");
    if (approvalError || approved !== true) return redirectToManagementLogin();
    const {data:profile, error:profileError} = await reportSupabaseClient
      .from("management_users")
      .select("user_id,email,active,mfa_required")
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();
    if (profileError || !profile) return redirectToManagementLogin();
    reportSession = session;
    byId("reportUserEmail").textContent = profile.email || user.email || "Approved Management";
    initializePeriodDefaults();
    byId("reportPeriodType").addEventListener("change", updatePeriodControls);
    ["reportWeek", "reportMonth", "reportStartDate", "reportEndDate"].forEach(id => byId(id).addEventListener("change", updateResolvedPeriod));
    byId("financialReportForm").addEventListener("submit", generateReport);
    byId("reportLogout").addEventListener("click", async () => {
      try { await reportSupabaseClient.auth.signOut(); } finally { redirectToManagementLogin(); }
    });
    reportSupabaseClient.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") redirectToManagementLogin();
    });
    byId("reportAccessState").classList.add("hidden");
    byId("reportPage").classList.remove("hidden");
  } catch {
    redirectToManagementLogin();
  }
}

initializeReportPage();
