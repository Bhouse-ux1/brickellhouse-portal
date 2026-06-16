const {products} = require("./_catalog");

const SQUARE_VERSION = process.env.SQUARE_API_VERSION || "2026-05-20";

function send(response, status, payload) {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

function normalizeUsPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return send(response, 405, {success:false,message:"Method not allowed"});
  }

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  const environment = process.env.SQUARE_ENVIRONMENT || "sandbox";
  if (environment !== "sandbox") {
    return send(response, 503, {success:false,message:"Live Square payments are disabled. Set SQUARE_ENVIRONMENT=sandbox."});
  }
  if (!accessToken || !locationId) {
    return send(response, 503, {success:false,message:"Square is not configured"});
  }

  const {sourceId,idempotencyKey,orderNumber,resident,items,legalAccepted,legalNoticeVersion} = request.body || {};
  if (!sourceId || !idempotencyKey || !orderNumber || !resident?.name || !resident?.unit || !resident?.email) {
    return send(response, 400, {success:false,message:"Missing required payment or resident data"});
  }
  const phone = normalizeUsPhone(resident.phone);
  if (!validEmail(resident.email)) {
    return send(response, 400, {success:false,message:"Enter a valid email address before payment"});
  }
  if (!phone) {
    return send(response, 400, {success:false,message:"Enter a valid U.S. phone number before payment"});
  }
  if (!legalAccepted || !legalNoticeVersion) {
    return send(response, 400, {success:false,message:"Legal acceptance evidence is required"});
  }
  if (!Array.isArray(items) || !items.length) {
    return send(response, 400, {success:false,message:"The order has no items"});
  }

  let subtotalCents = 0;
  const accounting = [];
  for (const item of items) {
    const product = products[item.id];
    const quantity = Number(item.quantity);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return send(response, 400, {success:false,message:"The order contains an invalid product or quantity"});
    }
    subtotalCents += product.priceCents * quantity;
    accounting.push({productId:item.id,quantity,internalName:product.internalName,glCode:product.glCode});
  }

  const feePercent = Number(process.env.PROCESSING_FEE_PERCENT || "3");
  const feeCents = Math.round(subtotalCents * feePercent / 100);
  const amountCents = subtotalCents + feeCents;
  const apiBase = "https://connect.squareupsandbox.com";

  try {
    const squareResponse = await fetch(`${apiBase}/v2/payments`, {
      method:"POST",
      headers:{
        "Authorization":`Bearer ${accessToken}`,
        "Content-Type":"application/json",
        "Square-Version":SQUARE_VERSION
      },
      body:JSON.stringify({
        source_id:sourceId,
        idempotency_key:String(idempotencyKey).slice(0, 45),
        amount_money:{amount:amountCents,currency:"USD"},
        location_id:locationId,
        reference_id:String(orderNumber).slice(0, 40),
        buyer_email_address:String(resident.email).trim().toLowerCase(),
        buyer_phone_number:phone,
        autocomplete:true
      })
    });
    const squareResult = await squareResponse.json();
    if (!squareResponse.ok || !squareResult.payment || squareResult.payment.status !== "COMPLETED") {
      const message = squareResult.errors?.map(error => error.detail || error.code).join("; ") || "Square did not complete the payment";
      return send(response, 402, {success:false,message});
    }

    const verifyResponse = await fetch(`${apiBase}/v2/payments/${encodeURIComponent(squareResult.payment.id)}`, {
      method:"GET",
      headers:{
        "Authorization":`Bearer ${accessToken}`,
        "Square-Version":SQUARE_VERSION
      }
    });
    const verifyResult = await verifyResponse.json();
    const verifiedPayment = verifyResult.payment;
    const verified = verifyResponse.ok &&
      verifiedPayment?.status === "COMPLETED" &&
      verifiedPayment?.location_id === locationId &&
      verifiedPayment?.amount_money?.currency === "USD" &&
      Number(verifiedPayment?.amount_money?.amount) === amountCents;
    if (!verified) {
      return send(response, 502, {success:false,message:"Square payment verification failed"});
    }

    return send(response, 200, {
      success:true,
      payment:{
        id:verifiedPayment.id,
        status:verifiedPayment.status,
        createdAt:verifiedPayment.created_at,
        amountCents
      },
      privateAccounting:accounting
    });
  } catch (error) {
    return send(response, 502, {success:false,message:"Unable to reach Square",detail:error.message});
  }
};
