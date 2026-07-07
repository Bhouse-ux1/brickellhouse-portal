const {fulfillPaidStripeSession, readRawBody, retrieveCheckoutSession, verifyStripeSignature} = require("./_stripe-checkout");

function send(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return send(response, 405, {received:false,message:"Method not allowed"});
  }
  if (String(process.env.CHECKOUT_PROVIDER || "").trim().toLowerCase() !== "stripe") {
    return send(response, 403, {received:false,message:"Stripe checkout is not enabled"});
  }

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

module.exports = handler;
module.exports.config = {
  api:{bodyParser:false}
};
