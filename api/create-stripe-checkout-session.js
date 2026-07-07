const {assertStripeStorageReady, attachStripeSessionToPendingOrder, buildTrustedCheckout, createCheckoutSession, createPendingStripeOrder} = require("./_stripe-checkout");

function send(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

function originFromRequest(request) {
  const host = request.headers["x-forwarded-host"] || request.headers.host || "localhost";
  const proto = request.headers["x-forwarded-proto"] || (String(host).includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return send(response, 405, {success:false,message:"Method not allowed"});
  }
  if (String(process.env.CHECKOUT_PROVIDER || "").trim().toLowerCase() !== "stripe") {
    return send(response, 403, {success:false,message:"Stripe checkout is not enabled"});
  }

  try {
    await assertStripeStorageReady();
    const checkout = await buildTrustedCheckout(request.body);
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
};
