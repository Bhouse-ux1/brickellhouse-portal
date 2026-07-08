const {supabaseRequest} = require("./_supabase");
const {enforceRateLimit} = require("./_rate-limit");

function send(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return send(response, 405, {success:false,message:"Method not allowed"});
  }

  try {
    enforceRateLimit(request, {namespace:"order-status", limit:30, windowMs:10 * 60 * 1000});
  } catch (error) {
    return send(response, error.status || 429, {success:false,message:"Too many requests. Please try again later."});
  }

  const number = String(request.query?.number || "").trim().toUpperCase();
  if (!number) return send(response, 400, {success:false,message:"Order number is required"});

  try {
    const rows = await supabaseRequest(`orders?order_number=eq.${encodeURIComponent(number)}&select=order_number,status,public_note,created_at`, {
      method:"GET",
      prefer:""
    });
    const order = Array.isArray(rows) ? rows[0] : null;
    if (!order) return send(response, 404, {success:false,message:"Order not found"});
    return send(response, 200, {
      success:true,
      order:{
        number:order.order_number,
        status:order.status,
        publicNote:order.public_note || "",
        createdAt:order.created_at
      }
    });
  } catch (error) {
    return send(response, error.status || 500, {success:false,message:error.message || "Unable to look up order"});
  }
};
