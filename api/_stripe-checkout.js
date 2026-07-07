const crypto = require("crypto");
const {getTrustedProductCatalog} = require("./_catalog");
const {supabaseRequest} = require("./_supabase");
const {sendOrderEmails} = require("./order-emails");

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = process.env.STRIPE_API_VERSION || "2025-06-30.basil";

function normalizeUsPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function stripeSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key || !key.startsWith("sk_test_")) {
    const error = new Error("Stripe test mode is not configured");
    error.status = 503;
    throw error;
  }
  return key;
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

async function assertStripeStorageReady() {
  await supabaseRequest("orders?select=id,payment_provider,payment_processor_reference,stripe_checkout_session_id,stripe_payment_intent_id,stripe_charge_id&limit=1", {
    method:"GET",
    prefer:""
  });
  await supabaseRequest("payment_events?select=id,payment_provider,processor_event_id,processor_payment_id,event_type&limit=1", {
    method:"GET",
    prefer:""
  });
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
  const {orderNumber, resident = {}, items = [], legalAccepted, legalNoticeVersion, legalAcceptedAt} = body;
  const phone = normalizeUsPhone(resident.phone);
  const email = String(resident.email || "").trim();
  const name = String(resident.name || "").trim();
  const unit = String(resident.unit || "").trim().toUpperCase();

  if (!orderNumber || !name || !unit || !email) {
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

  const feePercent = Number(process.env.PROCESSING_FEE_PERCENT || "3");
  const processingFeeCents = Math.round(subtotalCents * feePercent / 100);
  const totalCents = subtotalCents + processingFeeCents;
  if (totalCents <= 0) {
    const error = new Error("Stripe checkout is only used for paid orders");
    error.status = 400;
    throw error;
  }

  return {
    orderNumber:String(orderNumber),
    resident:{name, unit, email, phone},
    legal:{acceptedAt:legalAcceptedAt || new Date().toISOString(), noticeVersion:String(legalNoticeVersion)},
    accounting,
    subtotalCents,
    processingFeeCents,
    totalCents
  };
}

function stripeMetadata(checkout) {
  return {
    order_number:checkout.orderNumber.slice(0, 500),
    legal_notice_version:checkout.legal.noticeVersion.slice(0, 500),
    items_json:JSON.stringify(checkout.accounting.map(item => ({id:item.productId,q:item.quantity}))).slice(0, 500),
    subtotal_cents:String(checkout.subtotalCents),
    processing_fee_cents:String(checkout.processingFeeCents),
    total_cents:String(checkout.totalCents)
  };
}

function appendMetadata(params, prefix, metadata) {
  Object.entries(metadata).forEach(([key, value]) => {
    params.append(prefix ? `${prefix}[metadata][${key}]` : `metadata[${key}]`, value);
  });
}

function appendLineItem(params, index, name, unitAmount, quantity) {
  params.append(`line_items[${index}][price_data][currency]`, "usd");
  params.append(`line_items[${index}][price_data][unit_amount]`, String(unitAmount));
  params.append(`line_items[${index}][price_data][product_data][name]`, String(name).slice(0, 255));
  params.append(`line_items[${index}][quantity]`, String(quantity));
}

async function createCheckoutSession(checkout, origin) {
  const params = new URLSearchParams();
  const metadata = stripeMetadata(checkout);
  params.append("mode", "payment");
  params.append("ui_mode", "embedded");
  params.append("client_reference_id", checkout.orderNumber.slice(0, 200));
  params.append("return_url", `${origin.replace(/\/$/, "")}/?stripe_session_id={CHECKOUT_SESSION_ID}`);
  appendMetadata(params, "", metadata);
  appendMetadata(params, "payment_intent_data", metadata);

  checkout.accounting.forEach((item, index) => appendLineItem(params, index, item.residentName, item.unitPriceCents, item.quantity));
  if (checkout.processingFeeCents > 0) {
    appendLineItem(params, checkout.accounting.length, "Processing fee", checkout.processingFeeCents, 1);
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
  return stripeRequest(`/checkout/sessions/${id}?expand[]=payment_intent`);
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

async function orderExists(orderNumber) {
  const rows = await supabaseRequest(`orders?order_number=eq.${encodeURIComponent(orderNumber)}&select=id,order_number,payment_status&limit=1`, {
    method:"GET",
    prefer:""
  });
  return Array.isArray(rows) ? rows[0] : null;
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

async function createPendingStripeOrder(checkout, session) {
  const existing = await orderExists(checkout.orderNumber);
  if (existing) {
    const error = new Error("Order number already exists");
    error.status = 409;
    throw error;
  }

  const orderRows = await supabaseRequest("orders", {
    method:"POST",
    body:[{
      order_number:checkout.orderNumber,
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
  });
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

async function fulfillPaidStripeSession(session, {eventId = null, eventType = "manual_confirmation"} = {}) {
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

  const processorEventId = `stripe_payment_${typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || session.id}`;
  await recordStripePaymentEvent({session, eventId:processorEventId, eventType});
  const orderNumber = session.metadata?.order_number || session.client_reference_id || "";
  const existing = await pendingStripeOrder(orderNumber);
  if (!existing) {
    const error = new Error("Stripe pending order was not found");
    error.status = 409;
    throw error;
  }
  if (existing.payment_status === "Paid") return {order:existing, existing:true};
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

  const now = new Date().toISOString();
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
        payment_at:session.created ? new Date(session.created * 1000).toISOString() : now
      }
    });
  } catch (error) {
    if (error.payload?.code === "23505" || error.message.includes("duplicate")) {
      const duplicate = await pendingStripeOrder(orderNumber);
      if (duplicate) return {order:duplicate, existing:true};
    }
    throw error;
  }
  const order = orderRows?.[0];

  try {
    await sendOrderEmails({
      paymentId:paymentIntentId || session.id,
      orderNumber:existing.order_number,
      residentName:existing.resident_name,
      unit:existing.unit_number,
      email:existing.email,
      phone:existing.phone,
      items:existing.order_items.map(item => ({
        name:item.resident_name_snapshot,
        quantity:item.quantity,
        unitPriceCents:item.unit_price_cents
      })),
      totalCents:existing.total_cents,
      paymentMethod:"Stripe",
      createdAt:session.created ? new Date(session.created * 1000).toISOString() : now
    });
  } catch (error) {
    console.error(`Stripe order email notification failed after successful payment: ${error.message || "Unknown error"}`);
  }

  return {order, existing:false};
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
  assertStripeStorageReady,
  buildTrustedCheckout,
  createCheckoutSession,
  attachStripeSessionToPendingOrder,
  createPendingStripeOrder,
  fulfillPaidStripeSession,
  readRawBody,
  retrieveCheckoutSession,
  verifyStripeSignature
};
