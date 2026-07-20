let checkoutProvider = "square";
let stripeConfig = {enabled:false, provider:"square", publishableKey:""};
let stripeClient = null;
let stripeScriptPromise = null;
let paymentProviderPromise = null;
let paymentProviderState = "idle";
let stripeEmbeddedCheckout = null;
let stripeCheckoutScrolledFor = null;
let paymentInProgress = false;
const isCheckoutPage = document.body.classList.contains("checkout-page");
const residentTranslations = window.BH_I18N;
const tr = (key, params = {}) => residentTranslations?.t(key, params) || key;
let checkoutSnapshot = null;
let checkoutPageCatalogReady = !isCheckoutPage || Boolean(window.BH_CATALOG_STATE?.success);
let legalAcceptedAt = "";
let acceptedLegalNoticeVersion = "";
let legalScrollGateReached = false;
let legalReviewReturnFocus = null;
const LEGAL_SCROLL_TOLERANCE = 12;
const unitValidationMessage = () => tr("checkout.unitInvalid");

window.BH_GET_CHECKOUT_SNAPSHOT = () => checkoutSnapshot;

function immutableCheckoutSnapshot(value) {
  if (!value || !Array.isArray(value.items) || !value.items.length) return null;
  const items = value.items.map(item => Object.freeze({
    id:String(item.id || ""),
    name:String(item.name || ""),
    quantity:Number(item.quantity),
    price:Number(item.price)
  }));
  if (items.some(item => !item.id || !item.name || !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.price) || item.price < 0)) return null;
  const subtotal = Number(value.subtotal);
  const processingFeeAmount = Number(value.processingFee);
  const total = Number(value.total);
  if (![subtotal,processingFeeAmount,total].every(Number.isFinite) || subtotal < 0 || processingFeeAmount < 0 || total < 0) return null;
  return Object.freeze({items:Object.freeze(items),subtotal,processingFee:processingFeeAmount,total});
}

function captureCheckoutSnapshot() {
  const items = cart.map(cartItem => {
    const product = products.find(candidate => candidate.id === cartItem.id && candidate.active);
    if (!product) return null;
    const display = residentTranslations?.displayProduct(product) || product;
    return {id:product.id,name:display.name,quantity:cartItem.quantity,price:product.price};
  }).filter(Boolean);
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const fee = processingFee(subtotal);
  return immutableCheckoutSnapshot({items,subtotal,processingFee:fee,total:subtotal + fee});
}

function setCheckoutSnapshot(snapshot) {
  checkoutSnapshot = immutableCheckoutSnapshot(snapshot);
  renderCart();
  syncCheckoutSubmitState();
  return checkoutSnapshot;
}

function releaseCheckoutSnapshot() {
  checkoutSnapshot = null;
  renderCart();
  syncCheckoutSubmitState();
}

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
}[character]));

if ($("#trackingForm")) $("#trackingForm").onsubmit = async event => {
  event.preventDefault();
  const number = new FormData(event.target).get("orderNumber").trim().toUpperCase();
  const result = $("#trackingResult");
  result.classList.remove("hidden", "error");
  result.innerHTML = `<strong>${tr("tracker.checking")}</strong>`;
  try {
    const response = await fetch(`/api/order-status?number=${encodeURIComponent(number)}`, {headers:{"Accept":"application/json"}});
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.message || "Order not found");
    result.innerHTML = `<div class="tracking-status"><span>${tr("tracker.currentStatus")}</span><strong>${escapeHtml(residentTranslations?.statusLabel(payload.order.status) || payload.order.status)}</strong></div>${payload.order.publicNote ? `<p>${escapeHtml(payload.order.publicNote)}</p>` : ""}`;
  } catch (error) {
    result.classList.add("error");
    result.innerHTML = `<strong>${tr("tracker.notFoundTitle")}</strong><br>${tr("tracker.notFoundBody")}`;
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
  if ($("#feedbackSelectedType")) $("#feedbackSelectedType").textContent = tr("feedback.label");
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
  $("#feedbackSelectedType").textContent = tr(button.dataset.feedbackI18n || "feedback.label");
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
    confirmation.innerHTML = `<strong>${unitValidationMessage()}</strong>`;
    toast(unitValidationMessage());
    return;
  }
  data.unit = normalizedUnit;
  event.target.elements.unit.value = normalizedUnit;
  confirmation.innerHTML = `<strong>${tr("feedback.sending")}</strong>`;
  try {
    const response = await fetch("/api/feedback", {
      method:"POST",
      headers:{"Content-Type":"application/json","Accept":"application/json"},
      body:JSON.stringify(data)
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error("Unable to save feedback");
    event.target.reset();
    confirmation.classList.add("hidden");
    confirmation.innerHTML = "";
    showFeedbackView("feedbackThanksView");
  } catch (error) {
    confirmation.innerHTML = `<strong>${tr("feedback.failed")}</strong><br><br>${tr("feedback.unable")}`;
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
  if (!stripeScriptPromise) {
    stripeScriptPromise = loadExternalScript("https://js.stripe.com/v3/").catch(error => {
      stripeScriptPromise = null;
      throw error;
    });
  }
  await stripeScriptPromise;
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
  const container = $("#stripeCheckoutContainer");
  container?.classList.add("hidden");
  container?.removeAttribute("aria-busy");
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
  if ($("#legalStatusTitle")) $("#legalStatusTitle").textContent = accepted ? tr("checkout.legalAccepted") : tr("checkout.legalRequired");
  if ($("#legalStatusMessage")) {
    $("#legalStatusMessage").textContent = accepted
      ? tr("checkout.legalAcceptedCopy")
      : tr("checkout.legalRequiredCopy");
  }
  if ($("#legalNoticeOpen")) $("#legalNoticeOpen").textContent = accepted ? tr("checkout.viewLegal") : tr("checkout.reviewLegal");
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
    accept.textContent = legalTermsAccepted() ? tr("checkout.legalAccepted") : tr("legal.accept");
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
  preloadPaymentProvider();

  if (acceptedLegalNoticeVersion && acceptedLegalNoticeVersion !== LEGAL_NOTICE_VERSION) resetLegalAcceptance();
  const accepted = legalTermsAccepted();
  legalReviewReturnFocus = document.activeElement;
  legalScrollGateReached = false;
  container.scrollTop = 0;
  accept.disabled = true;
  accept.textContent = accepted ? tr("checkout.legalAccepted") : tr("legal.accept");
  if ($("#legalReviewInstruction")) {
    $("#legalReviewInstruction").textContent = accepted
      ? tr("legal.acceptedInstruction")
      : tr("legal.instruction");
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
  const hasItems = checkoutSnapshot ? checkoutSnapshot.items.length > 0 : cart.length > 0;

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
  submit.disabled = paymentInProgress || Boolean(stripeEmbeddedCheckout) || Boolean(checkoutSnapshot) || !detailsComplete || !accepted || !cart.length || !checkoutPageCatalogReady;
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
    setCheckoutSubmitLabel(tr("checkout.completeBelow"));
    syncCheckoutSubmitState();
    return;
  }

  const requiresPayment = paidCheckoutRequired();
  const providerPending = requiresPayment && ["idle", "loading", "failed"].includes(paymentProviderState);
  if (providerPending) {
    container.classList.add("hidden");
    container.removeAttribute("aria-busy");
    embedded.innerHTML = "";
    setCheckoutSubmitLabel(tr("checkout.continueSecure"));
    syncCheckoutSubmitState();
    return;
  }

  const shouldShowStripe = requiresPayment && checkoutProvider === "stripe" && stripeConfig.enabled;
  if (!shouldShowStripe) {
    container.classList.add("hidden");
    embedded.innerHTML = "";
    setCheckoutSubmitLabel(tr("checkout.submitOrder"));
    syncCheckoutSubmitState();
    return;
  }

  container.classList.remove("hidden");
  const readyToContinue = checkoutDetailsComplete() && legalTermsAccepted();
  embedded.innerHTML = `<div class="stripe-payment-notice" data-stripe-placeholder>${readyToContinue
    ? tr("checkout.detailsReady")
    : tr("checkout.detailsNeeded")}</div>`;
  setCheckoutSubmitLabel(tr("checkout.continueSecure"));
  syncCheckoutSubmitState();
}

function showPaymentPreparationState() {
  const container = $("#stripeCheckoutContainer");
  const embedded = $("#stripeEmbeddedCheckout");
  if (!container || !embedded) return;
  container.classList.remove("hidden");
  container.setAttribute("aria-busy", "true");
  embedded.innerHTML = `<div class="stripe-payment-notice" data-stripe-placeholder>${tr("checkout.preparing")}</div>`;
}

async function initializePaymentProvider() {
  paymentProviderState = "loading";
  try {
    const [response] = await Promise.all([
      fetch("/api/stripe?action=config"),
      loadStripeScript()
    ]);
    const config = response.ok ? await response.json() : {provider:"square", enabled:false};
    checkoutProvider = config.provider === "stripe" ? "stripe" : "square";
    stripeConfig = config;
  } catch {
    checkoutProvider = "square";
    stripeConfig = {enabled:false, provider:"square", publishableKey:""};
    stripeClient = null;
    paymentProviderState = "failed";
    syncStripeCheckoutDisplay();
    return false;
  }

  hideApplePay();
  if (checkoutProvider !== "stripe") {
    paymentProviderState = "unavailable";
    syncStripeCheckoutDisplay();
    return false;
  }

  if (!stripeConfig.enabled || !stripeConfig.publishableKey) {
    paymentProviderState = "unavailable";
    syncStripeCheckoutDisplay();
    return false;
  }
  try {
    stripeClient = window.Stripe(stripeConfig.publishableKey);
    paymentProviderState = "ready";
  } catch {
    stripeClient = null;
    stripeConfig = {...stripeConfig, enabled:false};
    paymentProviderState = "failed";
  }
  syncStripeCheckoutDisplay();
  return paymentProviderState === "ready";
}

function preparePaymentProvider({retry = false} = {}) {
  if (!isCheckoutPage || !checkoutPageCatalogReady || !paidCheckoutRequired()) return Promise.resolve(false);
  if (paymentProviderState === "ready" && stripeClient) return Promise.resolve(true);
  if (paymentProviderState === "unavailable") return Promise.resolve(false);
  if (paymentProviderState === "failed" && !retry) return Promise.resolve(false);
  if (paymentProviderState === "failed") paymentProviderState = "idle";
  if (!paymentProviderPromise) {
    paymentProviderPromise = initializePaymentProvider().finally(() => {
      paymentProviderPromise = null;
    });
  }
  return paymentProviderPromise;
}

function preloadPaymentProvider() {
  void preparePaymentProvider();
}

async function createStripeCheckoutSession({resident, acceptedAt, snapshot}) {
  const response = await fetch("/api/stripe?action=session", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      resident,
      items:snapshot.items.map(item => ({id:item.id,quantity:item.quantity})),
      legalAccepted:true,legalNoticeVersion:LEGAL_NOTICE_VERSION,legalAcceptedAt:acceptedAt
    })
  });
  const result = await response.json();
  if (!response.ok || !result.success || !result.clientSecret || !result.orderNumber) throw new Error(result.message || "Stripe checkout could not be started");
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
  checkoutSnapshot = null;
  cart = [];
  persist();
  renderCart();
  renderProducts();
  syncStripeCheckoutDisplay();
}

function showSuccessMessage({title, body, orderNumber = ""}) {
  $("#successEyebrow") && ($("#successEyebrow").textContent = tr("checkout.paymentReceived"));
  $("#successTitle") && ($("#successTitle").textContent = title);
  if ($("#successBody")) {
    $("#successBody").innerHTML = orderNumber
      ? `${body} <span class="success-order-reference">${tr("checkout.orderReference", {order:`<strong>${escapeHtml(orderNumber)}</strong>`})}</span>`
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
    title:tr("checkout.paidTitle"),
    body:tr("checkout.paidBody"),
    orderNumber
  });
}

function showResidentOrderConfirmation({name = "", orderNumber = "", note = ""}) {
  $("#successEyebrow") && ($("#successEyebrow").textContent = tr("success.requestReceived"));
  $("#successTitle") && ($("#successTitle").textContent = tr("success.thankYou", {name:name ? `, ${name}` : ""}));
  if ($("#successBody")) {
    $("#successBody").innerHTML = `${tr("success.orderReceived", {order:`<strong>${escapeHtml(orderNumber)}</strong>`})} <span id="successPaymentNote">${escapeHtml(note)}</span>`;
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
  showPaymentPreparationState();
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
        showPaymentError(tr("checkout.confirmFailed"));
      }
    }
  });
  try {
    stripeEmbeddedCheckout.mount("#stripeEmbeddedCheckout");
    $("#stripeCheckoutContainer")?.removeAttribute("aria-busy");
    $("#paymentMessage").textContent = tr("checkout.stripeReady");
    $("#paymentMessage").classList.remove("hidden", "error");
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
      title:tr("checkout.returnPaymentTitle"),
      body:tr("checkout.returnPaymentBody")
    });
  }
}

if ($("#checkoutOpen")) $("#checkoutOpen").addEventListener("click", () => {
  hideApplePay();
  clearPaymentMessage();
  syncStripeCheckoutDisplay();
});

function createOrderRecords() {
  const source = checkoutSnapshot?.items || cart;
  return source.map(item => ({productId:item.id, quantity:item.quantity}));
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
  if (!checkoutPageCatalogReady) return tr("checkout.catalogUnavailable");
  if (!cart.length) return tr("checkout.emptyError");
  if (!resident.name.trim()) return tr("checkout.nameError");
  if (!resident.unit.trim()) return tr("checkout.unitError");
  if (!normalizeUnitNumber(resident.unit)) return unitValidationMessage();
  if (!form.elements.email.validity.valid) return tr("checkout.emailError");
  if (!normalizeUsPhone(resident.phone)) return tr("checkout.phoneError");
  if (!legalTermsAccepted()) return tr("checkout.legalError");
  return "";
}

function finalizeSuccessfulOrder(records) {
  records.forEach(record => {
    const product = products.find(candidate => candidate.id === record.productId);
    if (product) product.inventory = Math.max(0, product.inventory - record.quantity);
  });
  cart = [];
  checkoutSnapshot = null;
  persist();
  renderCart();
  renderProducts();
}

if ($("#checkoutForm")) {
  const syncCheckoutFormState = () => {
    preloadPaymentProvider();
    syncCheckoutSubmitState();
    syncStripeCheckoutDisplay();
  };
  $("#checkoutForm").addEventListener("focusin", preloadPaymentProvider, {once:true});
  $("#checkoutForm").addEventListener("input", syncCheckoutFormState);
  $("#checkoutForm").addEventListener("change", syncCheckoutFormState);
  $("#checkoutForm").addEventListener("reset", resetLegalAcceptance);
  $("#checkoutForm").onsubmit = async event => {
  event.preventDefault();
  if (paymentInProgress || stripeEmbeddedCheckout || checkoutSnapshot) return;
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

  const subtotal = cartSubtotal();
  const fee = processingFee(subtotal);
  const requiresPayment = subtotal + fee > 0;
  const submit = $("#checkoutSubmit");
  const message = $("#paymentMessage");
  submit.disabled = true;
  paymentInProgress = true;
  submit.textContent = requiresPayment ? tr("checkout.preparing") : tr("checkout.recording");
  clearPaymentMessage();

  const acceptedAt = legalAcceptedAt;
  const snapshot = setCheckoutSnapshot(captureCheckoutSnapshot());
  if (!snapshot) {
    message.textContent = tr("checkout.catalogUnavailable");
    message.classList.remove("hidden");
    message.classList.add("error");
    submit.disabled = false;
    paymentInProgress = false;
    return;
  }
  const records = createOrderRecords();

  if (requiresPayment) {
    showPaymentPreparationState();
    const providerReady = await preparePaymentProvider({retry:true});
    if (!providerReady || checkoutProvider !== "stripe" || !stripeConfig.enabled || !stripeClient) {
      releaseCheckoutSnapshot();
      message.textContent = checkoutProvider === "stripe" ? tr("checkout.secureUnavailable") : tr("checkout.paymentUnavailable");
      message.classList.remove("hidden");
      message.classList.add("error");
      submit.disabled = false;
      paymentInProgress = false;
      syncStripeCheckoutDisplay();
      return;
    }
  }

  try {
    let payment;
    let orderNumber = "";
    if (!requiresPayment) {
      const response = await fetch("/api/create-order", {
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({
          resident,
          items:snapshot.items.map(item => ({id:item.id,quantity:item.quantity})),
          legalAccepted:true,legalNoticeVersion:LEGAL_NOTICE_VERSION,legalAcceptedAt:acceptedAt
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Order could not be saved");
      orderNumber = result.order?.orderNumber || "";
      if (!orderNumber) throw new Error("Order reference was not returned");
      payment = {status:"No Payment Required",id:"",createdAt:acceptedAt};
    } else if (checkoutProvider === "stripe") {
      const session = await createStripeCheckoutSession({resident,acceptedAt,snapshot});
      await mountStripeCheckout(session, records, resident, session.orderNumber);
      submit.textContent = tr("checkout.completeBelow");
      paymentInProgress = false;
      return;
    }

    finalizeSuccessfulOrder(records, payment);
    form.reset();
    closeModal("#checkoutModal");
    showResidentOrderConfirmation({
      name:resident.name.trim().split(" ")[0],
      orderNumber,
      note:!requiresPayment
        ? tr("checkout.noPayment")
        : tr("checkout.paymentConfirmed")
    });
  } catch (error) {
    console.error(requiresPayment ? "Secure payment setup failed" : "Order submission failed", error);
    resetStripeCheckout();
    releaseCheckoutSnapshot();
    message.textContent = requiresPayment
      ? tr("checkout.sessionFailed")
      : tr("checkout.orderFailed");
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
    loading.innerHTML = `<p>${tr("checkout.catalogUnavailable")}</p>`;
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

document.addEventListener("bh:language-changed", () => {
  syncLegalReviewState();
  const selectedFeedbackCategory = $("#feedbackCategory")?.value;
  if (selectedFeedbackCategory && $("#feedbackSelectedType")) {
    const selectedButton = $$('[data-feedback-category]').find(button => button.dataset.feedbackCategory === selectedFeedbackCategory);
    $("#feedbackSelectedType").textContent = tr(selectedButton?.dataset.feedbackI18n || "feedback.label");
  }
  if ($("#legalReviewInstruction")) {
    $("#legalReviewInstruction").textContent = legalTermsAccepted() ? tr("legal.acceptedInstruction") : tr("legal.instruction");
  }
  if ($("#legalReviewAccept")) {
    $("#legalReviewAccept").textContent = legalTermsAccepted() ? tr("checkout.legalAccepted") : tr("legal.accept");
  }
  syncStripeCheckoutDisplay();
  syncCheckoutSubmitState();
});

window.addEventListener("pageshow", event => {
  if (!isCheckoutPage || !event.persisted || (!paymentInProgress && !stripeEmbeddedCheckout && !checkoutSnapshot)) return;
  paymentInProgress = false;
  resetStripeCheckout();
  releaseCheckoutSnapshot();
  window.location.reload();
});

syncCheckoutPageState();
syncCheckoutSubmitState();
if (isCheckoutPage && window.BH_CATALOG_STATE?.complete) {
  applyCheckoutCatalogState(window.BH_CATALOG_STATE.success);
}
if (new URLSearchParams(window.location.search).has("stripe_session_id")) {
  handleStripeReturnConfirmation();
}
