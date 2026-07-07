const ORDER_STATUSES = ["Received", "Processing", "Ready for Pickup", "Completed", "Cancelled"];
const FEEDBACK_STATUSES = ["New", "In Review", "Completed", "Closed"];
const FEEDBACK_STORAGE_KEY = "bh_feedback";

let feedbackRecords = [];
let checkoutProvider = "square";
let stripeConfig = {enabled:false, provider:"square", publishableKey:""};
let stripeClient = null;
let stripeEmbeddedCheckout = null;
let paymentInProgress = false;
const FRIENDLY_PAYMENT_ERROR = "Sorry, your payment did not go through. Please check your card information, expiration date, and CVV, then try again.";
const PAYMENT_CANCELLED_MESSAGE = "Payment was not completed. Please try again when you are ready.";
const UNIT_VALIDATION_MESSAGE = "Please check unit number and try again.";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[character]));

function persistFeedback() {
  localStorage.removeItem(FEEDBACK_STORAGE_KEY);
}

function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function auditRoadmapManagement(action, recordType = "management", recordId = null, beforeData = null, afterData = null) {
  window.recordManagementAudit?.(action, recordType, recordId, beforeData, afterData);
}

function orderLines(number) {
  return orders.filter(order => order.number.toUpperCase() === number.toUpperCase());
}

async function updateOrder(number, changes) {
  const before = orderLines(number).map(order => ({...order}));
  orderLines(number).forEach(order => Object.assign(order, changes));
  await window.saveOrderToSupabase?.(number, changes);
  persist();
  auditRoadmapManagement("order_update", "order", number, before, orderLines(number));
}

function orderPaymentClass(status) {
  const value = String(status || "").toLowerCase();
  if (value === "paid") return "paid";
  if (value.includes("fail")) return "failed";
  if (value.includes("pending")) return "pending";
  return "";
}

function renderOrderTableRoadmap() {
  if (!$("#orderTable")) return;
  const matches = matchingOrders();
  $("#orderTable").innerHTML = matches.slice().reverse().map(order => {
    const subtotal = order.price * order.quantity;
    const fee = +order.processingFee || 0;
    const acceptance = order.legalAccepted
      ? `<strong>Yes</strong>${escapeHtml(order.legalAcceptedAt)}<br><small>Version ${escapeHtml(order.legalNoticeVersion || "Not recorded")}</small>`
      : `<span class="acceptance-missing">Not recorded</span>`;
    const payment = `<span class="payment-pill ${orderPaymentClass(order.paymentStatus)}">${escapeHtml(order.paymentStatus || "Not recorded")}</span>${order.squareTransactionId ? `<br><small>${escapeHtml(order.squareTransactionId)}</small>` : ""}`;
    return `<tr>
      <td>${escapeHtml(order.number)}</td>
      <td><strong>${escapeHtml(order.name)}</strong>Unit ${escapeHtml(order.unit)}</td>
      <td>${escapeHtml(order.product)}<br><small>${escapeHtml(order.internalName || `${order.product} - GL ${order.glCode}`)}</small></td>
      <td>${order.quantity}</td>
      <td>${money(subtotal + fee)}</td>
      <td>${payment}</td>
      <td>${escapeHtml(order.glCode)}</td>
      <td>${formatDate(order.date)}</td>
      <td><select class="order-status-select" data-order-status="${escapeHtml(order.number)}">${ORDER_STATUSES.map(status => `<option ${status === order.status ? "selected" : ""}>${status}</option>`).join("")}</select></td>
      <td>${acceptance}</td>
      <td class="order-notes">
        <textarea data-public-note="${escapeHtml(order.number)}" placeholder="Public pickup note">${escapeHtml(order.publicNote)}</textarea>
        <textarea data-internal-note="${escapeHtml(order.number)}" placeholder="Internal management note">${escapeHtml(order.internalNote)}</textarea>
        <button class="table-action" data-save-order="${escapeHtml(order.number)}">Save notes</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="11">No orders match this search.</td></tr>`;
  if ($("#orderSearchCount")) $("#orderSearchCount").textContent = `${matches.length} line item${matches.length === 1 ? "" : "s"} found`;

  $$("[data-order-status]").forEach(select => {
    select.onchange = async () => {
      try {
        await updateOrder(select.dataset.orderStatus, {status:select.value});
        toast(`Order status updated to ${select.value}`);
      } catch (error) {
        toast(error.message || "Unable to update order status");
      }
      renderOrderTableRoadmap();
    };
  });
  $$("[data-save-order]").forEach(button => {
    button.onclick = async () => {
      const number = button.dataset.saveOrder;
      const publicNote = $(`[data-public-note="${CSS.escape(number)}"]`).value.trim();
      const internalNote = $(`[data-internal-note="${CSS.escape(number)}"]`).value.trim();
      try {
        await updateOrder(number, {publicNote, internalNote});
        toast("Order notes saved");
      } catch (error) {
        toast(error.message || "Unable to save order notes");
      }
    };
  });
}

renderOrderTable = renderOrderTableRoadmap;

function feedbackStatusClass(status) {
  return `status-${status.toLowerCase().replaceAll(" ", "-")}`;
}

function normalizeFeedbackStatus(status) {
  return status === "Answered" ? "Completed" : status;
}

function matchingFeedback() {
  const query = ($("#feedbackSearch")?.value || "").trim().toLowerCase();
  const status = $("#feedbackStatusFilter")?.value || "All";
  const category = $("#feedbackCategoryFilter")?.value || "All";
  const date = $("#feedbackDateFilter")?.value || "";
  return feedbackRecords.filter(record => {
    const recordStatus = normalizeFeedbackStatus(record.status);
    const matchesQuery = !query || [record.name,record.unit,record.email,record.phone,record.message].some(value => String(value || "").toLowerCase().includes(query));
    return matchesQuery &&
      (status === "All" || recordStatus === status) &&
      (category === "All" || record.category === category) &&
      (!date || record.dateSubmitted.slice(0, 10) === date);
  });
}

function renderFeedbackAdmin() {
  const container = $("#feedbackAdminList");
  if (!container) return;
  const matches = matchingFeedback().sort((a, b) => b.dateSubmitted.localeCompare(a.dateSubmitted));
  container.innerHTML = matches.map(record => {
    const status = normalizeFeedbackStatus(record.status);
    return `
    <article class="feedback-record" data-feedback-record="${record.id}">
      <button class="feedback-record-toggle" type="button" data-feedback-toggle="${record.id}" aria-expanded="false">
        <span><small>Unit</small><strong>${escapeHtml(record.unit)}</strong></span>
        <span><small>Resident</small><strong>${escapeHtml(record.name)}</strong></span>
        <span><small>Type</small><strong>${escapeHtml(record.category)}</strong></span>
        <span><small>Status</small><b class="status-pill feedback-status ${feedbackStatusClass(status)}">${escapeHtml(status)}</b></span>
        <span><small>Submitted</small><strong>${formatResidentDateTime(record.dateSubmitted)}</strong></span>
      </button>
      <div class="feedback-record-body">
        <div class="feedback-record-detail">
          <p><strong>Message</strong>${escapeHtml(record.message)}</p>
          <p><strong>Email</strong>${record.email ? escapeHtml(record.email) : "Not provided"}</p>
          <p><strong>Phone</strong>${record.phone ? escapeHtml(record.phone) : "Not provided"}</p>
        </div>
        <div class="feedback-record-grid">
          <label><span>Status</span><select data-feedback-status="${record.id}">${FEEDBACK_STATUSES.map(option => `<option ${option === status ? "selected" : ""}>${option}</option>`).join("")}</select></label>
          <label><span>Management response</span><textarea data-feedback-response="${record.id}">${escapeHtml(record.managementResponse)}</textarea></label>
          <label><span>Internal notes</span><textarea data-feedback-notes="${record.id}">${escapeHtml(record.internalNotes)}</textarea></label>
        </div>
        <div class="feedback-record-actions"><button class="table-action" data-delete-feedback="${record.id}">Delete</button><button class="primary-button" data-save-feedback="${record.id}">Save feedback record</button></div>
      </div>
    </article>
  `}).join("") || `<div class="admin-panel">No feedback matches the current filters.</div>`;

  $$("[data-feedback-toggle]").forEach(button => {
    button.onclick = () => {
      const record = button.closest(".feedback-record");
      const expanded = record.classList.toggle("expanded");
      button.setAttribute("aria-expanded", String(expanded));
    };
  });
  $$("[data-save-feedback]").forEach(button => {
    button.onclick = async () => {
      const record = feedbackRecords.find(item => item.id === button.dataset.saveFeedback);
      const before = {...record};
      const status = $(`[data-feedback-status="${record.id}"]`).value;
      const changes = {
        status,
        managementResponse:$(`[data-feedback-response="${record.id}"]`).value.trim(),
        internalNotes:$(`[data-feedback-notes="${record.id}"]`).value.trim(),
        dateResponded:status === "Completed" && $(`[data-feedback-response="${record.id}"]`).value.trim() ? new Date().toISOString() : record.dateResponded
      };
      try {
        await window.saveFeedbackToSupabase?.(record.id, changes);
        Object.assign(record, changes);
        persistFeedback();
        renderFeedbackAdmin();
        renderRoadmapMetrics();
        toast("Feedback record saved");
        auditRoadmapManagement("feedback_response_update", "feedback", record.id, before, record);
      } catch (error) {
        toast(error.message || "Unable to save feedback record");
      }
    };
  });
  $$("[data-delete-feedback]").forEach(button => {
    button.onclick = async () => {
      if (!confirm("Delete this feedback record?")) return;
      const deleted = feedbackRecords.find(record => record.id === button.dataset.deleteFeedback);
      try {
        await window.deleteFeedbackFromSupabase?.(button.dataset.deleteFeedback);
        feedbackRecords = feedbackRecords.filter(record => record.id !== button.dataset.deleteFeedback);
        persistFeedback();
        renderFeedbackAdmin();
        renderRoadmapMetrics();
        toast("Feedback record deleted");
        auditRoadmapManagement("feedback_delete", "feedback", button.dataset.deleteFeedback, deleted, null);
      } catch (error) {
        toast(error.message || "Unable to delete feedback record");
      }
    };
  });
}

function formatResidentDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month:"2-digit",day:"2-digit",year:"numeric",hour:"numeric",minute:"2-digit"
  }).format(new Date(value));
}

function renderRoadmapMetrics() {
  const grid = $("#adminOverview .metric-grid");
  if (!grid) return;
  const existing = $("#feedbackMetric");
  if (existing) existing.remove();
  const newFeedback = feedbackRecords.filter(record => ["New", "In Review"].includes(normalizeFeedbackStatus(record.status))).length;
  grid.insertAdjacentHTML("beforeend", `<button class="metric metric-button" id="feedbackMetric"><span>New feedback</span><strong>${newFeedback}</strong><small>Review messages</small></button>`);
  $("#feedbackMetric").onclick = () => showAdminView("feedback");
}

const renderAdminBase = renderAdmin;
renderAdmin = function renderAdminWithRoadmap() {
  if (!window.managementAccessGranted) return;
  renderAdminBase();
  renderFeedbackAdmin();
  renderRoadmapMetrics();
};

if ($("#trackingForm")) $("#trackingForm").onsubmit = async event => {
  event.preventDefault();
  const number = new FormData(event.target).get("orderNumber").trim().toUpperCase();
  const result = $("#trackingResult");
  result.classList.remove("hidden", "error");
  result.innerHTML = "<strong>Checking order...</strong>";
  try {
    const response = await fetch(`/api/order-status?number=${encodeURIComponent(number)}`, {headers:{"Accept":"application/json"}});
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.message || "Order not found");
    result.innerHTML = `<div class="tracking-status"><span>Current Status</span><strong>${escapeHtml(payload.order.status)}</strong></div>${payload.order.publicNote ? `<p>${escapeHtml(payload.order.publicNote)}</p>` : ""}`;
  } catch (error) {
    result.classList.add("error");
    result.innerHTML = `<strong>Order not found.</strong><br>Check the order ID and try again, or contact management for assistance.`;
  }
};

let feedbackReturnFocus = null;

function showFeedbackView(view) {
  ["feedbackChoiceView","feedbackFormView","feedbackThanksView"].forEach(id => {
    $(`#${id}`)?.classList.toggle("hidden", id !== view);
  });
}

function resetFeedbackFlow() {
  $("#feedbackForm")?.reset();
  if ($("#feedbackCategory")) $("#feedbackCategory").value = "";
  if ($("#feedbackSelectedType")) $("#feedbackSelectedType").textContent = "Feedback";
  if ($("#feedbackConfirmation")) {
    $("#feedbackConfirmation").classList.add("hidden");
    $("#feedbackConfirmation").innerHTML = "";
  }
  showFeedbackView("feedbackChoiceView");
}

function openFeedbackFlow() {
  feedbackReturnFocus = document.activeElement;
  resetFeedbackFlow();
  $("#feedbackModal")?.classList.add("open");
  requestAnimationFrame(() => $("[data-feedback-category]")?.focus());
}

function closeFeedbackFlow() {
  $("#feedbackModal")?.classList.remove("open");
  resetFeedbackFlow();
  feedbackReturnFocus?.focus?.();
}

if ($("#feedbackOpen")) $("#feedbackOpen").addEventListener("click", openFeedbackFlow);
if ($("#feedbackClose")) $("#feedbackClose").addEventListener("click", closeFeedbackFlow);
if ($("#feedbackDone")) $("#feedbackDone").addEventListener("click", closeFeedbackFlow);
if ($("#feedbackBack")) $("#feedbackBack").addEventListener("click", () => showFeedbackView("feedbackChoiceView"));
if ($("#feedbackModal")) $("#feedbackModal").addEventListener("click", event => {
  if (event.target === event.currentTarget) closeFeedbackFlow();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && $("#feedbackModal")?.classList.contains("open")) closeFeedbackFlow();
});
$$('[data-feedback-category]').forEach(button => button.addEventListener("click", () => {
  $("#feedbackCategory").value = button.dataset.feedbackCategory;
  $("#feedbackSelectedType").textContent = button.dataset.feedbackLabel;
  showFeedbackView("feedbackFormView");
  requestAnimationFrame(() => $('#feedbackForm [name="name"]')?.focus());
}));

if ($("#feedbackForm")) $("#feedbackForm").onsubmit = async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const confirmation = $("#feedbackConfirmation");
  confirmation.classList.remove("hidden");
  const normalizedUnit = normalizeUnitNumber(data.unit);
  if (!normalizedUnit) {
    confirmation.innerHTML = `<strong>${UNIT_VALIDATION_MESSAGE}</strong>`;
    toast(UNIT_VALIDATION_MESSAGE);
    return;
  }
  data.unit = normalizedUnit;
  event.target.elements.unit.value = normalizedUnit;
  confirmation.innerHTML = `<strong>Sending feedback...</strong>`;
  try {
    const response = await fetch("/api/feedback", {
      method:"POST",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify(data)
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.message || "Unable to save feedback");
    event.target.reset();
    confirmation.classList.add("hidden");
    confirmation.innerHTML = "";
    showFeedbackView("feedbackThanksView");
  } catch (error) {
    confirmation.innerHTML = `<strong>Feedback was not submitted.</strong><br><br>${escapeHtml(error.message || "Please try again.")}`;
  }
};

["feedbackSearch","feedbackStatusFilter","feedbackCategoryFilter","feedbackDateFilter"].forEach(id => {
  if ($(`#${id}`)) $(`#${id}`).addEventListener(id === "feedbackSearch" ? "input" : "change", renderFeedbackAdmin);
});

if ($("#exportFeedback")) $("#exportFeedback").onclick = () => {
  downloadCsv(`BrickellHouse-Feedback-${fileDate()}.csv`, [
    ["Feedback ID","Resident Name","Unit","Email","Phone","Category","Message","Date Submitted","Status","Management Response","Date Responded","Internal Notes"],
    ...feedbackRecords.map(record => [
      record.id,record.name,record.unit,record.email,record.phone,record.category,record.message,
      formatResidentDateTime(record.dateSubmitted),record.status,record.managementResponse,
      formatResidentDateTime(record.dateResponded),record.internalNotes
    ])
  ]);
  toast("Feedback report exported");
  auditRoadmapManagement("export_feedback", "export", "feedback", null, {rows:feedbackRecords.length});
};

if ($("#exportOrders")) $("#exportOrders").onclick = () => {
  downloadCsv(`BrickellHouse-Orders-${fileDate()}.csv`, [
    ["Order Number","Resident Name","Unit Number","Product","Internal / Square Name","Quantity","Unit Price","Subtotal","Processing Fee","Fee GL Code","Total","Hidden Product GL Code","Date","Order Status","Public Note","Internal Note","Payment Status","Payment Transaction ID","Payment Date/Time","Legal Notice Accepted","Acceptance Date/Time","Legal Notice Version","Terms Version","Privacy Policy Version"],
    ...orders.map(order => {
      const subtotal = order.price * order.quantity;
      const fee = +order.processingFee || 0;
      return [
        order.number,order.name,order.unit,order.product,order.internalName || `${order.product} - GL ${order.glCode}`,
        order.quantity,order.price,subtotal,fee,order.feeGlCode || "",subtotal + fee,order.glCode,
        formatDate(order.date),order.status,order.publicNote,order.internalNote,order.paymentStatus,
        order.squareTransactionId,order.paymentDateTime || "",order.legalAccepted ? "Yes" : "Not recorded",
        order.legalAcceptedAt || "",order.legalNoticeVersion || "",order.termsVersion || "",order.privacyPolicyVersion || ""
      ];
    })
  ]);
  toast("Excel-compatible report exported");
  auditRoadmapManagement("export_orders", "export", "orders", null, {rows:orders.length});
};

function loadExternalScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function hideApplePay() {
  $("#applePayOption")?.classList.add("hidden");
}

async function loadStripeScript() {
  if (window.Stripe) return;
  await loadExternalScript("https://js.stripe.com/v3/");
}

function resetStripeCheckout() {
  if (stripeEmbeddedCheckout?.destroy) stripeEmbeddedCheckout.destroy();
  stripeEmbeddedCheckout = null;
  $("#stripeEmbeddedCheckout") && ($("#stripeEmbeddedCheckout").innerHTML = "");
  $("#stripeCheckoutContainer")?.classList.add("hidden");
}

function paidCheckoutRequired() {
  const subtotal = cartSubtotal();
  return cart.length > 0 && subtotal + processingFee(subtotal) > 0;
}

function setCheckoutSubmitLabel(label) {
  const submit = $("#checkoutSubmit");
  if (submit) submit.innerHTML = `${label} <span>&rarr;</span>`;
}

function syncStripeCheckoutDisplay() {
  const container = $("#stripeCheckoutContainer");
  const embedded = $("#stripeEmbeddedCheckout");
  if (!container || !embedded) return;

  if (stripeEmbeddedCheckout) {
    container.classList.remove("hidden");
    setCheckoutSubmitLabel("Complete secure payment below");
    return;
  }

  const shouldShowStripe = paidCheckoutRequired() && checkoutProvider === "stripe" && stripeConfig.enabled;
  if (!shouldShowStripe) {
    container.classList.add("hidden");
    embedded.innerHTML = "";
    setCheckoutSubmitLabel("Submit resident order");
    return;
  }

  container.classList.remove("hidden");
  if (!embedded.querySelector("[data-stripe-placeholder]")) {
    embedded.innerHTML = `<div class="stripe-payment-placeholder" data-stripe-placeholder><strong>Stripe checkout ready</strong><span>Complete resident details and legal acceptance to open the secure payment form.</span></div>`;
  }
  setCheckoutSubmitLabel("Continue to secure payment");
}

async function initializePaymentProvider() {
  try {
    const response = await fetch("/api/stripe?action=config");
    const config = response.ok ? await response.json() : {provider:"square", enabled:false};
    checkoutProvider = config.provider === "stripe" ? "stripe" : "square";
    stripeConfig = config;
  } catch {
    checkoutProvider = "square";
    stripeConfig = {enabled:false, provider:"square", publishableKey:""};
  }

  hideApplePay();
  resetStripeCheckout();
  if (checkoutProvider !== "stripe") {
    syncStripeCheckoutDisplay();
    return;
  }

  if (!stripeConfig.enabled || !stripeConfig.publishableKey) {
    syncStripeCheckoutDisplay();
    return;
  }
  try {
    await loadStripeScript();
    stripeClient = window.Stripe(stripeConfig.publishableKey);
  } catch {
    stripeClient = null;
    stripeConfig = {...stripeConfig, enabled:false};
  }
  syncStripeCheckoutDisplay();
}

async function createStripeCheckoutSession({number, resident, acceptedAt}) {
  const response = await fetch("/api/stripe?action=session", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      orderNumber:number,resident,
      items:cart.map(item => ({id:item.id,quantity:item.quantity})),
      legalAccepted:true,legalNoticeVersion:LEGAL_NOTICE_VERSION,legalAcceptedAt:acceptedAt
    })
  });
  const result = await response.json();
  if (!response.ok || !result.success || !result.clientSecret) throw new Error(result.message || "Stripe checkout could not be started");
  return result;
}

async function confirmStripeOrder(sessionId) {
  const response = await fetch("/api/stripe?action=confirm", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({sessionId})
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.message || "Stripe order could not be confirmed");
  return result;
}

async function mountStripeCheckout(session, records, resident, number) {
  if (!stripeClient) throw new Error("Stripe checkout is not available");
  resetStripeCheckout();
  $("#stripeCheckoutContainer")?.classList.remove("hidden");
  $("#paymentMessage").textContent = "Complete your secure Stripe payment below.";
  $("#paymentMessage").classList.remove("hidden", "error");
  stripeEmbeddedCheckout = await stripeClient.initEmbeddedCheckout({
    clientSecret:session.clientSecret,
    onComplete:async () => {
      try {
        await confirmStripeOrder(session.sessionId);
        finalizeSuccessfulOrder(records, {status:"Paid", id:session.sessionId, createdAt:acceptanceDateTime()});
        $("#successName").textContent = resident.name.trim().split(" ")[0];
        $("#successOrder").textContent = number;
        $("#successPaymentNote").textContent = "Stripe confirmed the payment. Management can now process your request.";
        $("#checkoutForm").reset();
        resetStripeCheckout();
        closeModal("#checkoutModal");
        openModal("#successModal");
      } catch (error) {
        showPaymentError(error.message || "Stripe payment was received, but the order could not be confirmed. Please contact management.");
      }
    }
  });
  stripeEmbeddedCheckout.mount("#stripeEmbeddedCheckout");
}

function showPaymentError(message) {
  const element = $("#paymentMessage");
  element.textContent = message;
  element.classList.remove("hidden");
  element.classList.add("error");
}

if ($("#checkoutOpen")) $("#checkoutOpen").addEventListener("click", () => {
  hideApplePay();
  syncStripeCheckoutDisplay();
});

function createOrderRecords({number, resident, fee, acceptedAt, paymentStatus}) {
  return cart.map((cartItem, index) => {
    const product = products.find(candidate => candidate.id === cartItem.id);
    return {
      number,date:todayISO(),name:resident.name.trim(),unit:resident.unit.trim(),
      email:resident.email.trim(),phone:resident.phone.trim(),product:product.name,
      internalName:product.internalName,productId:product.id,quantity:cartItem.quantity,
      price:product.price,glCode:product.glCode,processingFee:index === 0 ? fee : 0,
      feeLabel:feeSettings.label,feeGlCode:feeSettings.glCode,legalAccepted:true,
      legalAcceptedAt:acceptedAt,legalNoticeVersion:LEGAL_NOTICE_VERSION,
      termsVersion:null,privacyPolicyVersion:null,status:"Received",publicNote:"",
      internalNote:"",paymentStatus,squareTransactionId:"",paymentDateTime:""
    };
  });
}

function normalizeUsPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

function normalizeUnitNumber(value) {
  const unit = String(value || "").toUpperCase();
  if (/^\d{4}$/.test(unit)) return unit;
  if (/^[A-Z0-9]{4}$/.test(unit)) {
    const letters = (unit.match(/[A-Z]/g) || []).length;
    const numbers = (unit.match(/\d/g) || []).length;
    if (letters === 2 && numbers === 2) return unit;
  }
  return "";
}

function checkoutValidationMessage(form, resident) {
  if (!cart.length) return "Your bag is empty. Add a resident service before checkout.";
  if (!resident.name.trim()) return "Please enter the resident's full name.";
  if (!resident.unit.trim()) return "Please enter the unit number.";
  if (!normalizeUnitNumber(resident.unit)) return UNIT_VALIDATION_MESSAGE;
  if (!form.elements.email.validity.valid) return "Please enter a valid email address.";
  if (!normalizeUsPhone(resident.phone)) return "Please enter a valid U.S. phone number, for example (305) 555-0000.";
  if (!$("#legalAcceptance").checked) return "Please accept the legal notice before submitting.";
  return "";
}

function finalizeSuccessfulOrder(records, payment) {
  records.forEach(record => {
    record.paymentStatus = payment.status;
    record.squareTransactionId = payment.id || "";
    record.paymentDateTime = payment.createdAt || acceptanceDateTime();
    const product = products.find(candidate => candidate.id === record.productId);
    product.inventory = Math.max(0, product.inventory - record.quantity);
  });
  cart = [];
  persist();
  renderCart();
  renderProducts();
  renderAdmin();
}

if ($("#checkoutForm")) $("#checkoutForm").onsubmit = async event => {
  event.preventDefault();
  if (paymentInProgress) return;
  const form = event.target;
  const resident = Object.fromEntries(new FormData(form));
  const validationMessage = checkoutValidationMessage(form, resident);
  if (validationMessage) {
    $("#paymentMessage").textContent = validationMessage;
    $("#paymentMessage").classList.remove("hidden");
    $("#paymentMessage").classList.add("error");
    toast(validationMessage);
    return;
  }
  resident.phone = normalizeUsPhone(resident.phone);
  resident.unit = normalizeUnitNumber(resident.unit);
  form.elements.phone.value = resident.phone;
  form.elements.unit.value = resident.unit;

  const submit = $("#checkoutSubmit");
  const message = $("#paymentMessage");
  submit.disabled = true;
  paymentInProgress = true;
  submit.textContent = checkoutProvider === "stripe" ? "Preparing secure payment..." : "Recording demo order...";
  message.classList.add("hidden");
  message.classList.remove("error");

  const number = generateOrderNumber();
  const subtotal = cartSubtotal();
  const fee = processingFee(subtotal);
  const requiresPayment = subtotal + fee > 0;
  if (requiresPayment && checkoutProvider !== "stripe") {
    message.textContent = "Online payment is currently unavailable. Please contact management.";
    message.classList.remove("hidden");
    message.classList.add("error");
    submit.disabled = false;
    paymentInProgress = false;
    syncStripeCheckoutDisplay();
    return;
  }
  if (requiresPayment && checkoutProvider === "stripe" && (!stripeConfig.enabled || !stripeClient)) {
    message.textContent = "Stripe test checkout is currently unavailable. Please contact management.";
    message.classList.remove("hidden");
    message.classList.add("error");
    submit.disabled = false;
    paymentInProgress = false;
    syncStripeCheckoutDisplay();
    return;
  }
  const acceptedAt = new Date().toISOString();
  const records = createOrderRecords({
    number,resident,fee,acceptedAt,
    paymentStatus:requiresPayment ? "Pending" : "No Payment Required"
  });

  try {
    let payment;
    if (!requiresPayment) {
      const response = await fetch("/api/create-order", {
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({
          orderNumber:number,resident,
          items:cart.map(item => ({id:item.id,quantity:item.quantity})),
          legalAccepted:true,legalNoticeVersion:LEGAL_NOTICE_VERSION,legalAcceptedAt:acceptedAt
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Order could not be saved");
      payment = {status:"No Payment Required",id:"",createdAt:acceptedAt};
    } else if (checkoutProvider === "stripe") {
      const session = await createStripeCheckoutSession({number,resident,acceptedAt});
      await mountStripeCheckout(session, records, resident, number);
      submit.textContent = "Complete secure payment below";
      paymentInProgress = false;
      return;
    }

    finalizeSuccessfulOrder(records, payment);
    $("#successName").textContent = resident.name.trim().split(" ")[0];
    $("#successOrder").textContent = number;
    $("#successPaymentNote").textContent = !requiresPayment
      ? "No payment was required. Management can now process your request."
      : "Payment was confirmed. Management can now process your request.";
    form.reset();
    closeModal("#checkoutModal");
    openModal("#successModal");
  } catch (error) {
    console.error(requiresPayment ? "Card payment failed" : "Order submission failed", error);
    message.textContent = requiresPayment
      ? FRIENDLY_PAYMENT_ERROR
      : "Sorry, your order could not be submitted. Please try again.";
    message.classList.remove("hidden");
    message.classList.add("error");
    submit.disabled = false;
  } finally {
    paymentInProgress = false;
    syncStripeCheckoutDisplay();
  }
};

initializePaymentProvider();
