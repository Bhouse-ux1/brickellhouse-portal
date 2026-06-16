const ORDER_STATUSES = ["Received", "Processing", "Ready for Pickup", "Completed", "Cancelled"];
const FEEDBACK_STATUSES = ["New", "In Review", "Answered", "Closed"];
const FEEDBACK_STORAGE_KEY = "bh_feedback";

let feedbackRecords = [];
let squareConfig = {enabled:false, environment:"demo"};
let squareCard = null;

const LUNA_FALLBACK = "Please contact the Management Office at admin@brickellhouse.net or 305-400-9661.";
const LUNA_VENDOR_DISCLAIMER = "Vendors are listed for resident convenience only. Vendor selection is always the resident's decision.";
const LUNA_RESPONSES = [
  {keywords:["gym","fitness"], answer:"Fitness Center / Gym: Location PL. Hours: 7:00 AM - 11:00 PM."},
  {keywords:["pool","spa"], answer:"Pool / Spa: Location PL & RL. Hours: 8:00 AM - Sundown."},
  {keywords:["rooftop","terrace"], answer:"Rooftop Terrace: Location RL. Hours: 8:00 AM - Sundown."},
  {keywords:["clubroom","club room","lounge"], answer:"Clubroom / Lounge: Location PL. Hours: 8:00 AM - 11:00 PM."},
  {keywords:["business center"], answer:"Business Center: Location 4th Floor. Hours: 7:00 AM - 3:00 PM."},
  {keywords:["party","event room"], answer:"Party / Event Room: Location PL. Hours: 8:00 AM - 11:00 PM."},
  {keywords:["electrician","electric"], answer:`Electricians: Orion Electric: 305-521-9091. Switchgear: 305-596-1500. ${LUNA_VENDOR_DISCLAIMER}`},
  {keywords:["hvac","ac repair","a/c","air conditioning"], answer:`HVAC / AC Repairs: Raircon: 786-367-6386. Cam Seer Service: 305-934-6929. ${LUNA_VENDOR_DISCLAIMER}`},
  {keywords:["locksmith","lock"], answer:`Locksmiths: Caraballo Locksmith: 305-858-6860. AAA Miami Locksmith: 305-576-9320. Brickell Locksmith: 786-565-3400. Locksmith in Miami: 305-224-1980. ${LUNA_VENDOR_DISCLAIMER}`},
  {keywords:["plumber","plumbing"], answer:`Plumbers: Raircon: 786-367-6386 / 305-885-4422. Island Plumbing: 305-361-2929. US Contracting: 305-667-4036. Bay Plumbing: 305-446-8141. ${LUNA_VENDOR_DISCLAIMER}`},
  {keywords:["appliance","refrigeration"], answer:`Appliance Repairs: AJ Appliance & Refrigeration: 305-244-0114. ${LUNA_VENDOR_DISCLAIMER}`},
  {keywords:["shower","sliding door","sliding doors"], answer:`Shower Doors / Sliding Doors: Rapetti Shower: 786-663-0080. All Comp: 305-338-7623. World of Eagles: 786-286-3170. ${LUNA_VENDOR_DISCLAIMER}`},
  {keywords:["curtain","curtains","blind","blinds"], answer:`Curtains / Blinds: Curtains & Blinds, INC: 786-506-3348. ${LUNA_VENDOR_DISCLAIMER}`},
  {keywords:["handyman","handy"], answer:`Handyman: American Handy Paint & Clean Co.: 833-426-3987. ${LUNA_VENDOR_DISCLAIMER}`},
  {keywords:["mover","moving","storage","trash pick","trash pickup"], answer:`Movers / Storage / Trash Pick-up: Rushmore Movers: 305-244-1840. Ciao Moving & Storage: 305-531-4222. ${LUNA_VENDOR_DISCLAIMER}`}
];

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[character]));

function lunaAnswer(question) {
  const value = String(question || "").toLowerCase();
  const match = LUNA_RESPONSES.find(entry => entry.keywords.some(keyword => value.includes(keyword)));
  return match ? match.answer : LUNA_FALLBACK;
}

function addLunaMessage(role, text) {
  const log = $("#lunaMessages");
  if (!log) return;
  log.insertAdjacentHTML("beforeend", `<div class="luna-message ${role}">${escapeHtml(text)}</div>`);
  log.scrollTop = log.scrollHeight;
}

function initializeLuna() {
  if (document.body.classList.contains("management-page") || !$("#shop") || $("#lunaWidget")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <aside class="luna-widget" id="lunaWidget" aria-label="Ask Luna resident assistant">
      <button class="luna-toggle" id="lunaToggle" type="button">Ask Luna</button>
      <section class="luna-panel hidden" id="lunaPanel">
        <div class="luna-head"><strong>Luna</strong><button type="button" id="lunaClose" aria-label="Close Luna">×</button></div>
        <div class="luna-messages" id="lunaMessages">
          <div class="luna-message bot">Hi, I am Luna. Ask me about amenity hours or resident vendor categories.</div>
        </div>
        <form id="lunaForm">
          <input name="question" autocomplete="off" placeholder="Ask about gym hours, plumbers, movers...">
          <button type="submit">Send</button>
        </form>
      </section>
    </aside>
  `);
  $("#lunaToggle").onclick = () => $("#lunaPanel").classList.toggle("hidden");
  $("#lunaClose").onclick = () => $("#lunaPanel").classList.add("hidden");
  $("#lunaForm").onsubmit = event => {
    event.preventDefault();
    const input = event.target.elements.question;
    const question = input.value.trim();
    if (!question) return;
    addLunaMessage("user", question);
    addLunaMessage("bot", lunaAnswer(question));
    input.value = "";
  };
}

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
    button.onclick = async () => {
      const record = feedbackRecords.find(item => item.id === button.dataset.saveFeedback);
      const before = {...record};
      const status = $(`[data-feedback-status="${record.id}"]`).value;
      const changes = {
        status,
        managementResponse:$(`[data-feedback-response="${record.id}"]`).value.trim(),
        internalNotes:$(`[data-feedback-notes="${record.id}"]`).value.trim(),
        dateResponded:status === "Answered" && $(`[data-feedback-response="${record.id}"]`).value.trim() ? new Date().toISOString() : record.dateResponded
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

if ($("#feedbackForm")) $("#feedbackForm").onsubmit = async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const confirmation = $("#feedbackConfirmation");
  confirmation.classList.remove("hidden");
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
    confirmation.innerHTML = `<strong>Thank you for your feedback.</strong><br><br>Your submission has been received.<br><br>We will review your message and respond within 48 hours.<br><br>Thank you for helping us improve the BrickellHouse resident experience.`;
  } catch (error) {
    confirmation.innerHTML = `<strong>Feedback was not submitted.</strong><br><br>${escapeHtml(error.message || "Please try again.")}`;
  }
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
    } else if (squareConfig.enabled) {
      const tokenResult = await squareCard.tokenize();
      if (tokenResult.status !== "OK") throw new Error(tokenResult.errors?.[0]?.message || "Card tokenization failed");
      const response = await fetch("/api/create-payment", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          sourceId:tokenResult.token,idempotencyKey:number,orderNumber:number,resident,
          items:cart.map(item => ({id:item.id,quantity:item.quantity})),
          legalAccepted:true,legalNoticeVersion:LEGAL_NOTICE_VERSION,legalAcceptedAt:acceptedAt
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Square payment failed");
      payment = {status:"Paid",id:result.payment.id,createdAt:formatResidentDateTime(result.payment.createdAt)};
    }

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
initializeLuna();
