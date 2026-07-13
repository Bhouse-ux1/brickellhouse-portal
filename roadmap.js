let checkoutProvider = "square";
let stripeConfig = {enabled:false, provider:"square", publishableKey:""};
let stripeClient = null;
let stripeEmbeddedCheckout = null;
let stripeCheckoutScrolledFor = null;
let paymentInProgress = false;
const isCheckoutPage = document.body.classList.contains("checkout-page");
let checkoutPageCatalogReady = !isCheckoutPage || Boolean(window.BH_CATALOG_STATE?.success);
let legalAcceptedAt = "";
let acceptedLegalNoticeVersion = "";
let legalScrollGateReached = false;
let legalReviewReturnFocus = null;
const LEGAL_SCROLL_TOLERANCE = 12;
const UNIT_VALIDATION_MESSAGE = "Please check unit number and try again.";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[character]));

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

function setCheckoutPaymentFocus(focused) {
  if (!isCheckoutPage) return;
  $$('[data-checkout-prepayment]').forEach(element => element.classList.toggle("hidden", focused));
}

function focusMountedStripeCheckout() {
  if (!isCheckoutPage || !stripeEmbeddedCheckout || stripeCheckoutScrolledFor === stripeEmbeddedCheckout) return;
  const mountedCheckout = stripeEmbeddedCheckout;
  const container = $("#stripeCheckoutContainer");
  if (!container) return;

  setCheckoutPaymentFocus(true);
  clearPaymentMessage();
  stripeCheckoutScrolledFor = mountedCheckout;

  requestAnimationFrame(() => {
    if (stripeEmbeddedCheckout !== mountedCheckout) return;
    const headerHeight = $(".checkout-header")?.getBoundingClientRect().height || 0;
    const top = Math.max(0, window.scrollY + container.getBoundingClientRect().top - headerHeight - 20);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      window.scrollTo(0, top);
      return;
    }
    try {
      window.scrollTo({top, behavior:"smooth"});
    } catch {
      window.scrollTo(0, top);
    }
  });
}

function resetStripeCheckout() {
  if (stripeEmbeddedCheckout?.destroy) stripeEmbeddedCheckout.destroy();
  stripeEmbeddedCheckout = null;
  stripeCheckoutScrolledFor = null;
  setCheckoutPaymentFocus(false);
  $("#stripeEmbeddedCheckout") && ($("#stripeEmbeddedCheckout").innerHTML = "");
  $("#stripeCheckoutContainer")?.classList.add("hidden");
}

function clearPaymentMessage() {
  const element = $("#paymentMessage");
  if (!element) return;
  element.textContent = "";
  element.classList.add("hidden");
  element.classList.remove("error");
}

function paidCheckoutRequired() {
  const subtotal = cartSubtotal();
  return cart.length > 0 && subtotal + processingFee(subtotal) > 0;
}

function setCheckoutSubmitLabel(label) {
  const submit = $("#checkoutSubmit");
  if (submit) submit.innerHTML = `${label} <span>&rarr;</span>`;
}

function legalTermsAccepted() {
  return Boolean(
    $("#legalAcceptance")?.checked
    && legalAcceptedAt
    && acceptedLegalNoticeVersion === LEGAL_NOTICE_VERSION
  );
}

function syncLegalReviewState() {
  if (!isCheckoutPage) return;
  const accepted = legalTermsAccepted();
  $("#checkoutLegalReview")?.classList.toggle("accepted", accepted);
  if ($("#legalStatusMark")) $("#legalStatusMark").textContent = accepted ? "\u2713" : "!";
  if ($("#legalStatusTitle")) $("#legalStatusTitle").textContent = accepted ? "Legal Terms Accepted" : "Legal review required";
  if ($("#legalStatusMessage")) {
    $("#legalStatusMessage").textContent = accepted
      ? "The complete terms have been reviewed and accepted for this checkout."
      : "Please review the complete terms and accept them before continuing to secure payment.";
  }
  if ($("#legalNoticeOpen")) $("#legalNoticeOpen").textContent = accepted ? "View Legal Terms" : "Review Legal Terms";
}

function resetLegalAcceptance() {
  legalAcceptedAt = "";
  acceptedLegalNoticeVersion = "";
  legalScrollGateReached = false;
  if ($("#legalAcceptance")) $("#legalAcceptance").checked = false;
  syncLegalReviewState();
}

function legalScrollIsAtBottom() {
  const container = $("#legalScrollContainer");
  if (!container) return false;
  return container.scrollHeight - container.scrollTop - container.clientHeight <= LEGAL_SCROLL_TOLERANCE;
}

function updateLegalScrollGate() {
  if (legalTermsAccepted()) return;
  if (legalScrollIsAtBottom()) legalScrollGateReached = true;
  const accept = $("#legalReviewAccept");
  if (accept) accept.disabled = !legalScrollGateReached;
}

function closeLegalReview() {
  const modal = $("#legalModal");
  modal?.classList.remove("open");
  document.body.classList.remove("legal-review-open");
  legalScrollGateReached = false;
  const container = $("#legalScrollContainer");
  if (container) container.scrollTop = 0;
  const accept = $("#legalReviewAccept");
  if (accept) {
    accept.disabled = true;
    accept.textContent = legalTermsAccepted() ? "Legal Terms Accepted" : "Accept Legal Terms";
  }
  const returnFocus = legalReviewReturnFocus;
  legalReviewReturnFocus = null;
  returnFocus?.focus?.();
}

function openLegalReview() {
  const modal = $("#legalModal");
  const container = $("#legalScrollContainer");
  const accept = $("#legalReviewAccept");
  if (!modal || !container || !accept) return;

  if (acceptedLegalNoticeVersion && acceptedLegalNoticeVersion !== LEGAL_NOTICE_VERSION) resetLegalAcceptance();
  const accepted = legalTermsAccepted();
  legalReviewReturnFocus = document.activeElement;
  legalScrollGateReached = false;
  container.scrollTop = 0;
  accept.disabled = true;
  accept.textContent = accepted ? "Legal Terms Accepted" : "Accept Legal Terms";
  if ($("#legalReviewInstruction")) {
    $("#legalReviewInstruction").textContent = accepted
      ? "These complete terms have been accepted for this checkout."
      : "Please review the complete terms. Acceptance will become available once you reach the end.";
  }
  modal.classList.add("open");
  document.body.classList.add("legal-review-open");
  requestAnimationFrame(() => {
    container.scrollTop = 0;
    container.focus();
  });
}

function acceptLegalTerms() {
  if (legalTermsAccepted() || !legalScrollGateReached) return;
  legalAcceptedAt = new Date().toISOString();
  acceptedLegalNoticeVersion = LEGAL_NOTICE_VERSION;
  if ($("#legalAcceptance")) $("#legalAcceptance").checked = true;
  syncLegalReviewState();
  closeLegalReview();
  syncCheckoutSubmitState();
  syncStripeCheckoutDisplay();
}

function trapLegalReviewFocus(event) {
  const modal = $("#legalModal");
  if (!modal?.classList.contains("open") || event.key !== "Tab") return;
  const focusable = Array.from(modal.querySelectorAll('button:not(:disabled), [tabindex="0"]'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function syncCheckoutPageState() {
  if (!isCheckoutPage) return;
  const loading = $("#checkoutLoading");
  const content = $("#checkoutPageContent");
  const empty = $("#checkoutEmptyState");
  const hasItems = cart.length > 0;

  if (!checkoutPageCatalogReady) {
    content?.classList.add("hidden");
    empty?.classList.add("hidden");
    return;
  }

  loading?.classList.add("hidden");
  content?.classList.toggle("hidden", !hasItems);
  empty?.classList.toggle("hidden", hasItems);
}

function syncCheckoutSubmitState() {
  const submit = $("#checkoutSubmit");
  if (!submit) return;
  const detailsComplete = checkoutDetailsComplete();
  const accepted = legalTermsAccepted();
  submit.disabled = paymentInProgress || Boolean(stripeEmbeddedCheckout) || !detailsComplete || !accepted || !cart.length || !checkoutPageCatalogReady;
}

function checkoutDetailsComplete() {
  const form = $("#checkoutForm");
  const fields = form ? Object.fromEntries(new FormData(form)) : {};
  return Boolean(
    form
    && String(fields.name || "").trim()
    && normalizeUnitNumber(fields.unit)
    && form.elements.email.validity.valid
    && normalizeUsPhone(fields.phone)
  );
}

window.syncCheckoutSubmitState = syncCheckoutSubmitState;

function syncStripeCheckoutDisplay() {
  const container = $("#stripeCheckoutContainer");
  const embedded = $("#stripeEmbeddedCheckout");
  if (!container || !embedded) return;

  if (stripeEmbeddedCheckout) {
    container.classList.remove("hidden");
    setCheckoutSubmitLabel("Complete secure payment below");
    syncCheckoutSubmitState();
    return;
  }

  const shouldShowStripe = paidCheckoutRequired() && checkoutProvider === "stripe" && stripeConfig.enabled;
  if (!shouldShowStripe) {
    container.classList.add("hidden");
    embedded.innerHTML = "";
    setCheckoutSubmitLabel("Submit resident order");
    syncCheckoutSubmitState();
    return;
  }

  container.classList.remove("hidden");
  const readyToContinue = checkoutDetailsComplete() && legalTermsAccepted();
  embedded.innerHTML = `<div class="stripe-payment-notice" data-stripe-placeholder>${readyToContinue
    ? "Your details are complete. Select Continue to open secure payment."
    : "Please complete all required details and accept the legal notice to continue to secure payment."}</div>`;
  setCheckoutSubmitLabel("Continue to secure payment");
  syncCheckoutSubmitState();
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

function clearResidentCart() {
  cart = [];
  persist();
  renderCart();
  renderProducts();
  syncStripeCheckoutDisplay();
}

function showSuccessMessage({title, body, orderNumber = ""}) {
  $("#successEyebrow") && ($("#successEyebrow").textContent = "Payment received");
  $("#successTitle") && ($("#successTitle").textContent = title);
  if ($("#successBody")) {
    $("#successBody").innerHTML = orderNumber
      ? `${body} <span class="success-order-reference">Order <strong>${escapeHtml(orderNumber)}</strong>.</span>`
      : body;
  }
  $("#successName") && ($("#successName").textContent = "");
  $("#successOrder") && ($("#successOrder").textContent = orderNumber);
  $("#successPaymentNote") && ($("#successPaymentNote").textContent = "");
  if (isCheckoutPage) {
    $("#checkoutMain")?.classList.add("hidden");
    $("#successModal")?.classList.remove("hidden");
    window.scrollTo({top:0, behavior:"auto"});
  } else {
    openModal("#successModal");
  }
}

function showPaidOrderConfirmation(orderNumber = "") {
  showSuccessMessage({
    title:"Thank you. Your payment has been received.",
    body:"Your request has been submitted successfully. Management will contact you once your order is ready.",
    orderNumber
  });
}

function showResidentOrderConfirmation({name = "", orderNumber = "", note = ""}) {
  $("#successEyebrow") && ($("#successEyebrow").textContent = "Request received");
  $("#successTitle") && ($("#successTitle").textContent = `Thank you${name ? `, ${name}` : ""}.`);
  if ($("#successBody")) {
    $("#successBody").innerHTML = `Your order <strong>${escapeHtml(orderNumber)}</strong> has been received. <span id="successPaymentNote">${escapeHtml(note)}</span>`;
  }
  $("#successName") && ($("#successName").textContent = name ? `, ${name}` : "");
  $("#successOrder") && ($("#successOrder").textContent = orderNumber);
  if (isCheckoutPage) {
    $("#checkoutMain")?.classList.add("hidden");
    $("#successModal")?.classList.remove("hidden");
    window.scrollTo({top:0, behavior:"auto"});
  } else {
    openModal("#successModal");
  }
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
        const result = await confirmStripeOrder(session.sessionId);
        finalizeSuccessfulOrder(records, {status:"Paid", id:session.sessionId, createdAt:acceptanceDateTime()});
        $("#checkoutForm").reset();
        resetStripeCheckout();
        closeModal("#checkoutModal");
        showPaidOrderConfirmation(result.order?.orderNumber || number);
      } catch (error) {
        showPaymentError(error.message || "Stripe payment was received, but the order could not be confirmed. Please contact management.");
      }
    }
  });
  try {
    stripeEmbeddedCheckout.mount("#stripeEmbeddedCheckout");
    focusMountedStripeCheckout();
  } catch (error) {
    resetStripeCheckout();
    throw error;
  }
}

function showPaymentError(message) {
  const element = $("#paymentMessage");
  if (!element) return;
  element.textContent = message;
  element.classList.remove("hidden");
  element.classList.add("error");
}

async function handleStripeReturnConfirmation() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("stripe_session_id");
  if (!sessionId) return;

  const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
  window.history.replaceState({}, document.title, cleanUrl);
  try {
    const result = await confirmStripeOrder(sessionId);
    clearResidentCart();
    resetStripeCheckout();
    $("#checkoutForm")?.reset();
    closeModal("#checkoutModal");
    showPaidOrderConfirmation(result.order?.orderNumber || "");
  } catch (error) {
    console.error("Stripe return confirmation failed", error);
    showSuccessMessage({
      title:"Payment received.",
      body:"Your payment was received, but the website could not refresh the confirmation details. Please contact Management if your order does not appear shortly."
    });
  }
}

if ($("#checkoutOpen")) $("#checkoutOpen").addEventListener("click", () => {
  hideApplePay();
  clearPaymentMessage();
  syncStripeCheckoutDisplay();
});

function createOrderRecords() {
  return cart.map(cartItem => ({productId:cartItem.id, quantity:cartItem.quantity}));
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
  if (!checkoutPageCatalogReady) return "Product availability could not be confirmed. Please return to the store and try again.";
  if (!cart.length) return "Your bag is empty. Add a resident service before checkout.";
  if (!resident.name.trim()) return "Please enter the resident's full name.";
  if (!resident.unit.trim()) return "Please enter the unit number.";
  if (!normalizeUnitNumber(resident.unit)) return UNIT_VALIDATION_MESSAGE;
  if (!form.elements.email.validity.valid) return "Please enter a valid email address.";
  if (!normalizeUsPhone(resident.phone)) return "Please enter a valid U.S. phone number, for example (305) 555-0000.";
  if (!legalTermsAccepted()) return "Please review and accept the legal notice before submitting.";
  return "";
}

function finalizeSuccessfulOrder(records) {
  records.forEach(record => {
    const product = products.find(candidate => candidate.id === record.productId);
    if (product) product.inventory = Math.max(0, product.inventory - record.quantity);
  });
  cart = [];
  persist();
  renderCart();
  renderProducts();
}

if ($("#checkoutForm")) {
  const syncCheckoutFormState = () => {
    syncCheckoutSubmitState();
    syncStripeCheckoutDisplay();
  };
  $("#checkoutForm").addEventListener("input", syncCheckoutFormState);
  $("#checkoutForm").addEventListener("change", syncCheckoutFormState);
  $("#checkoutForm").addEventListener("reset", resetLegalAcceptance);
  $("#checkoutForm").onsubmit = async event => {
  event.preventDefault();
  if (paymentInProgress || stripeEmbeddedCheckout) return;
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
  clearPaymentMessage();

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
    message.textContent = "Secure online checkout is currently unavailable. Please contact management.";
    message.classList.remove("hidden");
    message.classList.add("error");
    submit.disabled = false;
    paymentInProgress = false;
    syncStripeCheckoutDisplay();
    return;
  }
  const acceptedAt = legalAcceptedAt;
  const records = createOrderRecords();

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
    form.reset();
    closeModal("#checkoutModal");
    showResidentOrderConfirmation({
      name:resident.name.trim().split(" ")[0],
      orderNumber:number,
      note:!requiresPayment
        ? "No payment was required. Management can now process your request."
        : "Payment was confirmed. Management can now process your request."
    });
  } catch (error) {
    console.error(requiresPayment ? "Secure payment setup failed" : "Order submission failed", error);
    resetStripeCheckout();
    message.textContent = requiresPayment
      ? (error.message || "Secure payment could not be started. Please try again or contact Management.")
      : "Sorry, your order could not be submitted. Please try again.";
    message.classList.remove("hidden");
    message.classList.add("error");
    submit.disabled = false;
  } finally {
    paymentInProgress = false;
    syncStripeCheckoutDisplay();
    syncCheckoutSubmitState();
  }
  };
}

if ($("#legalNoticeOpen")) $("#legalNoticeOpen").onclick = openLegalReview;
if ($("#legalReviewClose")) $("#legalReviewClose").addEventListener("click", closeLegalReview);
if ($("#legalReviewCancel")) $("#legalReviewCancel").addEventListener("click", closeLegalReview);
if ($("#legalReviewAccept")) $("#legalReviewAccept").addEventListener("click", acceptLegalTerms);
if ($("#legalScrollContainer")) $("#legalScrollContainer").addEventListener("scroll", updateLegalScrollGate, {passive:true});
if ($("#legalModal")) $("#legalModal").addEventListener("click", event => {
  if (event.target === event.currentTarget) closeLegalReview();
});
document.addEventListener("keydown", event => {
  if (!$("#legalModal")?.classList.contains("open")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeLegalReview();
    return;
  }
  trapLegalReviewFocus(event);
});

syncLegalReviewState();

function applyCheckoutCatalogState(success) {
  if (!isCheckoutPage) return;
  checkoutPageCatalogReady = Boolean(success);
  const loading = $("#checkoutLoading");
  if (!checkoutPageCatalogReady && loading) {
    loading.classList.add("error");
    loading.innerHTML = `<p>Product availability could not be confirmed. Please <a href="./#store">return to the store</a> and try again.</p>`;
  }
  syncCheckoutPageState();
  syncStripeCheckoutDisplay();
  syncCheckoutSubmitState();
}

document.addEventListener("bh:catalog-ready", event => {
  applyCheckoutCatalogState(event.detail?.success);
});

document.addEventListener("bh:cart-updated", () => {
  syncCheckoutPageState();
  syncStripeCheckoutDisplay();
  syncCheckoutSubmitState();
});

syncCheckoutPageState();
syncCheckoutSubmitState();
if (isCheckoutPage && window.BH_CATALOG_STATE?.complete) {
  applyCheckoutCatalogState(window.BH_CATALOG_STATE.success);
}
if ($("#checkoutForm")) {
  initializePaymentProvider().finally(handleStripeReturnConfirmation);
} else if (new URLSearchParams(window.location.search).has("stripe_session_id")) {
  handleStripeReturnConfirmation();
}
