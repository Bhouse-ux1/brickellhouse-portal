const {
  assertStripeStorageReady,
  attachStripeSessionToPendingOrder,
  buildTrustedCheckout,
  createCheckoutSession,
  createPendingStripeOrder,
  fulfillPaidStripeSession,
  readRawBody,
  retrieveCheckoutSession,
  stripeKeyConfig,
  verifyStripeSignature
} = require("./_stripe-checkout");
const {enforceRateLimit} = require("./_rate-limit");

const PUBLIC_ORDER_FAILURE_MESSAGE = "Your order could not be completed at this time. Please try again shortly or contact Management.";
const ORDER_NUMBER_EXHAUSTION_MESSAGE = "Unable to allocate an order reference. Please try again.";
const RESIDENT_SAFE_SESSION_MESSAGES = new Set([
  "Too many requests. Please try again later.",
  "Missing required checkout data",
  "Enter a valid email address before payment",
  "Enter a valid U.S. phone number before payment",
  "Legal acceptance evidence is required",
  "Cart is empty",
  "One of the selected items is no longer available",
  "Invalid quantity for one of the selected items",
  "Stripe checkout is only used for paid orders"
]);

module.exports.config = {
  api:{bodyParser:false}
};

function normalizedCheckoutProvider() {
  const provider = String(process.env.CHECKOUT_PROVIDER || "").trim().toLowerCase();
  return provider === "stripe" ? "stripe" : "square";
}

function send(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

function logOrderCreationError(action, error) {
  console.error("Order creation failed", {
    action,
    status:Number.isInteger(error?.status) ? error.status : 500,
    category:error?.payload ? "upstream" : "server",
    databaseCode:typeof error?.payload?.code === "string" ? error.payload.code : null
  });
}

function publicSessionErrorMessage(error) {
  if (error?.message === ORDER_NUMBER_EXHAUSTION_MESSAGE) return ORDER_NUMBER_EXHAUSTION_MESSAGE;
  if (!error?.payload && RESIDENT_SAFE_SESSION_MESSAGES.has(error?.message)) return error.message;
  return PUBLIC_ORDER_FAILURE_MESSAGE;
}

function safeStripeConfig() {
  const provider = normalizedCheckoutProvider();
  const keyConfig = stripeKeyConfig();
  const enabled = provider === "stripe" && keyConfig.enabled;

  return {
    enabled,
    provider,
    publishableKey:enabled ? keyConfig.publishableKey : "",
    mode:enabled ? keyConfig.mode : "",
    message:enabled || provider !== "stripe" ? "" : "Stripe checkout is not available."
  };
}

function stripeEnabled() {
  return normalizedCheckoutProvider() === "stripe";
}

function originFromRequest(request) {
  const host = request.headers["x-forwarded-host"] || request.headers.host || "localhost";
  const proto = request.headers["x-forwarded-proto"] || (String(host).includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function jsonBody(request) {
  const raw = await readRawBody(request);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return {};
  }
}

async function createSession(request, response) {
  if (!stripeEnabled()) return send(response, 403, {success:false,message:"Stripe checkout is not enabled"});
  try {
    enforceRateLimit(request, {namespace:"stripe-session", limit:5, windowMs:10 * 60 * 1000});
    await assertStripeStorageReady();
    const checkout = await buildTrustedCheckout(await jsonBody(request));
    const pendingOrder = await createPendingStripeOrder(checkout);
    const trustedCheckout = {...checkout, orderNumber:pendingOrder.order_number};
    const session = await createCheckoutSession(trustedCheckout, originFromRequest(request));
    await attachStripeSessionToPendingOrder(pendingOrder.id, session);
    return send(response, 200, {
      success:true,
      provider:"stripe",
      orderNumber:pendingOrder.order_number,
      sessionId:session.id,
      clientSecret:session.client_secret || ""
    });
  } catch (error) {
    logOrderCreationError("stripe_session_create", error);
    return send(response, error.status || 500, {
      success:false,
      message:publicSessionErrorMessage(error)
    });
  }
}

async function confirmOrder(request, response) {
  if (!stripeEnabled()) return send(response, 403, {success:false,message:"Stripe checkout is not enabled"});
  try {
    const body = await jsonBody(request);
    const session = await retrieveCheckoutSession(body.sessionId);
    const result = await fulfillPaidStripeSession(session, {
      eventId:`confirm_${session.id}`,
      eventType:"manual_confirmation"
    });
    return send(response, 200, {
      success:true,
      order:{id:result.order.id, orderNumber:result.order.order_number},
      existing:result.existing
    });
  } catch (error) {
    return send(response, error.status || 500, {
      success:false,
      message:error.status ? error.message : "Stripe order could not be confirmed"
    });
  }
}

async function webhook(request, response) {
  if (!stripeEnabled()) return send(response, 403, {received:false,message:"Stripe checkout is not enabled"});
  try {
    const rawBody = await readRawBody(request);
    const event = verifyStripeSignature(rawBody, request.headers["stripe-signature"]);

    if (event.type === "checkout.session.completed") {
      const sessionId = event.data?.object?.id;
      const session = await retrieveCheckoutSession(sessionId);
      if (session.payment_status === "paid") {
        await fulfillPaidStripeSession(session, {eventId:event.id, eventType:event.type});
      }
    }

    return send(response, 200, {received:true});
  } catch (error) {
    return send(response, error.status || 400, {
      received:false,
      message:error.status === 503 ? error.message : "Stripe webhook could not be verified"
    });
  }
}

module.exports = async function handler(request, response) {
  const action = String(request.query?.action || request.query?.mode || "config").trim().toLowerCase();
  if (request.method === "GET" && action === "config") return send(response, 200, safeStripeConfig());

  if (request.method !== "POST") {
    response.setHeader("Allow", action === "config" ? "GET" : "POST");
    return send(response, 405, {success:false,message:"Method not allowed"});
  }

  if (action === "session") return createSession(request, response);
  if (action === "confirm") return confirmOrder(request, response);
  if (action === "webhook") return webhook(request, response);
  return send(response, 404, {success:false,message:"Stripe action not found"});
};
