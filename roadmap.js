const ORDER_STATUSES = ["Received", "Processing", "Ready for Pickup", "Completed", "Cancelled"];
const FEEDBACK_STATUSES = ["New", "In Review", "Answered", "Closed"];
const FEEDBACK_STORAGE_KEY = "bh_feedback";

let feedbackRecords = [];
let squareConfig = {enabled:false, environment:"demo"};
let squareCard = null;

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

function updateOrder(number, changes) {
  const before = orderLines(number).map(order => ({...order}));
  orderLines(number).forEach(order => Object.assign(order, changes));
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
    select.onchange = () => {
      updateOrder(select.dataset.orderStatus, {status:select.value});
      renderOrderTableRoadmap();
      toast(`Order status updated to ${select.value}`);
    };
  });
  $$("[data-save-order]").forEach(button => {
    button.onclick = () => {
      const number = button.dataset.saveOrder;
      const publicNote = $(`[data-public-note="${CSS.escape(number)}"]`).value.trim();
      const internalNote = $(`[data-internal-note="${CSS.escape(number)}"]`).value.trim();
      updateOrder(number, {publicNote, internalNote});
      toast("Order notes saved");
    };
  });
}

renderOrderTable = renderOrderTableRoadmap;

function feedbackStatusClass(status) {
  return `status-${status.toLowerCase().replaceAll(" ", "-")}`;
}

function matchingFeedback() {
  const query = ($("#feedbackSearch")?.value || "").trim().toLowerCase();
  const status = $("#feedbackStatusFilter")?.value || "All";
  const category = $("#feedbackCategoryFilter")?.value || "All";
  const date = $("#feedbackDateFilter")?.value || "";
  return feedbackRecords.filter(record => {
    const matchesQuery = !query || [record.name,record.unit,record.email,record.message].some(value => String(value || "").toLowerCase().includes(query));
    return matchesQuery &&
      (status === "All" || record.status === status) &&
      (category === "All" || record.category === category) &&
      (!date || record.dateSubmitted.slice(0, 10) === date);
  });
}

function renderFeedbackAdmin() {
  const container = $("#feedbackAdminList");
  if (!container) return;
  const matches = matchingFeedback().sort((a, b) => b.dateSubmitted.localeCompare(a.dateSubmitted));
  container.innerHTML = matches.map(record => `
    <article class="feedback-record ${feedbackStatusClass(record.status)}">
      <div class="feedback-record-head">
        <div><h3>${escapeHtml(record.category)}</h3><p>${escapeHtml(record.name)} · Unit ${escapeHtml(record.unit)}${record.email ? ` · ${escapeHtml(record.email)}` : ""}</p></div>
        <div><span class="status-pill ${record.status === "New" ? "new" : ""}">${escapeHtml(record.status)}</span><p>${formatResidentDateTime(record.dateSubmitted)}</p></div>
      </div>
      <p>${escapeHtml(record.message)}</p>
      <div class="feedback-record-grid">
        <label><span>Status</span><select data-feedback-status="${record.id}">${FEEDBACK_STATUSES.map(status => `<option ${status === record.status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
        <label><span>Management response</span><textarea data-feedback-response="${record.id}">${escapeHtml(record.managementResponse)}</textarea></label>
        <label><span>Internal notes</span><textarea data-feedback-notes="${record.id}">${escapeHtml(record.internalNotes)}</textarea></label>
      </div>
      <div class="feedback-record-actions"><button class="table-action" data-delete-feedback="${record.id}">Delete</button><button class="primary-button" data-save-feedback="${record.id}">Save feedback record</button></div>
    </article>
  `).join("") || `<div class="admin-panel">No feedback matches the current filters.</div>`;

  $$("[data-save-feedback]").forEach(button => {
    button.onclick = () => {
      const record = feedbackRecords.find(item => item.id === button.dataset.saveFeedback);
      const before = {...record};
      const status = $(`[data-feedback-status="${record.id}"]`).value;
      record.status = status;
      record.managementResponse = $(`[data-feedback-response="${record.id}"]`).value.trim();
      record.internalNotes = $(`[data-feedback-notes="${record.id}"]`).value.trim();
      record.dateResponded = status === "Answered" && record.managementResponse ? new Date().toISOString() : record.dateResponded;
      persistFeedback();
      renderFeedbackAdmin();
      renderRoadmapMetrics();
      toast("Feedback record saved");
      auditRoadmapManagement("feedback_response_update", "feedback", record.id, before, record);
    };
  });
  $$("[data-delete-feedback]").forEach(button => {
    button.onclick = () => {
      if (!confirm("Delete this feedback record?")) return;
      const deleted = feedbackRecords.find(record => record.id === button.dataset.deleteFeedback);
      feedbackRecords = feedbackRecords.filter(record => record.id !== button.dataset.deleteFeedback);
      persistFeedback();
      renderFeedbackAdmin();
      renderRoadmapMetrics();
      toast("Feedback record deleted");
      auditRoadmapManagement("feedback_delete", "feedback", button.dataset.deleteFeedback, deleted, null);
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
  const newFeedback = feedbackRecords.filter(record => record.status === "New").length;
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

if ($("#trackingForm")) $("#trackingForm").onsubmit = event => {
  event.preventDefault();
  const number = new FormData(event.target).get("orderNumber").trim().toUpperCase();
  const lines = orderLines(number);
  const result = $("#trackingResult");
  result.classList.remove("hidden", "error");
  if (!lines.length) {
    result.classList.add("error");
    result.innerHTML = `<strong>Order not found.</strong><br>Check the order ID and try again, or contact management for assistance.`;
    return;
  }
  const order = lines[0];
  result.innerHTML = `<div class="tracking-status"><span>Current Status</span><strong>${escapeHtml(order.status)}</strong></div>${order.publicNote ? `<p>${escapeHtml(order.publicNote)}</p>` : ""}`;
};

if ($("#feedbackForm")) $("#feedbackForm").onsubmit = event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  feedbackRecords.push({
    id:`FB-${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase()}`,
    name:data.name.trim(),unit:data.unit.trim(),email:data.email.trim(),category:data.category,
    message:data.message.trim(),dateSubmitted:new Date().toISOString(),status:"New",
    managementResponse:"",dateResponded:"",internalNotes:""
  });
  persistFeedback();
  event.target.reset();
  const confirmation = $("#feedbackConfirmation");
  confirmation.classList.remove("hidden");
  confirmation.innerHTML = `<strong>Thank you for your feedback.</strong><br><br>Your submission has been received by management.<br><br>We will review your message and respond within 48 hours.<br><br>Thank you for helping us improve the BrickellHouse resident experience.`;
  renderFeedbackAdmin();
  renderRoadmapMetrics();
};

["feedbackSearch","feedbackStatusFilter","feedbackCategoryFilter","feedbackDateFilter"].forEach(id => {
  if ($(`#${id}`)) $(`#${id}`).addEventListener(id === "feedbackSearch" ? "input" : "change", renderFeedbackAdmin);
});

if ($("#exportFeedback")) $("#exportFeedback").onclick = () => {
  downloadCsv(`BrickellHouse-Feedback-${fileDate()}.csv`, [
    ["Feedback ID","Resident Name","Unit","Email","Category","Message","Date Submitted","Status","Management Response","Date Responded","Internal Notes"],
    ...feedbackRecords.map(record => [
      record.id,record.name,record.unit,record.email,record.category,record.message,
      formatResidentDateTime(record.dateSubmitted),record.status,record.managementResponse,
      formatResidentDateTime(record.dateResponded),record.internalNotes
    ])
  ]);
  toast("Feedback report exported");
  auditRoadmapManagement("export_feedback", "export", "feedback", null, {rows:feedbackRecords.length});
};

if ($("#exportOrders")) $("#exportOrders").onclick = () => {
  downloadCsv(`BrickellHouse-Orders-${fileDate()}.csv`, [
    ["Order Number","Resident Name","Unit Number","Product","Internal / Square Name","Quantity","Unit Price","Subtotal","Processing Fee","Fee GL Code","Total","Hidden Product GL Code","Date","Order Status","Public Note","Internal Note","Payment Status","Square Transaction ID","Payment Date/Time","Legal Notice Accepted","Acceptance Date/Time","Legal Notice Version","Terms Version","Privacy Policy Version"],
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

function loadSquareScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function initializeSquare() {
  const mode = $("#paymentMode");
  const description = $("#paymentDescription");
  if (!mode || !description) return;
  try {
    const response = await fetch("/api/square-config");
    if (!response.ok) throw new Error("Square API route is unavailable");
    squareConfig = await response.json();
    if (!squareConfig.enabled) throw new Error("Square Sandbox is not configured");
    feeSettings = {
      ...feeSettings,
      enabled:true,
      type:"percent",
      amount:squareConfig.processingFeePercent
    };
    persist();
    renderCart();
    await loadSquareScript(squareConfig.sdkUrl);
    const payments = window.Square.payments(squareConfig.applicationId, squareConfig.locationId);
    squareCard = await payments.card();
    await squareCard.attach("#squareCard");
    $("#squareCardContainer").classList.remove("hidden");
    mode.textContent = "SANDBOX";
    description.textContent = "Use a Square Sandbox test card. No live charge will occur.";
  } catch (error) {
    squareConfig = {enabled:false, environment:"demo"};
    mode.textContent = "SANDBOX OFFLINE";
    description.textContent = "Square Sandbox is not available. Paid orders cannot be submitted until the secure backend is configured.";
  }
}

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

function checkoutValidationMessage(form, resident) {
  if (!cart.length) return "Your bag is empty. Add a resident service before checkout.";
  if (!resident.name.trim()) return "Please enter the resident's full name.";
  if (!resident.unit.trim()) return "Please enter the unit number.";
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
  form.elements.phone.value = resident.phone;

  const submit = $("#checkoutSubmit");
  const message = $("#paymentMessage");
  submit.disabled = true;
  submit.textContent = squareConfig.enabled ? "Processing secure payment..." : "Recording demo order...";
  message.classList.add("hidden");
  message.classList.remove("error");

  const number = generateOrderNumber();
  const subtotal = cartSubtotal();
  const fee = processingFee(subtotal);
  const requiresPayment = subtotal + fee > 0;
  if (requiresPayment && !squareConfig.enabled) {
    message.textContent = "Square Sandbox is unavailable. No order was created and no payment was attempted.";
    message.classList.remove("hidden");
    message.classList.add("error");
    submit.disabled = false;
    submit.innerHTML = `Submit resident order <span>→</span>`;
    return;
  }
  const records = createOrderRecords({
    number,resident,fee,acceptedAt:acceptanceDateTime(),
    paymentStatus:requiresPayment ? "Pending" : "No Payment Required"
  });

  try {
    let payment;
    if (!requiresPayment) {
      payment = {status:"No Payment Required",id:"",createdAt:acceptanceDateTime()};
    } else if (squareConfig.enabled) {
      const tokenResult = await squareCard.tokenize();
      if (tokenResult.status !== "OK") throw new Error(tokenResult.errors?.[0]?.message || "Card tokenization failed");
      const response = await fetch("/api/create-payment", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          sourceId:tokenResult.token,idempotencyKey:number,orderNumber:number,resident,
          items:cart.map(item => ({id:item.id,quantity:item.quantity})),
          legalAccepted:true,legalNoticeVersion:LEGAL_NOTICE_VERSION
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Square payment failed");
      payment = {status:"Paid",id:result.payment.id,createdAt:formatResidentDateTime(result.payment.createdAt)};
    }

    orders.push(...records);
    finalizeSuccessfulOrder(records, payment);
    $("#successName").textContent = resident.name.trim().split(" ")[0];
    $("#successOrder").textContent = number;
    $("#successPaymentNote").textContent = !requiresPayment
      ? "No payment was required. Management can now process your request."
      : "Square confirmed the Sandbox payment. Management can now process your request.";
    form.reset();
    closeModal("#checkoutModal");
    openModal("#successModal");
  } catch (error) {
    message.textContent = `Payment was not completed: ${error.message}`;
    message.classList.remove("hidden");
    message.classList.add("error");
    submit.disabled = false;
  } finally {
    submit.innerHTML = `Submit resident order <span>→</span>`;
  }
};

initializeSquare();
