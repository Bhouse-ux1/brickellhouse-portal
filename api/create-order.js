const {products} = require("./_catalog");
const {supabaseRequest} = require("./_supabase");

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

  const {orderNumber,resident,items,legalAccepted,legalNoticeVersion,legalAcceptedAt} = request.body || {};
  if (!orderNumber || !resident?.name || !resident?.unit || !resident?.email) {
    return send(response, 400, {success:false,message:"Missing required resident order data"});
  }
  const phone = normalizeUsPhone(resident.phone);
  if (!validEmail(resident.email)) return send(response, 400, {success:false,message:"Enter a valid email address before checkout"});
  if (!phone) return send(response, 400, {success:false,message:"Enter a valid U.S. phone number before checkout"});
  if (!legalAccepted || !legalNoticeVersion) return send(response, 400, {success:false,message:"Legal acceptance evidence is required"});
  if (!Array.isArray(items) || !items.length) return send(response, 400, {success:false,message:"The order has no items"});

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
  if (amountCents > 0) {
    return send(response, 400, {success:false,message:"Paid orders must be processed through Square payment"});
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
        payment_status:"No Payment Required",
        square_payment_id:null,
        payment_at:null,
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
        square_payment_id:null,
        status:"NO_PAYMENT_REQUIRED",
        amount_cents:0,
        payload:{reason:"zero-dollar order"}
      }]
    });
    return send(response, 200, {success:true,order:{id:order.id,orderNumber:order.order_number}});
  } catch (error) {
    return send(response, error.status || 500, {success:false,message:error.message || "Unable to save order"});
  }
};
