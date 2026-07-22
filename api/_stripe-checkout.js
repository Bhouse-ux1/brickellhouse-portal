const crypto = require("crypto");
const {getTrustedProductCatalog} = require("./_catalog");
const {supabaseRequest} = require("./_supabase");
const {
  sendOrderEmails,
  sendValetRecurringEnrollmentEmails,
  sendValetRecurringRenewalEmail
} = require("./order-emails");
const {insertOrderWithGeneratedNumber} = require("../server/order-number");
const {calculateProcessingFeeCents} = require("../processing-fee");

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = process.env.STRIPE_API_VERSION || "2025-06-30.basil";
const VALET_RECURRING_PRODUCT_ID = "svc13";
const VALET_RECURRING_AUTHORIZATION_VERSION = "BH-VALET-RECURRING-2026-07-22";
const VALET_RECURRING_AUTHORIZATION_TEXT = "I authorize BrickellHouse to automatically charge my selected payment method $257.55 each month for my recurring Valet Parking subscription until I request cancellation. I understand cancellation requests must be emailed to admin@brickellhouse.net at least five (5) business days before my next scheduled billing date. I understand recurring charges continue until Management processes my cancellation.";
const VALET_RECURRING_CHECKOUT_TYPE = "valet_recurring";
const VALET_RECURRING_AMOUNTS = Object.freeze({
  valetCents:25000,
  processingFeeCents:755,
  totalCents:25755
});

function normalizeUsPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function liveStripeModeAllowed() {
  const mode = String(process.env.STRIPE_MODE || "").trim().toLowerCase();
  const allowLive = String(process.env.STRIPE_ALLOW_LIVE || "").trim().toLowerCase();
  return mode === "live" || allowLive === "true";
}

function stripeKeyMode(key, testPrefix, livePrefix) {
  if (String(key || "").startsWith(testPrefix)) return "test";
  if (String(key || "").startsWith(livePrefix)) return "live";
  return "";
}

function stripeKeyConfig() {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || "";
  const secretKey = process.env.STRIPE_SECRET_KEY || "";
  const publishableMode = stripeKeyMode(publishableKey, "pk_test_", "pk_live_");
  const secretMode = stripeKeyMode(secretKey, "sk_test_", "sk_live_");
  const matchingMode = publishableMode && secretMode && publishableMode === secretMode ? publishableMode : "";
  const liveAllowed = liveStripeModeAllowed();
  const enabled = matchingMode === "test" || (matchingMode === "live" && liveAllowed);
  return {enabled, mode:enabled ? matchingMode : "", publishableKey, publishableMode, secretMode, liveAllowed};
}

function stripeSecretKey() {
  const config = stripeKeyConfig();
  if (!config.enabled) {
    const error = new Error("Stripe checkout is not configured for the selected key mode");
    error.status = 503;
    throw error;
  }
  return process.env.STRIPE_SECRET_KEY || "";
}

async function stripeRequest(path, {method = "GET", body} = {}) {
  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method,
    headers:{
      "Authorization":`Bearer ${stripeSecretKey()}`,
      "Stripe-Version":STRIPE_API_VERSION,
      ...(body ? {"Content-Type":"application/x-www-form-urlencoded"} : {})
    },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Stripe request failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function publicError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function valetRecurringPriceIds() {
  const valet = String(process.env.STRIPE_VALET_MONTHLY_PRICE_ID || "").trim();
  const processingFee = String(process.env.STRIPE_VALET_MONTHLY_PROCESSING_FEE_PRICE_ID || "").trim();
  if (!valet.startsWith("price_") || !processingFee.startsWith("price_") || valet === processingFee) {
    throw publicError("Stripe recurring Valet pricing is not configured", 503);
  }
  return {valet, processingFee};
}

function assertMonthlyPrice(price, expectedId, expectedAmount) {
  if (
    price?.id !== expectedId
    || price?.active !== true
    || price?.type !== "recurring"
    || String(price?.currency || "").toLowerCase() !== "usd"
    || Number(price?.unit_amount) !== expectedAmount
    || price?.recurring?.interval !== "month"
    || Number(price?.recurring?.interval_count || 1) !== 1
    || price?.billing_scheme !== "per_unit"
    || price?.transform_quantity != null
    || price?.recurring?.usage_type !== "licensed"
    || price?.tiers != null
    || price?.tiers_mode != null
  ) {
    throw publicError("Stripe recurring Valet pricing does not match the approved configuration", 503);
  }
}

async function assertValetRecurringPriceConfiguration() {
  const priceIds = valetRecurringPriceIds();
  const [valetPrice, processingFeePrice] = await Promise.all([
    stripeRequest(`/prices/${encodeURIComponent(priceIds.valet)}`),
    stripeRequest(`/prices/${encodeURIComponent(priceIds.processingFee)}`)
  ]);
  assertMonthlyPrice(valetPrice, priceIds.valet, VALET_RECURRING_AMOUNTS.valetCents);
  assertMonthlyPrice(processingFeePrice, priceIds.processingFee, VALET_RECURRING_AMOUNTS.processingFeeCents);
  return priceIds;
}

async function assertStripeStorageReady() {
  await Promise.all([
    supabaseRequest("orders?select=id,payment_provider,payment_processor_reference,stripe_checkout_session_id,stripe_payment_intent_id,stripe_charge_id&limit=1", {
      method:"GET",
      prefer:""
    }),
    supabaseRequest("payment_events?select=id,payment_provider,processor_event_id,processor_payment_id,event_type&limit=1", {
      method:"GET",
      prefer:""
    })
  ]);
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

async function buildTrustedCheckout(rawBody) {
  const body = parseBody(rawBody);
  const {resident = {}, items = [], legalAccepted, legalNoticeVersion, legalAcceptedAt} = body;
  const recurringSelected = body.paymentOption === "recurring";
  const phone = normalizeUsPhone(resident.phone);
  const email = String(resident.email || "").trim();
  const name = String(resident.name || "").trim();
  const unit = String(resident.unit || "").trim().toUpperCase();

  if (!name || !unit || !email) {
    const error = new Error("Missing required checkout data");
    error.status = 400;
    throw error;
  }
  if (!validEmail(email)) {
    const error = new Error("Enter a valid email address before payment");
    error.status = 400;
    throw error;
  }
  if (!phone) {
    const error = new Error("Enter a valid U.S. phone number before payment");
    error.status = 400;
    throw error;
  }
  if (!legalAccepted || !legalNoticeVersion) {
    const error = new Error("Legal acceptance evidence is required");
    error.status = 400;
    throw error;
  }
  if (!Array.isArray(items) || !items.length) {
    const error = new Error("Cart is empty");
    error.status = 400;
    throw error;
  }

  const products = await getTrustedProductCatalog();
  const accounting = [];
  let subtotalCents = 0;

  for (const item of items) {
    const productId = String(item.id || item.productId || "");
    const quantity = Number(item.quantity);
    const product = products[productId];
    if (!product || !product.active) {
      const error = new Error("One of the selected items is no longer available");
      error.status = 400;
      throw error;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99 || quantity > Number(product.inventory || 0)) {
      const error = new Error("Invalid quantity for one of the selected items");
      error.status = 400;
      throw error;
    }
    subtotalCents += product.priceCents * quantity;
    accounting.push({
      productId,
      quantity,
      residentName:product.name,
      internalName:product.internalName,
      glCode:product.glCode,
      unitPriceCents:product.priceCents
    });
  }

  const recurringEligibleItem = accounting.length === 1
    && accounting[0].productId === VALET_RECURRING_PRODUCT_ID
    && accounting[0].quantity === 1
    && accounting[0].unitPriceCents === VALET_RECURRING_AMOUNTS.valetCents
    && accounting[0].glCode === "40033"
    && subtotalCents === VALET_RECURRING_AMOUNTS.valetCents;
  const processingFeeCents = recurringSelected
    ? VALET_RECURRING_AMOUNTS.processingFeeCents
    : calculateProcessingFeeCents(subtotalCents);
  const totalCents = subtotalCents + processingFeeCents;
  if (totalCents <= 0) {
    const error = new Error("Stripe checkout is only used for paid orders");
    error.status = 400;
    throw error;
  }

  if (recurringSelected) {
    if (body.recurringAuthorizationAccepted !== true) {
      throw publicError("Please acknowledge the recurring payment authorization before continuing.");
    }
    const eligible = recurringEligibleItem
      && processingFeeCents === VALET_RECURRING_AMOUNTS.processingFeeCents
      && totalCents === VALET_RECURRING_AMOUNTS.totalCents;
    if (!eligible) {
      throw publicError("Recurring monthly payments are only available for one eligible Valet Parking selection.");
    }
  }

  return {
    resident:{name, unit, email, phone},
    legal:{acceptedAt:legalAcceptedAt || new Date().toISOString(), noticeVersion:String(legalNoticeVersion)},
    accounting,
    subtotalCents,
    processingFeeCents,
    totalCents,
    checkoutType:recurringSelected ? VALET_RECURRING_CHECKOUT_TYPE : "one_time",
    recurring:recurringSelected ? {
      selected:true,
      authorizationAccepted:true,
      authorizationVersion:VALET_RECURRING_AUTHORIZATION_VERSION,
      authorizationTimestamp:new Date().toISOString(),
      ...VALET_RECURRING_AMOUNTS
    } : null
  };
}

function stripeMetadata(checkout) {
  const glCodeSet = new Set(checkout.accounting.map(item => item.glCode).filter(Boolean));
  const glCodes = ["40090", "40033"].filter(code => glCodeSet.has(code));
  const metadata = {
    order_number:checkout.orderNumber.slice(0, 500),
    legal_notice_version:checkout.legal.noticeVersion.slice(0, 500),
    items_json:JSON.stringify(checkout.accounting.map(item => ({id:item.productId,q:item.quantity}))).slice(0, 500),
    gl_code:glCodes.join(",").slice(0, 500),
    subtotal_cents:String(checkout.subtotalCents),
    processing_fee_cents:String(checkout.processingFeeCents),
    total_cents:String(checkout.totalCents)
  };
  if (checkout.recurring) {
    metadata.checkout_type = VALET_RECURRING_CHECKOUT_TYPE;
    metadata.authorization_version = checkout.recurring.authorizationVersion;
    metadata.authorization_timestamp = checkout.recurring.authorizationTimestamp;
  }
  return metadata;
}

function appendMetadata(params, prefix, metadata) {
  Object.entries(metadata).forEach(([key, value]) => {
    params.append(prefix ? `${prefix}[metadata][${key}]` : `metadata[${key}]`, value);
  });
}

function appendLineItem(params, index, name, unitAmount, quantity, description = name) {
  params.append(`line_items[${index}][price_data][currency]`, "usd");
  params.append(`line_items[${index}][price_data][unit_amount]`, String(unitAmount));
  params.append(`line_items[${index}][price_data][product_data][name]`, String(name).slice(0, 255));
  params.append(`line_items[${index}][price_data][product_data][description]`, String(description).slice(0, 1000));
  params.append(`line_items[${index}][quantity]`, String(quantity));
}

async function createCheckoutSession(checkout, origin, validatedRecurringPriceIds = null) {
  const params = new URLSearchParams();
  const metadata = stripeMetadata(checkout);
  params.append("ui_mode", "embedded");
  params.append("client_reference_id", checkout.orderNumber.slice(0, 200));
  params.append("return_url", `${origin.replace(/\/$/, "")}${checkout.recurring ? "/checkout.html" : "/"}?stripe_session_id={CHECKOUT_SESSION_ID}`);
  appendMetadata(params, "", metadata);
  if (checkout.recurring) {
    const priceIds = validatedRecurringPriceIds || await assertValetRecurringPriceConfiguration();
    params.append("mode", "subscription");
    params.append("customer_email", checkout.resident.email);
    params.append("line_items[0][price]", priceIds.valet);
    params.append("line_items[0][quantity]", "1");
    params.append("line_items[1][price]", priceIds.processingFee);
    params.append("line_items[1][quantity]", "1");
    appendMetadata(params, "subscription_data", metadata);
  } else {
    params.append("mode", "payment");
    appendMetadata(params, "payment_intent_data", metadata);
    checkout.accounting.forEach((item, index) => appendLineItem(params, index, item.residentName, item.unitPriceCents, item.quantity, item.residentName));
    if (checkout.processingFeeCents > 0) {
      appendLineItem(params, checkout.accounting.length, "Processing Fee", checkout.processingFeeCents, 1);
    }
  }

  return stripeRequest("/checkout/sessions", {method:"POST", body:params});
}

async function retrieveCheckoutSession(sessionId) {
  const id = encodeURIComponent(String(sessionId || ""));
  if (!id) {
    const error = new Error("Stripe session ID is required");
    error.status = 400;
    throw error;
  }
  return stripeRequest(`/checkout/sessions/${id}?expand[]=payment_intent&expand[]=subscription&expand[]=line_items.data.price`);
}

function metadataCheckoutBody(session) {
  const metadata = session.metadata || {};
  let items = [];
  try {
    items = JSON.parse(metadata.items_json || "[]").map(item => ({id:item.id, quantity:item.q}));
  } catch {
    items = [];
  }
  return {
    orderNumber:metadata.order_number,
    resident:{},
    items,
    legalAccepted:true,
    legalNoticeVersion:metadata.legal_notice_version,
    legalAcceptedAt:""
  };
}

function latestChargeId(paymentIntent) {
  if (!paymentIntent) return "";
  if (typeof paymentIntent === "string") return "";
  return typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id || "";
}

async function pendingStripeOrder(orderNumber) {
  const rows = await supabaseRequest(`orders?order_number=eq.${encodeURIComponent(orderNumber)}&select=*,order_items(*)&limit=1`, {
    method:"GET",
    prefer:""
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function deletePendingOrder(orderId) {
  if (!orderId) return;
  try {
    await supabaseRequest(`orders?id=eq.${encodeURIComponent(orderId)}&payment_status=eq.Pending`, {
      method:"DELETE",
      prefer:"return=minimal"
    });
  } catch (error) {
    console.error(`Unable to clean up incomplete pending Stripe order: ${error.message || "Unknown error"}`);
  }
}

async function createPendingStripeOrder(checkout) {
  const {result:orderRows} = await insertOrderWithGeneratedNumber(orderNumber => supabaseRequest("orders", {
    method:"POST",
    body:[{
      order_number:orderNumber,
      resident_name:checkout.resident.name,
      unit_number:checkout.resident.unit,
      email:checkout.resident.email,
      phone:checkout.resident.phone,
      subtotal_cents:checkout.subtotalCents,
      processing_fee_cents:checkout.processingFeeCents,
      total_cents:checkout.totalCents,
      status:"Received",
      payment_status:"Pending",
      square_payment_id:null,
      payment_provider:"stripe",
      payment_processor_reference:null,
      stripe_checkout_session_id:null,
      stripe_payment_intent_id:null,
      stripe_charge_id:null,
      payment_at:null,
      legal_accepted:true,
      legal_accepted_at:checkout.legal.acceptedAt,
      legal_notice_version:checkout.legal.noticeVersion,
      terms_version:null,
      privacy_policy_version:null
    }]
  }));
  const order = orderRows?.[0];
  try {
    await supabaseRequest("order_items", {
      method:"POST",
      body:checkout.accounting.map(item => ({
        order_id:order.id,
        product_id:null,
        resident_name_snapshot:item.residentName,
        internal_name_snapshot:item.internalName,
        gl_code_snapshot:item.glCode,
        quantity:item.quantity,
        unit_price_cents:item.unitPriceCents
      }))
    });
  } catch (error) {
    await deletePendingOrder(order?.id);
    const wrapped = new Error("Stripe pending order line items could not be saved");
    wrapped.status = error.status || 500;
    throw wrapped;
  }
  return order;
}

function recurringAuthorizationEventId(orderNumber) {
  return `valet_recurring_authorization_${String(orderNumber || "")}`;
}

async function recordValetRecurringAuthorization(order, checkout) {
  if (!checkout.recurring) return null;
  const payload = {
    recurring_selected:true,
    authorization_accepted:true,
    authorization_version:checkout.recurring.authorizationVersion,
    authorization_text:VALET_RECURRING_AUTHORIZATION_TEXT,
    authorization_timestamp:checkout.recurring.authorizationTimestamp,
    resident:checkout.resident.name,
    email:checkout.resident.email,
    unit:checkout.resident.unit,
    valet_amount_cents:checkout.recurring.valetCents,
    processing_fee_cents:checkout.recurring.processingFeeCents,
    monthly_total_cents:checkout.recurring.totalCents
  };
  const rows = await supabaseRequest("payment_events", {
    method:"POST",
    body:[{
      order_number:order.order_number,
      square_payment_id:null,
      status:"Authorized",
      amount_cents:checkout.recurring.totalCents,
      payload,
      payment_provider:"stripe",
      processor_event_id:recurringAuthorizationEventId(order.order_number),
      processor_payment_id:null,
      event_type:"recurring_authorization"
    }]
  });
  return rows?.[0] || null;
}

async function recurringAuthorizationRecord(orderNumber) {
  const eventId = recurringAuthorizationEventId(orderNumber);
  const rows = await supabaseRequest(`payment_events?processor_event_id=eq.${encodeURIComponent(eventId)}&select=id,payload&limit=1`, {
    method:"GET",
    prefer:""
  });
  return Array.isArray(rows) ? rows[0] : null;
}

function recurringSubscriptionBindingEventId(orderNumber) {
  return `valet_recurring_subscription_${String(orderNumber || "")}`;
}

async function recurringSubscriptionBindingRecord(orderNumber) {
  const eventId = recurringSubscriptionBindingEventId(orderNumber);
  const rows = await supabaseRequest(`payment_events?processor_event_id=eq.${encodeURIComponent(eventId)}&select=id,order_number,status,payload,processor_payment_id&limit=1`, {
    method:"GET",
    prefer:""
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function recordValetRecurringSubscriptionBinding(order, session) {
  const subscriptionId = stripeObjectId(session?.subscription);
  if (!subscriptionId) throw publicError("Stripe recurring Valet subscription was not found", 409);
  const eventId = recurringSubscriptionBindingEventId(order.order_number);
  const payload = {
    order_number:order.order_number,
    authorization_event_id:recurringAuthorizationEventId(order.order_number),
    subscription_id:subscriptionId,
    checkout_session_id:String(session?.id || ""),
    verified_at:new Date().toISOString()
  };
  try {
    const rows = await supabaseRequest("payment_events", {
      method:"POST",
      body:[{
        order_number:order.order_number,
        square_payment_id:null,
        status:"Verified",
        amount_cents:VALET_RECURRING_AMOUNTS.totalCents,
        payload,
        payment_provider:"stripe",
        processor_event_id:eventId,
        processor_payment_id:subscriptionId,
        event_type:"recurring_subscription_binding"
      }]
    });
    return rows?.[0] || {payload, processor_payment_id:subscriptionId};
  } catch (error) {
    if (error.payload?.code !== "23505" && !error.message.includes("duplicate")) throw error;
    const existing = await recurringSubscriptionBindingRecord(order.order_number);
    if (
      existing?.order_number !== order.order_number
      || existing?.processor_payment_id !== subscriptionId
      || existing?.payload?.subscription_id !== subscriptionId
      || existing?.payload?.checkout_session_id !== session.id
    ) {
      throw publicError("Stored recurring Valet subscription binding does not match", 409);
    }
    return existing;
  }
}

function validRecurringAuthorization(record, order) {
  const payload = record?.payload || {};
  return Boolean(
    record?.id
    && payload.recurring_selected === true
    && payload.authorization_accepted === true
    && payload.authorization_version === VALET_RECURRING_AUTHORIZATION_VERSION
    && payload.authorization_text === VALET_RECURRING_AUTHORIZATION_TEXT
    && payload.authorization_timestamp
    && payload.resident === order.resident_name
    && payload.email === order.email
    && payload.unit === order.unit_number
    && Number(payload.valet_amount_cents) === VALET_RECURRING_AMOUNTS.valetCents
    && Number(payload.processing_fee_cents) === VALET_RECURRING_AMOUNTS.processingFeeCents
    && Number(payload.monthly_total_cents) === VALET_RECURRING_AMOUNTS.totalCents
  );
}

function recurringEnrollmentNotificationEventId(orderNumber) {
  return `valet_recurring_enrollment_notification_${String(orderNumber || "")}`;
}

async function recurringEnrollmentNotificationRecord(orderNumber) {
  const eventId = recurringEnrollmentNotificationEventId(orderNumber);
  const rows = await supabaseRequest(`payment_events?processor_event_id=eq.${encodeURIComponent(eventId)}&select=id,payload&limit=1`, {
    method:"GET",
    prefer:""
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function ensureRecurringEnrollmentNotificationRecord(orderNumber, paymentIntentId) {
  const eventId = recurringEnrollmentNotificationEventId(orderNumber);
  const payload = {resident_email_sent:false, management_email_sent:false};
  try {
    const rows = await supabaseRequest("payment_events", {
      method:"POST",
      body:[{
        order_number:orderNumber,
        square_payment_id:null,
        status:"Pending",
        amount_cents:VALET_RECURRING_AMOUNTS.totalCents,
        payload,
        payment_provider:"stripe",
        processor_event_id:eventId,
        processor_payment_id:paymentIntentId || null,
        event_type:"recurring_enrollment_notification"
      }]
    });
    return rows?.[0] || {payload};
  } catch (error) {
    if (error.payload?.code !== "23505" && !error.message.includes("duplicate")) throw error;
    return recurringEnrollmentNotificationRecord(orderNumber);
  }
}

async function attachStripeSessionToPendingOrder(orderId, session) {
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || "";
  const rows = await supabaseRequest(`orders?id=eq.${encodeURIComponent(orderId)}&payment_status=eq.Pending`, {
    method:"PATCH",
    body:{
      payment_processor_reference:paymentIntentId || session.id,
      stripe_checkout_session_id:session.id,
      stripe_payment_intent_id:paymentIntentId || null
    }
  });
  const order = rows?.[0];
  if (!order) {
    const error = new Error("Stripe pending order could not be linked to the session");
    error.status = 409;
    throw error;
  }
  return order;
}

function stripeObjectId(value) {
  if (typeof value === "string") return value;
  return typeof value?.id === "string" ? value.id : "";
}

function linePriceId(line) {
  return stripeObjectId(line?.price)
    || stripeObjectId(line?.pricing?.price_details?.price)
    || String(line?.pricing?.price_details?.price || "");
}

function exactRecurringLineItems(lines) {
  const priceIds = valetRecurringPriceIds();
  const actual = (Array.isArray(lines) ? lines : []).map(line => ({
    priceId:linePriceId(line),
    quantity:Number(line?.quantity || 0)
  })).sort((left, right) => left.priceId.localeCompare(right.priceId));
  const expected = [
    {priceId:priceIds.valet, quantity:1},
    {priceId:priceIds.processingFee, quantity:1}
  ].sort((left, right) => left.priceId.localeCompare(right.priceId));
  return actual.length === expected.length && actual.every((line, index) => (
    line.priceId === expected[index].priceId && line.quantity === expected[index].quantity
  ));
}

function exactRecurringRenewalLineItems(lines) {
  const priceIds = valetRecurringPriceIds();
  const expectedAmounts = new Map([
    [priceIds.valet, VALET_RECURRING_AMOUNTS.valetCents],
    [priceIds.processingFee, VALET_RECURRING_AMOUNTS.processingFeeCents]
  ]);
  const actual = Array.isArray(lines) ? lines : [];
  if (actual.length !== expectedAmounts.size) return false;
  const seen = new Set();
  for (const line of actual) {
    const priceId = linePriceId(line);
    if (
      !expectedAmounts.has(priceId)
      || seen.has(priceId)
      || Number(line?.quantity || 0) !== 1
      || Number(line?.amount) !== expectedAmounts.get(priceId)
      || String(line?.currency || "").toLowerCase() !== "usd"
      || line?.proration === true
      || line?.parent?.subscription_item_details?.proration === true
      || (Array.isArray(line?.discount_amounts) && line.discount_amounts.length > 0)
    ) return false;
    seen.add(priceId);
  }
  return seen.size === expectedAmounts.size;
}

function exactRecurringSubscriptionItems(subscription) {
  return exactRecurringLineItems(subscription?.items?.data);
}

function recurringSessionSelected(session) {
  return session?.mode === "subscription" || session?.metadata?.checkout_type === VALET_RECURRING_CHECKOUT_TYPE;
}

function assertVerifiedValetRecurringSession(session) {
  if (
    session?.mode !== "subscription"
    || session?.metadata?.checkout_type !== VALET_RECURRING_CHECKOUT_TYPE
    || session?.metadata?.authorization_version !== VALET_RECURRING_AUTHORIZATION_VERSION
    || !session?.metadata?.authorization_timestamp
    || !stripeObjectId(session?.subscription)
    || Number(session?.amount_total || 0) !== VALET_RECURRING_AMOUNTS.totalCents
    || String(session?.currency || "").toLowerCase() !== "usd"
    || !exactRecurringLineItems(session?.line_items?.data)
  ) {
    throw publicError("Stripe recurring Valet subscription verification failed", 409);
  }
}

function assertValetRecurringOrder(order) {
  const items = Array.isArray(order?.order_items) ? order.order_items : [];
  const item = items[0];
  if (
    Number(order?.subtotal_cents) !== VALET_RECURRING_AMOUNTS.valetCents
    || Number(order?.processing_fee_cents) !== VALET_RECURRING_AMOUNTS.processingFeeCents
    || Number(order?.total_cents) !== VALET_RECURRING_AMOUNTS.totalCents
    || items.length !== 1
    || Number(item?.quantity) !== 1
    || Number(item?.unit_price_cents) !== VALET_RECURRING_AMOUNTS.valetCents
    || String(item?.gl_code_snapshot || "") !== "40033"
  ) {
    throw publicError("Stored recurring Valet order verification failed", 409);
  }
}

async function recordStripePaymentEvent({session, eventId = null, eventType = "manual_confirmation"}) {
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
  const processorEventId = eventId || `stripe_payment_${paymentIntentId || session.id}`;
  try {
    await supabaseRequest("payment_events", {
      method:"POST",
      body:[{
        order_number:session.metadata?.order_number || session.client_reference_id || null,
        square_payment_id:null,
        status:session.payment_status || session.status || "unknown",
        amount_cents:Number(session.amount_total || 0),
        payload:{session},
        payment_provider:"stripe",
        processor_event_id:processorEventId,
        processor_payment_id:paymentIntentId,
        event_type:eventType
      }]
    });
  } catch (error) {
    if (error.payload?.code === "23505" || error.message.includes("duplicate")) return {duplicate:true};
    throw error;
  }
  return {duplicate:false};
}

async function sendStripeOrderEmails(order, session, createdAt, sendRecurringEnrollmentEmails = sendValetRecurringEnrollmentEmails) {
  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || "";
  const emailOrder = {
    paymentId:paymentIntentId || session.id,
    orderNumber:order.order_number,
    residentName:order.resident_name,
    unit:order.unit_number,
    email:order.email,
    phone:order.phone,
    items:(order.order_items || []).map(item => ({
      name:item.resident_name_snapshot,
      quantity:item.quantity,
      unitPriceCents:item.unit_price_cents
    })),
    managementItems:(order.order_items || []).map(item => ({
      name:item.internal_name_snapshot || `${item.resident_name_snapshot} GL-${item.gl_code_snapshot}`,
      quantity:item.quantity,
      unitPriceCents:item.unit_price_cents
    })),
    subtotalCents:order.subtotal_cents,
    processingFeeCents:order.processing_fee_cents,
    totalCents:order.total_cents,
    paymentMethod:"Stripe",
    createdAt
  };
  if (!recurringSessionSelected(session)) {
    try {
      await sendOrderEmails(emailOrder);
    } catch (error) {
      console.error(`Stripe order email notification failed after successful payment: ${error.message || "Unknown error"}`);
    }
    return;
  }

  const authorization = await recurringAuthorizationRecord(order.order_number);
  if (!validRecurringAuthorization(authorization, order)) {
    throw publicError("Recurring Valet authorization record was not found", 409);
  }
  const notification = await ensureRecurringEnrollmentNotificationRecord(order.order_number, paymentIntentId);
  const prior = notification?.payload || {};
  if (prior.resident_email_sent === true && prior.management_email_sent === true) return;
  const result = await sendRecurringEnrollmentEmails(emailOrder, {
    sendResident:prior.resident_email_sent !== true,
    sendManagement:prior.management_email_sent !== true
  });
  const nextPayload = {
    resident_email_sent:prior.resident_email_sent === true || result.resident === true,
    management_email_sent:prior.management_email_sent === true || result.management === true,
    notification_updated_at:new Date().toISOString()
  };
  await supabaseRequest(`payment_events?processor_event_id=eq.${encodeURIComponent(recurringEnrollmentNotificationEventId(order.order_number))}`, {
    method:"PATCH",
    body:{
      status:nextPayload.resident_email_sent && nextPayload.management_email_sent ? "Sent" : "Retry Required",
      payload:nextPayload
    }
  });
  if (!nextPayload.resident_email_sent || !nextPayload.management_email_sent) {
    throw publicError("Recurring Valet enrollment notification delivery is incomplete", 502);
  }
}

async function fulfillPaidStripeSession(session, {
  eventId = null,
  eventType = "manual_confirmation",
  sendRecurringEnrollmentEmails = sendValetRecurringEnrollmentEmails
} = {}) {
  if (session.payment_status !== "paid") {
    const error = new Error("Stripe payment is not paid");
    error.status = 400;
    throw error;
  }
  if (String(session.currency || "").toLowerCase() !== "usd") {
    const error = new Error("Stripe payment currency is invalid");
    error.status = 400;
    throw error;
  }

  const recurring = recurringSessionSelected(session);
  if (recurring) assertVerifiedValetRecurringSession(session);

  const processorEventId = `stripe_payment_${typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || session.id}`;
  await recordStripePaymentEvent({session, eventId:processorEventId, eventType});
  const orderNumber = session.metadata?.order_number || session.client_reference_id || "";
  const existing = await pendingStripeOrder(orderNumber);
  if (!existing) {
    const error = new Error("Stripe pending order was not found");
    error.status = 409;
    throw error;
  }
  if (existing.payment_provider !== "stripe" || existing.stripe_checkout_session_id !== session.id) {
    const error = new Error("Stripe order verification failed");
    error.status = 409;
    throw error;
  }
  if (!Array.isArray(existing.order_items) || !existing.order_items.length) {
    const error = new Error("Stripe pending order line items are incomplete");
    error.status = 409;
    throw error;
  }
  if (Number(session.amount_total || 0) !== Number(existing.total_cents || 0)) {
    const error = new Error("Stripe amount verification failed");
    error.status = 409;
    throw error;
  }
  if (recurring) {
    assertValetRecurringOrder(existing);
    const authorization = await recurringAuthorizationRecord(orderNumber);
    if (!validRecurringAuthorization(authorization, existing)) {
      throw publicError("Recurring Valet authorization record was not found", 409);
    }
    await recordValetRecurringSubscriptionBinding(existing, session);
  }

  const now = new Date().toISOString();
  const createdAt = session.created ? new Date(session.created * 1000).toISOString() : now;
  if (existing.payment_status === "Paid") {
    await sendStripeOrderEmails(existing, session, createdAt, sendRecurringEnrollmentEmails);
    return {order:existing, existing:true, recurring};
  }

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || "";
  const chargeId = latestChargeId(session.payment_intent);
  let orderRows;
  try {
    orderRows = await supabaseRequest(`orders?id=eq.${encodeURIComponent(existing.id)}`, {
      method:"PATCH",
      body:{
        payment_status:"Paid",
        payment_processor_reference:paymentIntentId || session.id,
        stripe_payment_intent_id:paymentIntentId || null,
        stripe_charge_id:chargeId || null,
        payment_at:createdAt
      }
    });
  } catch (error) {
    if (error.payload?.code === "23505" || error.message.includes("duplicate")) {
      const duplicate = await pendingStripeOrder(orderNumber);
      if (duplicate) {
        if (recurring) await sendStripeOrderEmails(duplicate, session, createdAt, sendRecurringEnrollmentEmails);
        return {order:duplicate, existing:true, recurring};
      }
    }
    throw error;
  }
  let order = orderRows?.[0];
  if (!order && recurring) {
    const concurrent = await pendingStripeOrder(orderNumber);
    if (concurrent?.payment_status !== "Paid") {
      throw publicError("Stripe recurring Valet order could not be finalized", 409);
    }
    order = concurrent;
  }
  await sendStripeOrderEmails(existing, session, createdAt, sendRecurringEnrollmentEmails);

  return {order, existing:false, recurring};
}

function invoiceSubscriptionId(invoice) {
  return stripeObjectId(invoice?.subscription)
    || stripeObjectId(invoice?.parent?.subscription_details?.subscription);
}

function invoiceNextRenewalDate(invoice) {
  const periods = (Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [])
    .map(line => Number(line?.period?.end || 0))
    .filter(value => Number.isFinite(value) && value > 0);
  if (!periods.length) return "";
  return new Date(Math.max(...periods) * 1000).toISOString();
}

async function paymentEventRecord(eventId) {
  const rows = await supabaseRequest(`payment_events?processor_event_id=eq.${encodeURIComponent(eventId)}&select=id,order_number,status,payload,processor_payment_id&limit=1`, {
    method:"GET",
    prefer:""
  });
  return Array.isArray(rows) ? rows[0] : null;
}

function recurringInvoiceEventId(invoiceId) {
  return `valet_recurring_invoice_${String(invoiceId || "")}`;
}

function invoicePaymentIntentId(invoice) {
  return stripeObjectId(invoice?.payment_intent)
    || stripeObjectId(invoice?.payments?.data?.[0]?.payment?.payment_intent);
}

function invoiceChargeId(invoice) {
  return stripeObjectId(invoice?.charge)
    || stripeObjectId(invoice?.payments?.data?.[0]?.payment?.payment_intent?.latest_charge);
}

function invoicePaidAt(invoice) {
  const paidAt = Number(invoice?.status_transitions?.paid_at || 0);
  if (!Number.isSafeInteger(paidAt) || paidAt <= 0) {
    throw publicError("Stripe recurring Valet payment date was not found", 409);
  }
  return new Date(paidAt * 1000).toISOString();
}

function minimalRenewalSnapshot(invoice, {eventId, orderNumber, subscriptionId, paymentIntentId, paidAt}) {
  return {
    invoice_id:String(invoice.id),
    stripe_event_id:String(eventId || ""),
    subscription_id:subscriptionId,
    payment_intent_id:paymentIntentId,
    original_order_number:orderNumber,
    financial_order_number:null,
    billing_reason:"subscription_cycle",
    payment_status:"paid",
    currency:"usd",
    paid_at:paidAt,
    valet_amount_cents:VALET_RECURRING_AMOUNTS.valetCents,
    processing_fee_cents:VALET_RECURRING_AMOUNTS.processingFeeCents,
    total_cents:VALET_RECURRING_AMOUNTS.totalCents,
    expected_line_items_verified:true,
    management_email_sent:false,
    processing_started_at:new Date().toISOString()
  };
}

async function claimValetRecurringInvoice(invoice, {eventId, orderNumber, subscriptionId, paymentIntentId, paidAt}) {
  const processorEventId = recurringInvoiceEventId(invoice.id);
  const claimToken = `Processing:${crypto.randomUUID()}`;
  const payload = minimalRenewalSnapshot(invoice, {eventId, orderNumber, subscriptionId, paymentIntentId, paidAt});
  try {
    const rows = await supabaseRequest("payment_events", {
      method:"POST",
      body:[{
        order_number:orderNumber,
        square_payment_id:null,
        status:claimToken,
        amount_cents:VALET_RECURRING_AMOUNTS.totalCents,
        payload,
        payment_provider:"stripe",
        processor_event_id:processorEventId,
        processor_payment_id:paymentIntentId,
        event_type:"recurring_invoice_fulfillment"
      }]
    });
    return {claimed:true, claimToken, record:rows?.[0] || {status:claimToken, payload}};
  } catch (error) {
    if (error.payload?.code !== "23505" && !error.message.includes("duplicate")) throw error;
  }

  const existing = await paymentEventRecord(processorEventId);
  if (!existing) throw publicError("Recurring Valet renewal state could not be loaded", 503);
  if (
    existing?.payload?.invoice_id !== invoice.id
    || existing?.payload?.subscription_id !== subscriptionId
    || existing?.processor_payment_id !== paymentIntentId
  ) {
    throw publicError("Stored recurring Valet renewal identity does not match", 409);
  }
  if (existing.status === "Completed") return {claimed:false, duplicate:true, record:existing};

  const processingStarted = new Date(existing?.payload?.processing_started_at || 0).getTime();
  const stale = existing.status?.startsWith("Processing:")
    && Number.isFinite(processingStarted)
    && processingStarted < Date.now() - 5 * 60 * 1000;
  if (existing.status !== "Retry Required" && !stale) {
    throw publicError("Recurring Valet renewal is already being processed", 409);
  }

  const nextPayload = {
    ...existing.payload,
    stripe_event_id:String(eventId || existing.payload.stripe_event_id || ""),
    processing_started_at:new Date().toISOString()
  };
  const rows = await supabaseRequest(
    `payment_events?processor_event_id=eq.${encodeURIComponent(processorEventId)}&status=eq.${encodeURIComponent(existing.status)}`,
    {method:"PATCH", body:{status:claimToken, payload:nextPayload}}
  );
  if (!rows?.[0]) throw publicError("Recurring Valet renewal is already being processed", 409);
  return {claimed:true, claimToken, record:rows[0]};
}

async function updateClaimedRenewalEvent(invoiceId, claimToken, body) {
  const eventId = recurringInvoiceEventId(invoiceId);
  const rows = await supabaseRequest(
    `payment_events?processor_event_id=eq.${encodeURIComponent(eventId)}&status=eq.${encodeURIComponent(claimToken)}`,
    {method:"PATCH", body}
  );
  if (!rows?.[0]) throw publicError("Recurring Valet renewal state changed unexpectedly", 409);
  return rows[0];
}

async function markRenewalRetryRequired(invoiceId, claimToken, payload) {
  try {
    await updateClaimedRenewalEvent(invoiceId, claimToken, {
      status:"Retry Required",
      payload:{...payload, processing_failed_at:new Date().toISOString()}
    });
  } catch (error) {
    console.error(`Recurring Valet retry state could not be recorded: ${error.message || "Unknown error"}`);
  }
}

async function renewalOrderByPaymentIntent(paymentIntentId) {
  const rows = await supabaseRequest(
    `orders?stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntentId)}&select=*,order_items(*)&limit=1`,
    {method:"GET", prefer:""}
  );
  return Array.isArray(rows) ? rows[0] : null;
}

function recurringRenewalReference(invoiceId, subscriptionId, enrollmentOrderNumber) {
  return `${invoiceId} | ${subscriptionId} | enrollment ${enrollmentOrderNumber}`;
}

function assertValetRecurringRenewalOrder(order, {invoiceId, subscriptionId, enrollmentOrderNumber, paymentIntentId, paidAt}) {
  assertValetRecurringOrder(order);
  const item = order?.order_items?.[0];
  if (
    order?.payment_status !== "Paid"
    || order?.payment_provider !== "stripe"
    || order?.stripe_payment_intent_id !== paymentIntentId
    || order?.payment_processor_reference !== recurringRenewalReference(invoiceId, subscriptionId, enrollmentOrderNumber)
    || new Date(order?.payment_at).getTime() !== new Date(paidAt).getTime()
    || !String(order?.internal_note || "").startsWith(`Recurring monthly Valet renewal for enrollment ${enrollmentOrderNumber};`)
    || !String(item?.internal_name_snapshot || "").endsWith(" - Recurring Monthly Renewal")
  ) throw publicError("Stored recurring Valet renewal order verification failed", 409);
}

async function createValetRecurringRenewalOrder(enrollmentOrder, details) {
  let existing = await renewalOrderByPaymentIntent(details.paymentIntentId);
  if (existing?.payment_status === "Paid") {
    assertValetRecurringRenewalOrder(existing, details);
    return {order:existing, existing:true};
  }
  if (existing && (!Array.isArray(existing.order_items) || existing.order_items.length !== 1)) {
    await deletePendingOrder(existing.id);
    existing = null;
  }

  let order = existing;
  if (!order) {
    const reference = recurringRenewalReference(details.invoiceId, details.subscriptionId, enrollmentOrder.order_number);
    const internalNote = `Recurring monthly Valet renewal for enrollment ${enrollmentOrder.order_number}; Stripe invoice ${details.invoiceId}; subscription ${details.subscriptionId}`;
    const {result:orderRows} = await insertOrderWithGeneratedNumber(orderNumber => supabaseRequest("orders", {
      method:"POST",
      body:[{
        order_number:orderNumber,
        resident_name:enrollmentOrder.resident_name,
        unit_number:enrollmentOrder.unit_number,
        email:enrollmentOrder.email,
        phone:enrollmentOrder.phone,
        subtotal_cents:VALET_RECURRING_AMOUNTS.valetCents,
        processing_fee_cents:VALET_RECURRING_AMOUNTS.processingFeeCents,
        total_cents:VALET_RECURRING_AMOUNTS.totalCents,
        status:"Received",
        public_note:"",
        internal_note:internalNote,
        payment_status:"Pending",
        square_payment_id:null,
        payment_provider:"stripe",
        payment_processor_reference:reference,
        stripe_checkout_session_id:null,
        stripe_payment_intent_id:details.paymentIntentId,
        stripe_charge_id:details.chargeId || null,
        payment_at:null,
        legal_accepted:enrollmentOrder.legal_accepted === true,
        legal_accepted_at:enrollmentOrder.legal_accepted_at,
        legal_notice_version:enrollmentOrder.legal_notice_version,
        terms_version:enrollmentOrder.terms_version,
        privacy_policy_version:enrollmentOrder.privacy_policy_version,
        created_at:details.paidAt
      }]
    }));
    order = orderRows?.[0];
    try {
      const sourceItem = enrollmentOrder.order_items[0];
      const itemRows = await supabaseRequest("order_items", {
        method:"POST",
        body:[{
          order_id:order.id,
          product_id:null,
          resident_name_snapshot:sourceItem.resident_name_snapshot,
          internal_name_snapshot:`${sourceItem.internal_name_snapshot} - Recurring Monthly Renewal`,
          gl_code_snapshot:"40033",
          quantity:1,
          unit_price_cents:VALET_RECURRING_AMOUNTS.valetCents
        }]
      });
      order.order_items = itemRows;
    } catch (error) {
      await deletePendingOrder(order?.id);
      throw error;
    }
  }

  const rows = await supabaseRequest(`orders?id=eq.${encodeURIComponent(order.id)}&payment_status=eq.Pending`, {
    method:"PATCH",
    body:{payment_status:"Paid", payment_at:details.paidAt}
  });
  const paidOrder = {...rows?.[0], order_items:order.order_items};
  assertValetRecurringRenewalOrder(paidOrder, details);
  return {order:paidOrder, existing:false};
}

async function fulfillPaidValetRecurringInvoice(invoice, {eventId, sendRenewalEmail = sendValetRecurringRenewalEmail} = {}) {
  if (invoice?.billing_reason !== "subscription_cycle") return {ignored:true, reason:"not_cycle"};
  if (!eventId) throw publicError("Stripe invoice event ID is required", 400);

  const lines = Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [];
  if (invoice?.lines?.has_more === true || !exactRecurringRenewalLineItems(lines)) return {ignored:true, reason:"unrelated_prices"};
  if (
    !String(invoice?.id || "").startsWith("in_")
    || invoice?.status !== "paid"
    || invoice?.paid !== true
    || Number(invoice?.amount_paid || 0) !== VALET_RECURRING_AMOUNTS.totalCents
    || Number(invoice?.amount_due || 0) !== VALET_RECURRING_AMOUNTS.totalCents
    || Number(invoice?.total || 0) !== VALET_RECURRING_AMOUNTS.totalCents
    || Number(invoice?.amount_remaining || 0) !== 0
    || String(invoice?.currency || "").toLowerCase() !== "usd"
    || invoice?.collection_method !== "charge_automatically"
    || Number(invoice?.pre_payment_credit_notes_amount || 0) !== 0
    || Number(invoice?.post_payment_credit_notes_amount || 0) !== 0
    || (Array.isArray(invoice?.discounts) && invoice.discounts.length > 0)
    || (Array.isArray(invoice?.total_discount_amounts) && invoice.total_discount_amounts.length > 0)
  ) {
    throw publicError("Stripe recurring Valet renewal verification failed", 409);
  }

  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) throw publicError("Stripe recurring Valet subscription was not found", 409);
  const paymentIntentId = invoicePaymentIntentId(invoice);
  if (!paymentIntentId) throw publicError("Stripe recurring Valet payment identity was not found", 409);
  const paidAt = invoicePaidAt(invoice);
  const subscription = await stripeRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const orderNumber = String(subscription?.metadata?.order_number || "");
  if (
    subscription?.id !== subscriptionId
    || !orderNumber
    || subscription?.metadata?.checkout_type !== VALET_RECURRING_CHECKOUT_TYPE
    || subscription?.metadata?.authorization_version !== VALET_RECURRING_AUTHORIZATION_VERSION
    || !exactRecurringSubscriptionItems(subscription)
  ) {
    return {ignored:true, reason:"unrelated_subscription"};
  }

  const order = await pendingStripeOrder(orderNumber);
  if (!order || order.payment_provider !== "stripe" || order.payment_status !== "Paid") {
    throw publicError("Stored recurring Valet order was not found", 409);
  }
  assertValetRecurringOrder(order);
  const authorization = await recurringAuthorizationRecord(orderNumber);
  if (!validRecurringAuthorization(authorization, order)) {
    throw publicError("Recurring Valet authorization record was not found", 409);
  }
  const binding = await recurringSubscriptionBindingRecord(orderNumber);
  if (
    binding?.processor_payment_id !== subscriptionId
    || binding?.payload?.subscription_id !== subscriptionId
    || binding?.payload?.order_number !== orderNumber
  ) throw publicError("Recurring Valet subscription binding does not match", 409);

  const claim = await claimValetRecurringInvoice(invoice, {eventId, orderNumber, subscriptionId, paymentIntentId, paidAt});
  if (!claim.claimed) return {ignored:false, duplicate:true, orderNumber:claim.record?.payload?.financial_order_number || ""};
  let statePayload = claim.record.payload;
  try {
    const renewal = await createValetRecurringRenewalOrder(order, {
      invoiceId:invoice.id,
      subscriptionId,
      enrollmentOrderNumber:orderNumber,
      paymentIntentId,
      chargeId:invoiceChargeId(invoice),
      paidAt
    });
    statePayload = {...statePayload, financial_order_number:renewal.order.order_number};
    await updateClaimedRenewalEvent(invoice.id, claim.claimToken, {payload:statePayload});
    const sent = await sendRenewalEmail({
      residentName:order.resident_name,
      unit:order.unit_number,
      renewalDate:paidAt,
      nextRenewalDate:invoiceNextRenewalDate(invoice),
      valetCents:VALET_RECURRING_AMOUNTS.valetCents,
      processingFeeCents:VALET_RECURRING_AMOUNTS.processingFeeCents,
      monthlyTotalCents:VALET_RECURRING_AMOUNTS.totalCents,
      transactionReference:renewal.order.order_number,
      invoiceId:invoice.id
    });
    if (sent !== true) throw publicError("Recurring Valet renewal notification delivery is incomplete", 502);
    statePayload = {
      ...statePayload,
      management_email_sent:true,
      management_email_sent_at:new Date().toISOString()
    };
    await updateClaimedRenewalEvent(invoice.id, claim.claimToken, {status:"Completed", payload:statePayload});
    return {ignored:false, duplicate:false, emailSent:true, order:renewal.order};
  } catch (error) {
    await markRenewalRetryRequired(invoice.id, claim.claimToken, statePayload);
    throw error;
  }
}

async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function verifyStripeSignature(rawBody, signatureHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!secret) {
    const error = new Error("Stripe webhook is not configured");
    error.status = 503;
    throw error;
  }
  const parts = Object.fromEntries(String(signatureHeader || "").split(",").map(part => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) {
    const error = new Error("Invalid Stripe signature");
    error.status = 400;
    throw error;
  }
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) {
    const error = new Error("Expired Stripe signature");
    error.status = 400;
    throw error;
  }
  const digest = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const left = Buffer.from(digest, "hex");
  const right = Buffer.from(expected, "hex");
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    const error = new Error("Invalid Stripe signature");
    error.status = 400;
    throw error;
  }
  return JSON.parse(rawBody.toString("utf8"));
}

module.exports = {
  assertValetRecurringPriceConfiguration,
  assertStripeStorageReady,
  buildTrustedCheckout,
  createCheckoutSession,
  attachStripeSessionToPendingOrder,
  createPendingStripeOrder,
  fulfillPaidValetRecurringInvoice,
  fulfillPaidStripeSession,
  recordValetRecurringAuthorization,
  readRawBody,
  retrieveCheckoutSession,
  stripeKeyConfig,
  verifyStripeSignature,
  VALET_RECURRING_AMOUNTS,
  VALET_RECURRING_AUTHORIZATION_TEXT,
  VALET_RECURRING_AUTHORIZATION_VERSION
};
