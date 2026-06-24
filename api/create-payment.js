const {products} = require("./_catalog");
const {supabaseRequest, assertSupabaseStorageReady} = require("./_supabase");
const {sendOrderEmails} = require("./order-emails");

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

function squareItemName(product) {
  return `${product.name} | GL: ${product.glCode}`.slice(0, 255);
}

function paymentNote(accounting) {
  return accounting
    .map(item => `${products[item.productId].name} | GL: ${item.glCode}${item.quantity > 1 ? ` x${item.quantity}` : ""}`)
    .join("; ")
    .slice(0, 500);
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return send(response, 405, {success:false,message:"Method not allowed"});
  }

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  const environment = (process.env.SQUARE_ENVIRONMENT || "sandbox").toLowerCase();
  if (environment !== "sandbox" && environment !== "production") {
    return send(response, 503, {success:false,message:"Square environment must be sandbox or production."});
  }
  if (!accessToken || !locationId) {
    return send(response, 503, {success:false,message:"Square is not configured"});
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return send(response, 503, {success:false,message:"Supabase order storage is not configured"});
  }

  const {sourceId,idempotencyKey,orderNumber,resident,items,legalAccepted,legalNoticeVersion,legalAcceptedAt} = request.body || {};
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
  const apiBase = environment === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
  let verifiedPayment = null;
  let squareOrder = null;

  try {
    await assertSupabaseStorageReady();
  } catch (error) {
    return send(response, error.status || 503, {
      success:false,
      message:`Supabase order storage is not ready: ${error.message}. No Square payment was attempted.`,
      detail:error.message
    });
  }

  try {
    const squareOrderResponse = await fetch(`${apiBase}/v2/orders`, {
      method:"POST",
      headers:{
        "Authorization":`Bearer ${accessToken}`,
        "Content-Type":"application/json",
        "Square-Version":SQUARE_VERSION
      },
      body:JSON.stringify({
        idempotency_key:`${String(idempotencyKey).slice(0, 32)}-order`,
        order:{
          location_id:locationId,
          reference_id:String(orderNumber).slice(0, 40),
          line_items:[
            ...accounting.map(item => ({
              name:squareItemName(products[item.productId]),
              quantity:String(item.quantity),
              base_price_money:{amount:products[item.productId].priceCents,currency:"USD"}
            })),
            ...(feeCents > 0 ? [{
              name:"Processing fee",
              quantity:"1",
              base_price_money:{amount:feeCents,currency:"USD"}
            }] : [])
          ]
        }
      })
    });
    const squareOrderResult = await squareOrderResponse.json();
    if (!squareOrderResponse.ok || !squareOrderResult.order?.id) {
      const message = squareOrderResult.errors?.map(error => error.detail || error.code).join("; ") || "Square could not create the itemized order";
      return send(response, 402, {success:false,message});
    }
    squareOrder = squareOrderResult.order;

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
        order_id:squareOrder.id,
        reference_id:String(orderNumber).slice(0, 40),
        note:paymentNote(accounting),
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
    verifiedPayment = verifyResult.payment;
    const verified = verifyResponse.ok &&
      verifiedPayment?.status === "COMPLETED" &&
      verifiedPayment?.location_id === locationId &&
      verifiedPayment?.amount_money?.currency === "USD" &&
      Number(verifiedPayment?.amount_money?.amount) === amountCents &&
      verifiedPayment?.order_id === squareOrder.id;
    if (!verified) {
      return send(response, 502, {success:false,message:"Square payment verification failed"});
    }
  } catch (error) {
    return send(response, 502, {success:false,message:"Unable to reach Square",detail:error.message});
  }

  try {
    const now = new Date().toISOString();
    const orderRows = await supabaseRequest("orders", {
      method:"POST",
      body:[{
        order_number:String(orderNumber),
        resident_name:String(resident.name).trim(),
        unit_number:String(resident.unit).trim(),
        email:String(resident.email).trim().toLowerCase(),
        phone,
        subtotal_cents:subtotalCents,
        processing_fee_cents:feeCents,
        total_cents:amountCents,
        status:"Received",
        payment_status:"Paid",
        square_payment_id:verifiedPayment.id,
        payment_at:verifiedPayment.created_at || now,
        legal_accepted:true,
        legal_accepted_at:legalAcceptedAt || now,
        legal_notice_version:String(legalNoticeVersion),
        terms_version:null,
        privacy_policy_version:null
      }]
    });
    const order = Array.isArray(orderRows) ? orderRows[0] : orderRows;
    await supabaseRequest("order_items", {
      method:"POST",
      body:accounting.map(item => ({
        order_id:order.id,
        product_id:null,
        resident_name_snapshot:products[item.productId].name,
        internal_name_snapshot:item.internalName,
        gl_code_snapshot:item.glCode,
        quantity:item.quantity,
        unit_price_cents:products[item.productId].priceCents
      }))
    });
    await supabaseRequest("payment_events", {
      method:"POST",
      body:[{
        order_number:String(orderNumber),
        square_payment_id:verifiedPayment.id,
        status:"COMPLETED",
        amount_cents:amountCents,
        payload:{payment:verifiedPayment}
      }]
    });

    const walletType = verifiedPayment.card_details?.card?.digital_wallet_type;
    const paymentMethod = walletType === "APPLE_PAY"
      ? "Apple Pay"
      : verifiedPayment.source_type === "CARD" ? "Credit/debit card" : verifiedPayment.source_type || "Square";
    try {
      await sendOrderEmails({
        paymentId:verifiedPayment.id,
        orderNumber:String(orderNumber),
        residentName:String(resident.name).trim(),
        unit:String(resident.unit).trim(),
        email:String(resident.email).trim().toLowerCase(),
        phone,
        items:accounting.map(item => ({
          name:products[item.productId].name,
          quantity:item.quantity,
          unitPriceCents:products[item.productId].priceCents
        })),
        totalCents:amountCents,
        paymentMethod,
        createdAt:verifiedPayment.created_at || now
      });
    } catch (error) {
      console.error(`Order email notification failed after successful payment: ${error.message || "Unknown error"}`);
    }

    return send(response, 200, {
      success:true,
      order:{id:order.id, orderNumber:order.order_number},
      payment:{
        id:verifiedPayment.id,
        status:verifiedPayment.status,
        createdAt:verifiedPayment.created_at,
        amountCents
      },
      privateAccounting:accounting
    });
  } catch (error) {
    return send(response, error.status || 500, {
      success:false,
      message:"Square payment succeeded, but the order could not be saved to Supabase. Please contact management with the Square payment ID.",
      payment:{id:verifiedPayment?.id || "", status:verifiedPayment?.status || ""},
      detail:error.message
    });
  }
};
