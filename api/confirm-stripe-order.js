const {fulfillPaidStripeSession, retrieveCheckoutSession} = require("./_stripe-checkout");

function send(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
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
    const sessionId = request.body?.sessionId;
    const session = await retrieveCheckoutSession(sessionId);
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
};
