const {
  assertStripeStorageReady,
  attachStripeSessionToPendingOrder,
  buildTrustedCheckout,
  createCheckoutSession,
  createPendingStripeOrder,
  fulfillPaidStripeSession,
  readRawBody,
  retrieveCheckoutSession,
  verifyStripeSignature
} = require("./_stripe-checkout");

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

function safeStripeConfig() {
  const provider = normalizedCheckoutProvider();
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || "";
  const testMode = publishableKey.startsWith("pk_test_");
  const enabled = provider === "stripe" && testMode;
  const mode = publishableKey.startsWith("pk_live_")
    ? "live"
    : publishableKey.startsWith("pk_test_") ? "test" : "";

  return {
    enabled,
    provider,
    publishableKey:enabled ? publishableKey : "",
    mode:enabled ? mode : "",
    message:enabled || provider !== "stripe" ? "" : "Stripe test checkout is not available."
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
    await assertStripeStorageReady();
    const checkout = await buildTrustedCheckout(await jsonBody(request));
    const pendingOrder = await createPendingStripeOrder(checkout);
    const session = await createCheckoutSession(checkout, originFromRequest(request));
    await attachStripeSessionToPendingOrder(pendingOrder.id, session);
    return send(response, 200, {
      success:true,
      provider:"stripe",
      orderNumber:checkout.orderNumber,
      sessionId:session.id,
      clientSecret:session.client_secret || ""
    });
  } catch (error) {
    return send(response, error.status || 500, {
      success:false,
      message:error.status ? error.message : "Stripe checkout could not be started"
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
