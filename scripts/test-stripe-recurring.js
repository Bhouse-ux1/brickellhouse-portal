const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {Readable} = require("stream");

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.CHECKOUT_PROVIDER = "stripe";
process.env.STRIPE_MODE = "live";
process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_offline_fixture";
process.env.STRIPE_SECRET_KEY = "sk_live_offline_fixture";
process.env.STRIPE_VALET_MONTHLY_PRICE_ID = "price_offline_valet_monthly";
process.env.STRIPE_VALET_MONTHLY_PROCESSING_FEE_PRICE_ID = "price_offline_valet_fee_monthly";

const {
  assertValetRecurringPriceConfiguration,
  buildTrustedCheckout,
  createCheckoutSession,
  fulfillPaidStripeSession,
  fulfillPaidValetRecurringInvoice,
  recordValetRecurringAuthorization,
  VALET_RECURRING_AMOUNTS,
  VALET_RECURRING_AUTHORIZATION_TEXT,
  VALET_RECURRING_AUTHORIZATION_VERSION
} = require("../api/_stripe-checkout");
const {
  buildValetRecurringResidentEmail,
  buildValetRecurringManagementEmail,
  buildValetRecurringRenewalEmail,
  sendValetRecurringRenewalEmail,
  MANAGEMENT_RECIPIENT
} = require("../api/order-emails");
const {
  validateReportPeriod,
  buildFinancialReportModel,
  generateFinancialReportPdf
} = require("../server/financial-report");
const stripeHandler = require("../api/stripe");

const PRICE_IDS = Object.freeze({
  valet:"price_offline_valet_monthly",
  processingFee:"price_offline_valet_fee_monthly"
});
const resident = {name:"Offline Resident",unit:"2504",email:"resident@example.com",phone:"3055550100"};
const legal = {legalAccepted:true,legalNoticeVersion:"offline-legal",legalAcceptedAt:"2026-07-22T12:00:00.000Z"};
let assertions = 0;

function check(value, message) {
  assertions += 1;
  assert(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.strictEqual(actual, expected, message);
}

async function rejects(action, pattern) {
  assertions += 1;
  await assert.rejects(action, pattern);
}

function response(payload, status = 200) {
  const serialized = payload == null ? "" : JSON.stringify(payload);
  return {
    ok:status >= 200 && status < 300,
    status,
    json:async () => payload,
    text:async () => serialized
  };
}

function recurringPrice(id, unitAmount, overrides = {}) {
  const base = {
    id,
    active:true,
    type:"recurring",
    currency:"usd",
    unit_amount:unitAmount,
    billing_scheme:"per_unit",
    transform_quantity:null,
    tiers:null,
    tiers_mode:null,
    recurring:{interval:"month",interval_count:1,usage_type:"licensed"}
  };
  return {...base, ...overrides, recurring:{...base.recurring, ...(overrides.recurring || {})}};
}

function subscriptionFixture(orderNumber = "BH-ENROL", subscriptionId = "sub_offline_valet") {
  return {
    id:subscriptionId,
    metadata:{
      order_number:orderNumber,
      checkout_type:"valet_recurring",
      authorization_version:VALET_RECURRING_AUTHORIZATION_VERSION
    },
    items:{data:[
      {price:{id:PRICE_IDS.valet},quantity:1},
      {price:{id:PRICE_IDS.processingFee},quantity:1}
    ]}
  };
}

function invoiceFixture({
  invoiceId = "in_offline_august",
  eventPaymentIntent = "pi_live_offline_august",
  subscriptionId = "sub_offline_valet",
  paidAt = 1787371200,
  billingReason = "subscription_cycle",
  overrides = {}
} = {}) {
  const invoice = {
    id:invoiceId,
    billing_reason:billingReason,
    status:"paid",
    paid:true,
    amount_due:25755,
    amount_paid:25755,
    amount_remaining:0,
    total:25755,
    currency:"usd",
    collection_method:"charge_automatically",
    pre_payment_credit_notes_amount:0,
    post_payment_credit_notes_amount:0,
    total_discount_amounts:[],
    payment_intent:eventPaymentIntent,
    subscription:subscriptionId,
    status_transitions:{paid_at:paidAt},
    lines:{data:[
      {price:{id:PRICE_IDS.valet},quantity:1,amount:25000,currency:"usd",proration:false,discount_amounts:[],period:{end:paidAt + 2592000}},
      {price:{id:PRICE_IDS.processingFee},quantity:1,amount:755,currency:"usd",proration:false,discount_amounts:[],period:{end:paidAt + 2592000}}
    ]}
  };
  return {...invoice, ...overrides};
}

function authorizationPayload() {
  return {
    recurring_selected:true,
    authorization_accepted:true,
    authorization_version:VALET_RECURRING_AUTHORIZATION_VERSION,
    authorization_text:VALET_RECURRING_AUTHORIZATION_TEXT,
    authorization_timestamp:"2026-07-22T12:00:00.000Z",
    resident:resident.name,
    email:resident.email,
    unit:resident.unit,
    valet_amount_cents:25000,
    processing_fee_cents:755,
    monthly_total_cents:25755
  };
}

function enrollmentOrder({paid = true} = {}) {
  return {
    id:"order-enrollment",
    order_number:"BH-ENROL",
    resident_name:resident.name,
    unit_number:resident.unit,
    email:resident.email,
    phone:"+13055550100",
    subtotal_cents:25000,
    processing_fee_cents:755,
    total_cents:25755,
    status:"Received",
    public_note:"",
    internal_note:"",
    payment_provider:"stripe",
    payment_status:paid ? "Paid" : "Pending",
    payment_processor_reference:"pi_live_offline_enrollment",
    stripe_checkout_session_id:"cs_live_offline_enrollment",
    stripe_payment_intent_id:"pi_live_offline_enrollment",
    stripe_charge_id:"ch_live_offline_enrollment",
    payment_at:paid ? "2026-07-22T12:00:00.000Z" : null,
    legal_accepted:true,
    legal_accepted_at:legal.legalAcceptedAt,
    legal_notice_version:legal.legalNoticeVersion,
    terms_version:null,
    privacy_policy_version:null,
    created_at:"2026-07-22T12:00:00.000Z",
    order_items:[{
      id:"item-enrollment",
      order_id:"order-enrollment",
      resident_name_snapshot:"Valet Service Subscription",
      internal_name_snapshot:"Valet Service Subscription GL-40033",
      gl_code_snapshot:"40033",
      quantity:1,
      unit_price_cents:25000,
      created_at:"2026-07-22T12:00:00.000Z"
    }]
  };
}

function stateWithEnrollment({paid = true, binding = true} = {}) {
  const order = enrollmentOrder({paid});
  const events = [{
    id:"event-authorization",
    order_number:order.order_number,
    status:"Authorized",
    amount_cents:25755,
    payload:authorizationPayload(),
    payment_provider:"stripe",
    processor_event_id:`valet_recurring_authorization_${order.order_number}`,
    processor_payment_id:null,
    event_type:"recurring_authorization"
  }];
  if (binding) {
    events.push({
      id:"event-binding",
      order_number:order.order_number,
      status:"Verified",
      amount_cents:25755,
      payload:{
        order_number:order.order_number,
        authorization_event_id:`valet_recurring_authorization_${order.order_number}`,
        subscription_id:"sub_offline_valet",
        checkout_session_id:"cs_live_offline_enrollment",
        verified_at:"2026-07-22T12:01:00.000Z"
      },
      payment_provider:"stripe",
      processor_event_id:`valet_recurring_subscription_${order.order_number}`,
      processor_payment_id:"sub_offline_valet",
      event_type:"recurring_subscription_binding"
    });
  }
  return {
    orders:[order],
    items:[...order.order_items],
    events,
    subscriptions:new Map([["sub_offline_valet", subscriptionFixture()]]),
    prices:new Map([
      [PRICE_IDS.valet, recurringPrice(PRICE_IDS.valet, 25000)],
      [PRICE_IDS.processingFee, recurringPrice(PRICE_IDS.processingFee, 755)]
    ]),
    sessionBody:"",
    sequence:1,
    failOrderInsert:0,
    failFinancialStatePatch:0,
    failCompletionPatch:0
  };
}

function withOrderItems(state, order) {
  return {...order, order_items:state.items.filter(item => item.order_id === order.id)};
}

function installOfflineFetch(state) {
  global.fetch = async (url, options = {}) => {
    const target = new URL(String(url));
    const method = String(options.method || "GET").toUpperCase();
    if (target.hostname === "api.stripe.com") {
      if (target.pathname.startsWith("/v1/prices/")) {
        const id = decodeURIComponent(target.pathname.split("/").pop());
        return response(state.prices.get(id) || {error:{message:"Missing offline Price fixture"}}, state.prices.has(id) ? 200 : 404);
      }
      if (target.pathname.startsWith("/v1/subscriptions/")) {
        const id = decodeURIComponent(target.pathname.split("/").pop());
        return response(state.subscriptions.get(id) || {error:{message:"Missing offline subscription fixture"}}, state.subscriptions.has(id) ? 200 : 404);
      }
      if (target.pathname === "/v1/checkout/sessions" && method === "POST") {
        state.sessionBody = String(options.body || "");
        return response({id:"cs_live_offline_created",client_secret:"offline_secret"});
      }
      throw new Error(`Unexpected offline Stripe request: ${method} ${target.pathname}`);
    }

    if (!target.pathname.startsWith("/rest/v1/")) throw new Error(`External request escaped offline fixture: ${target}`);
    const table = target.pathname.slice("/rest/v1/".length);
    const body = options.body ? JSON.parse(options.body) : null;

    if (table === "orders") {
      if (method === "POST") {
        if (state.failOrderInsert > 0) {
          state.failOrderInsert -= 1;
          return response({code:"OFFLINE_WRITE_FAILURE",message:"Injected order write failure"}, 500);
        }
        const candidate = body[0];
        if (state.orders.some(order => order.order_number === candidate.order_number || (candidate.stripe_payment_intent_id && order.stripe_payment_intent_id === candidate.stripe_payment_intent_id))) {
          return response({code:"23505",message:"duplicate order identity"}, 409);
        }
        const created = {...candidate,id:`order-${++state.sequence}`,created_at:candidate.created_at || new Date().toISOString()};
        state.orders.push(created);
        return response([created]);
      }
    }

    if (table === "order_items" && method === "POST") {
      const created = body.map(item => ({...item,id:`item-${++state.sequence}`,created_at:new Date().toISOString()}));
      state.items.push(...created);
      return response(created);
    }

    if (table === "payment_events") {
      if (method === "POST") {
        const candidate = body[0];
        if (state.events.some(event => event.processor_event_id === candidate.processor_event_id)) {
          return response({code:"23505",message:"duplicate event identity"}, 409);
        }
        const created = {...candidate,id:`event-${++state.sequence}`,created_at:new Date().toISOString()};
        state.events.push(created);
        return response([created]);
      }
    }

    if (table === "orders" && method === "GET") {
      let rows = state.orders;
      if (target.searchParams.has("order_number")) rows = rows.filter(order => order.order_number === target.searchParams.get("order_number").replace(/^eq\./, ""));
      if (target.searchParams.has("stripe_payment_intent_id")) rows = rows.filter(order => order.stripe_payment_intent_id === target.searchParams.get("stripe_payment_intent_id").replace(/^eq\./, ""));
      return response(rows.map(order => withOrderItems(state, order)));
    }

    if (table === "orders" && method === "PATCH") {
      let rows = state.orders;
      if (target.searchParams.has("id")) rows = rows.filter(order => order.id === target.searchParams.get("id").replace(/^eq\./, ""));
      if (target.searchParams.has("payment_status")) rows = rows.filter(order => order.payment_status === target.searchParams.get("payment_status").replace(/^eq\./, ""));
      rows.forEach(order => Object.assign(order, body));
      return response(rows.map(order => ({...order})));
    }

    if (table === "orders" && method === "DELETE") {
      const id = target.searchParams.get("id")?.replace(/^eq\./, "");
      const index = state.orders.findIndex(order => order.id === id && order.payment_status === "Pending");
      if (index >= 0) state.orders.splice(index, 1);
      return response(null, 204);
    }

    if (table === "payment_events" && method === "GET") {
      const eventId = target.searchParams.get("processor_event_id")?.replace(/^eq\./, "");
      return response(state.events.filter(event => !eventId || event.processor_event_id === eventId).map(event => structuredClone(event)));
    }

    if (table === "payment_events" && method === "PATCH") {
      const eventId = target.searchParams.get("processor_event_id")?.replace(/^eq\./, "");
      const expectedStatus = target.searchParams.get("status")?.replace(/^eq\./, "");
      const event = state.events.find(candidate => candidate.processor_event_id === eventId && (!expectedStatus || candidate.status === expectedStatus));
      if (!event) return response([]);
      if (state.failFinancialStatePatch > 0 && body.payload && body.status === undefined && body.payload.financial_order_number) {
        state.failFinancialStatePatch -= 1;
        return response({code:"OFFLINE_STATE_FAILURE",message:"Injected financial state failure"}, 500);
      }
      if (state.failCompletionPatch > 0 && body.status === "Completed") {
        state.failCompletionPatch -= 1;
        return response({code:"OFFLINE_COMPLETION_FAILURE",message:"Injected completion failure"}, 500);
      }
      Object.assign(event, body);
      return response([structuredClone(event)]);
    }

    throw new Error(`Unexpected offline Supabase request: ${method} ${target.pathname}${target.search}`);
  };
}

function emailOrder() {
  return {
    paymentId:"pi_live_offline_enrollment",
    orderNumber:"BH-ENROL",
    residentName:resident.name,
    unit:resident.unit,
    email:resident.email,
    phone:"+13055550100",
    items:[{name:"Valet Parking",quantity:1,unitPriceCents:25000}],
    managementItems:[{name:"Valet Service Subscription GL-40033",quantity:1,unitPriceCents:25000}],
    subtotalCents:25000,
    processingFeeCents:755,
    totalCents:25755,
    paymentMethod:"Stripe",
    createdAt:"2026-07-22T12:00:00.000Z"
  };
}

async function eligibilityTests() {
  const valid = await buildTrustedCheckout({resident,items:[{id:"svc13",quantity:1}],paymentOption:"recurring",recurringAuthorizationAccepted:true,...legal});
  equal(valid.checkoutType, "valet_recurring");
  equal(valid.processingFeeCents, 755);
  equal(valid.totalCents, 25755);
  equal(valid.recurring.authorizationVersion, VALET_RECURRING_AUTHORIZATION_VERSION);
  check(VALET_RECURRING_AUTHORIZATION_TEXT.includes("$257.55 each month"));
  await rejects(() => buildTrustedCheckout({resident,items:[{id:"svc13",quantity:2}],paymentOption:"recurring",recurringAuthorizationAccepted:true,...legal}), /only available/);
  await rejects(() => buildTrustedCheckout({resident,items:[{id:"svc13",quantity:1},{id:"svc1",quantity:1}],paymentOption:"recurring",recurringAuthorizationAccepted:true,...legal}), /only available/);
  await rejects(() => buildTrustedCheckout({resident,items:[{id:"svc1",quantity:1}],paymentOption:"recurring",recurringAuthorizationAccepted:true,...legal}), /only available/);
  await rejects(() => buildTrustedCheckout({resident,items:[{id:"svc13",quantity:1}],paymentOption:"recurring",...legal}), /acknowledge/);
  await rejects(() => buildTrustedCheckout({resident,items:[{id:"svc13",quantity:1}],paymentOption:"recurring",recurringAuthorizationAccepted:false,...legal}), /acknowledge/);
  const oneTime = await buildTrustedCheckout({resident,items:[{id:"svc13",quantity:1}],...legal});
  equal(oneTime.checkoutType, "one_time");
  equal(oneTime.processingFeeCents, 755);
  return {valid, oneTime};
}

async function priceAndSessionTests(valid, oneTime) {
  const originalValet = process.env.STRIPE_VALET_MONTHLY_PRICE_ID;
  const originalFee = process.env.STRIPE_VALET_MONTHLY_PROCESSING_FEE_PRICE_ID;
  delete process.env.STRIPE_VALET_MONTHLY_PRICE_ID;
  await rejects(assertValetRecurringPriceConfiguration, /not configured/);
  process.env.STRIPE_VALET_MONTHLY_PRICE_ID = originalValet;
  delete process.env.STRIPE_VALET_MONTHLY_PROCESSING_FEE_PRICE_ID;
  await rejects(assertValetRecurringPriceConfiguration, /not configured/);
  process.env.STRIPE_VALET_MONTHLY_PROCESSING_FEE_PRICE_ID = originalFee;

  const cases = [
    ["wrong amount", {unit_amount:756}],
    ["inactive", {active:false}],
    ["wrong currency", {currency:"eur"}],
    ["wrong interval", {recurring:{interval:"year"}}],
    ["wrong interval count", {recurring:{interval_count:2}}],
    ["tiered", {tiers_mode:"graduated"}],
    ["metered", {recurring:{usage_type:"metered"}}],
    ["transform quantity", {transform_quantity:{divide_by:2,round:"up"}}],
    ["non per unit", {billing_scheme:"tiered"}]
  ];
  for (const [, override] of cases) {
    const state = stateWithEnrollment();
    state.prices.set(PRICE_IDS.processingFee, recurringPrice(PRICE_IDS.processingFee, 755, override));
    installOfflineFetch(state);
    await rejects(assertValetRecurringPriceConfiguration, /does not match/);
  }
  process.env.STRIPE_VALET_MONTHLY_PROCESSING_FEE_PRICE_ID = PRICE_IDS.valet;
  await rejects(assertValetRecurringPriceConfiguration, /not configured/);
  process.env.STRIPE_VALET_MONTHLY_PROCESSING_FEE_PRICE_ID = originalFee;

  const state = stateWithEnrollment();
  installOfflineFetch(state);
  await createCheckoutSession({...valid,orderNumber:"BH-OFF01"}, "https://portal.example");
  const recurringParams = new URLSearchParams(state.sessionBody);
  equal(recurringParams.get("mode"), "subscription");
  equal(recurringParams.get("line_items[0][price]"), PRICE_IDS.valet);
  equal(recurringParams.get("line_items[1][price]"), PRICE_IDS.processingFee);
  equal(recurringParams.get("line_items[0][quantity]"), "1");
  equal(recurringParams.get("line_items[1][quantity]"), "1");
  equal(recurringParams.get("return_url"), "https://portal.example/checkout.html?stripe_session_id={CHECKOUT_SESSION_ID}");
  check(!state.sessionBody.includes("price_data"), "Recurring Session must not use dynamic price_data");

  state.sessionBody = "";
  await createCheckoutSession({...oneTime,orderNumber:"BH-OFF02"}, "https://portal.example");
  const oneTimeParams = new URLSearchParams(state.sessionBody);
  equal(oneTimeParams.get("mode"), "payment");
  equal(oneTimeParams.get("line_items[0][price_data][unit_amount]"), "25000");
  equal(oneTimeParams.get("line_items[1][price_data][unit_amount]"), "755");
  equal(oneTimeParams.get("return_url"), "https://portal.example/?stripe_session_id={CHECKOUT_SESSION_ID}");
}

async function initialFulfillmentTests(valid) {
  process.env.SUPABASE_URL = "https://offline.supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "offline-service-role-fixture";
  const state = stateWithEnrollment({paid:false,binding:false});
  state.events = [];
  installOfflineFetch(state);
  await recordValetRecurringAuthorization(state.orders[0], valid);
  const originalEvidence = structuredClone(state.events[0].payload);
  const session = {
    id:"cs_live_offline_enrollment",
    mode:"subscription",
    payment_status:"paid",
    status:"complete",
    amount_total:25755,
    currency:"usd",
    created:1784721600,
    client_reference_id:"BH-ENROL",
    payment_intent:{id:"pi_live_offline_enrollment",latest_charge:"ch_live_offline_enrollment"},
    subscription:{id:"sub_offline_valet"},
    metadata:{
      order_number:"BH-ENROL",
      checkout_type:"valet_recurring",
      authorization_version:VALET_RECURRING_AUTHORIZATION_VERSION,
      authorization_timestamp:originalEvidence.authorization_timestamp
    },
    line_items:{data:[
      {price:{id:PRICE_IDS.valet},quantity:1},
      {price:{id:PRICE_IDS.processingFee},quantity:1}
    ]}
  };
  let enrollmentCalls = 0;
  const sendEnrollment = async () => {
    enrollmentCalls += 1;
    return {resident:true,management:true,skipped:false};
  };
  const result = await fulfillPaidStripeSession(session, {eventId:"evt_live_offline_initial",eventType:"checkout.session.completed",sendRecurringEnrollmentEmails:sendEnrollment});
  equal(result.recurring, true);
  equal(state.orders[0].payment_status, "Paid");
  equal(enrollmentCalls, 1);
  const binding = state.events.find(event => event.event_type === "recurring_subscription_binding");
  equal(binding.processor_payment_id, "sub_offline_valet");
  equal(binding.payload.checkout_session_id, session.id);
  assert.deepStrictEqual(state.events.find(event => event.event_type === "recurring_authorization").payload, originalEvidence);
  assertions += 1;
  const notification = state.events.find(event => event.event_type === "recurring_enrollment_notification");
  equal(notification.status, "Sent");
  equal(notification.payload.resident_email_sent, true);
  equal(notification.payload.management_email_sent, true);

  await fulfillPaidStripeSession(session, {eventId:"evt_live_offline_initial_retry",eventType:"checkout.session.completed",sendRecurringEnrollmentEmails:sendEnrollment});
  equal(enrollmentCalls, 1);

  const failedState = stateWithEnrollment({paid:false,binding:false});
  failedState.events = [];
  installOfflineFetch(failedState);
  await recordValetRecurringAuthorization(failedState.orders[0], valid);
  await rejects(() => fulfillPaidStripeSession({...session,subscription:null}, {sendRecurringEnrollmentEmails:sendEnrollment}), /verification failed/);
}

async function validRenewal(state, invoice, eventId, sender) {
  installOfflineFetch(state);
  return fulfillPaidValetRecurringInvoice(invoice, {eventId,sendRenewalEmail:sender});
}

function renewalOrders(state) {
  return state.orders.filter(order => String(order.internal_note || "").startsWith("Recurring monthly Valet renewal"));
}

async function renewalClassificationAndIdempotencyTests() {
  const state = stateWithEnrollment();
  let emailCalls = 0;
  const sender = async renewal => {
    emailCalls += 1;
    equal(renewal.invoiceId, "in_offline_august");
    equal(renewal.transactionReference.startsWith("BH-"), true);
    return true;
  };
  const invoice = invoiceFixture();
  const first = await validRenewal(state, invoice, "evt_live_offline_a", sender);
  equal(first.emailSent, true);
  equal(renewalOrders(state).length, 1);
  const renewal = renewalOrders(state)[0];
  equal(renewal.subtotal_cents, 25000);
  equal(renewal.processing_fee_cents, 755);
  equal(renewal.total_cents, 25755);
  equal(renewal.payment_at, new Date(invoice.status_transitions.paid_at * 1000).toISOString());
  equal(renewal.created_at, renewal.payment_at);
  equal(state.items.find(item => item.order_id === renewal.id).gl_code_snapshot, "40033");
  const second = await validRenewal(state, invoice, "evt_live_offline_b", sender);
  equal(second.duplicate, true);
  equal(renewalOrders(state).length, 1);
  equal(emailCalls, 1);
  const fulfillment = state.events.find(event => event.event_type === "recurring_invoice_fulfillment");
  equal(fulfillment.payload.invoice_id, invoice.id);
  equal(fulfillment.status, "Completed");
  check(!Object.hasOwn(fulfillment.payload, "lines"), "Raw invoice lines must not be stored");

  const ignoredInitial = await validRenewal(state, invoiceFixture({billingReason:"subscription_create"}), "evt_live_offline_initial_invoice", sender);
  equal(ignoredInitial.reason, "not_cycle");
  const ignoredUpdate = await validRenewal(state, invoiceFixture({billingReason:"subscription_update"}), "evt_live_offline_update", sender);
  equal(ignoredUpdate.reason, "not_cycle");
  const ignoredManual = await validRenewal(state, invoiceFixture({billingReason:"manual"}), "evt_live_offline_manual", sender);
  equal(ignoredManual.reason, "not_cycle");

  const invalidCases = [
    {name:"open", overrides:{status:"open",paid:false}},
    {name:"incorrect total", overrides:{amount_paid:25000}},
    {name:"discount", overrides:{total_discount_amounts:[{amount:100}]}},
    {name:"credit", overrides:{pre_payment_credit_notes_amount:100}}
  ];
  for (const candidate of invalidCases) {
    const invalidState = stateWithEnrollment();
    await rejects(() => validRenewal(invalidState, invoiceFixture({invoiceId:`in_offline_${candidate.name.replace(/ /g, "_")}`,eventPaymentIntent:`pi_live_offline_${candidate.name.replace(/ /g, "_")}`,overrides:candidate.overrides}), `evt_live_offline_${candidate.name}`, sender), /verification failed/);
    equal(renewalOrders(invalidState).length, 0);
  }

  const lineCases = [
    lines => lines.slice(0, 1),
    lines => [...lines,{price:{id:"price_offline_unexpected"},quantity:1,amount:1,currency:"usd"}],
    lines => lines.map((line, index) => index ? {...line,quantity:2} : line),
    lines => lines.map((line, index) => index ? {...line,proration:true} : line),
    lines => lines.map((line, index) => index ? {...line,amount:754} : line)
  ];
  for (let index = 0; index < lineCases.length; index += 1) {
    const lineState = stateWithEnrollment();
    const base = invoiceFixture({invoiceId:`in_offline_lines_${index}`,eventPaymentIntent:`pi_live_offline_lines_${index}`});
    base.lines.data = lineCases[index](base.lines.data);
    const result = await validRenewal(lineState, base, `evt_live_offline_lines_${index}`, sender);
    equal(result.reason, "unrelated_prices");
    equal(renewalOrders(lineState).length, 0);
  }

  const unrelatedState = stateWithEnrollment();
  unrelatedState.subscriptions.set("sub_offline_unrelated", subscriptionFixture("BH-OTHER", "sub_offline_unrelated"));
  await rejects(() => validRenewal(unrelatedState, invoiceFixture({invoiceId:"in_offline_unrelated",eventPaymentIntent:"pi_live_offline_unrelated",subscriptionId:"sub_offline_unrelated"}), "evt_live_offline_unrelated", sender), /order was not found/);
  equal(renewalOrders(unrelatedState).length, 0);

  const bindingState = stateWithEnrollment();
  bindingState.events.find(event => event.event_type === "recurring_subscription_binding").processor_payment_id = "sub_offline_other";
  await rejects(() => validRenewal(bindingState, invoiceFixture({invoiceId:"in_offline_binding",eventPaymentIntent:"pi_live_offline_binding"}), "evt_live_offline_binding", sender), /binding does not match/);
}

async function concurrencyAndRetryTests() {
  const concurrentState = stateWithEnrollment();
  const invoice = invoiceFixture({invoiceId:"in_offline_concurrent",eventPaymentIntent:"pi_live_offline_concurrent"});
  let concurrentEmails = 0;
  const slowSender = async () => {
    concurrentEmails += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return true;
  };
  installOfflineFetch(concurrentState);
  const settled = await Promise.allSettled([
    fulfillPaidValetRecurringInvoice(invoice, {eventId:"evt_live_offline_concurrent_a",sendRenewalEmail:slowSender}),
    fulfillPaidValetRecurringInvoice(invoice, {eventId:"evt_live_offline_concurrent_b",sendRenewalEmail:slowSender})
  ]);
  equal(settled.filter(result => result.status === "fulfilled").length, 1);
  equal(settled.filter(result => result.status === "rejected").length, 1);
  equal(renewalOrders(concurrentState).length, 1);
  equal(concurrentEmails, 1);

  const writeFailureState = stateWithEnrollment();
  writeFailureState.failOrderInsert = 1;
  let writeFailureEmails = 0;
  await rejects(() => validRenewal(writeFailureState, invoiceFixture({invoiceId:"in_offline_write_retry",eventPaymentIntent:"pi_live_offline_write_retry"}), "evt_live_offline_write_retry", async () => { writeFailureEmails += 1; return true; }), /Injected order write failure/);
  equal(writeFailureEmails, 0);
  equal(writeFailureState.events.find(event => event.payload?.invoice_id === "in_offline_write_retry").status, "Retry Required");
  await validRenewal(writeFailureState, invoiceFixture({invoiceId:"in_offline_write_retry",eventPaymentIntent:"pi_live_offline_write_retry"}), "evt_live_offline_write_retry_2", async () => { writeFailureEmails += 1; return true; });
  equal(renewalOrders(writeFailureState).length, 1);
  equal(writeFailureEmails, 1);

  for (const failure of ["rejection", "throw", "timeout"]) {
    const emailFailureState = stateWithEnrollment();
    const failedInvoice = invoiceFixture({invoiceId:`in_offline_email_${failure}`,eventPaymentIntent:`pi_live_offline_email_${failure}`});
    const failingSender = failure === "rejection" ? async () => false : async () => { throw new Error(`Injected ${failure}`); };
    await rejects(() => validRenewal(emailFailureState, failedInvoice, `evt_live_offline_email_${failure}`, failingSender), failure === "rejection" ? /delivery is incomplete/ : new RegExp(`Injected ${failure}`));
    equal(renewalOrders(emailFailureState).length, 1);
    equal(emailFailureState.events.find(event => event.payload?.invoice_id === failedInvoice.id).status, "Retry Required");
    await validRenewal(emailFailureState, failedInvoice, `evt_live_offline_email_${failure}_retry`, async () => true);
    equal(renewalOrders(emailFailureState).length, 1);
  }

  const statePatchFailure = stateWithEnrollment();
  statePatchFailure.failFinancialStatePatch = 1;
  let statePatchEmails = 0;
  const patchInvoice = invoiceFixture({invoiceId:"in_offline_state_patch",eventPaymentIntent:"pi_live_offline_state_patch"});
  await rejects(() => validRenewal(statePatchFailure, patchInvoice, "evt_live_offline_state_patch", async () => { statePatchEmails += 1; return true; }), /Injected financial state failure/);
  equal(statePatchEmails, 0);
  await validRenewal(statePatchFailure, patchInvoice, "evt_live_offline_state_patch_retry", async () => { statePatchEmails += 1; return true; });
  equal(renewalOrders(statePatchFailure).length, 1);
  equal(statePatchEmails, 1);

  const completionFailure = stateWithEnrollment();
  completionFailure.failCompletionPatch = 1;
  let completionEmails = 0;
  const completionInvoice = invoiceFixture({invoiceId:"in_offline_completion",eventPaymentIntent:"pi_live_offline_completion"});
  await rejects(() => validRenewal(completionFailure, completionInvoice, "evt_live_offline_completion", async () => { completionEmails += 1; return true; }), /Injected completion failure/);
  await validRenewal(completionFailure, completionInvoice, "evt_live_offline_completion_retry", async () => { completionEmails += 1; return true; });
  equal(renewalOrders(completionFailure).length, 1);
  equal(completionEmails, 2);
}

async function webhookFailureResponseTest() {
  const state = stateWithEnrollment();
  installOfflineFetch(state);
  delete process.env.RESEND_API_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = "offline_webhook_signing_fixture";
  const event = {
    id:"evt_live_offline_webhook_email_failure",
    type:"invoice.paid",
    data:{object:invoiceFixture({invoiceId:"in_offline_webhook_email_failure",eventPaymentIntent:"pi_live_offline_webhook_email_failure"})}
  };
  const raw = Buffer.from(JSON.stringify(event));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${raw}`).digest("hex");
  const request = Readable.from([raw]);
  request.method = "POST";
  request.query = {action:"webhook"};
  request.headers = {"stripe-signature":`t=${timestamp},v1=${signature}`};
  const result = {};
  const responseObject = {
    setHeader:() => {},
    status(status) { result.status = status; return this; },
    json(payload) { result.payload = payload; return payload; }
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await stripeHandler(request, responseObject);
  } finally {
    console.warn = originalWarn;
  }
  equal(result.status, 502);
  equal(result.payload.received, false);
  equal(renewalOrders(state).length, 1);
  equal(state.events.find(candidate => candidate.payload?.invoice_id === event.data.object.id).status, "Retry Required");
}

async function financialReportTests() {
  const state = stateWithEnrollment();
  const august = invoiceFixture({invoiceId:"in_offline_report_aug",eventPaymentIntent:"pi_live_offline_report_aug",paidAt:1787371200});
  const september = invoiceFixture({invoiceId:"in_offline_report_sep",eventPaymentIntent:"pi_live_offline_report_sep",paidAt:1789963200});
  await validRenewal(state, august, "evt_live_offline_report_aug", async () => true);
  await validRenewal(state, september, "evt_live_offline_report_sep", async () => true);

  for (const [startDate, endDate] of [["2026-08-01","2026-08-31"],["2026-09-01","2026-09-30"]]) {
    const period = validateReportPeriod({periodType:"monthly",startDate,endDate});
    const orders = state.orders
      .filter(order => order.payment_status === "Paid" && order.payment_at >= period.startUtc && order.payment_at < period.endUtcExclusive)
      .map(order => withOrderItems(state, order));
    const model = buildFinancialReportModel({orders,period,reportId:"BH-FR-OFFLINE",generatedAt:new Date("2026-10-01T12:00:00.000Z")});
    equal(model.totals.orderCount, 1);
    equal(model.totals.grossCents, 25000);
    equal(model.totals.feeCents, 755);
    equal(model.totals.netCents, 25755);
    equal(model.glSummary[0].glCode, "40033");
    equal(model.glSummary[0].netCents, 25755);
    equal(model.lines.length, 1);
    check(model.lines[0].paymentReference.includes("in_offline_report_"), "Report must expose the invoice linkage");
    check(model.lines[0].paymentReference.includes("sub_offline_valet"), "Report must expose the subscription linkage");
    check(model.lines[0].paymentReference.includes("enrollment BH-ENROL"), "Report must expose the enrollment relationship");
    const pdf = await generateFinancialReportPdf(model);
    check(Buffer.isBuffer(pdf) && pdf.length > 1000, "Financial PDF export must render the renewal once");
  }
}

async function emailAndSourceSecurityTests() {
  const residentEmail = buildValetRecurringResidentEmail(emailOrder());
  const managementEmail = buildValetRecurringManagementEmail(emailOrder());
  const renewal = {
    residentName:resident.name,
    unit:resident.unit,
    valetCents:25000,
    processingFeeCents:755,
    monthlyTotalCents:25755,
    renewalDate:"2026-08-22T12:00:00.000Z",
    nextRenewalDate:"2026-09-22T12:00:00.000Z",
    transactionReference:"BH-REN01",
    invoiceId:"in_offline_email_identity"
  };
  const renewalEmail = buildValetRecurringRenewalEmail(renewal);
  equal(residentEmail.subject, "Valet Parking Recurring Monthly Subscription Activated");
  check(residentEmail.text.includes("NOT a one-time payment"));
  check(managementEmail.text.includes("RECURRING MONTHLY SUBSCRIPTION ENROLLMENT"));
  equal(renewalEmail.to, MANAGEMENT_RECIPIENT);
  check(renewalEmail.text.includes("Valet Amount: $250.00"));
  check(renewalEmail.text.includes("Processing Fee: $7.55"));
  check(renewalEmail.text.includes("Total Paid: $257.55"));
  check(!renewalEmail.text.includes("sub_offline"));

  const idempotencyKeys = [];
  const resend = {emails:{send:async (_email, options) => { idempotencyKeys.push(options.idempotencyKey); return {data:{id:"offline"}}; }}};
  await sendValetRecurringRenewalEmail(renewal, {resend});
  await sendValetRecurringRenewalEmail({...renewal,eventId:"evt_live_offline_other"}, {resend});
  equal(idempotencyKeys[0], idempotencyKeys[1]);
  check(idempotencyKeys[0].includes("in_offline_email_identity"));

  const root = path.join(__dirname, "..");
  const checkoutSource = fs.readFileSync(path.join(root, "checkout.html"), "utf8");
  const roadmapSource = fs.readFileSync(path.join(root, "roadmap.js"), "utf8");
  const stripeSource = fs.readFileSync(path.join(root, "api", "_stripe-checkout.js"), "utf8");
  const envSource = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  check(checkoutSource.includes('value="one_time" checked'));
  check(!checkoutSource.includes("price_"));
  check(!roadmapSource.includes("price_"));
  check(roadmapSource.includes("recurringPaymentSelected() ? VALET_RECURRING_FEE_CENTS / 100"));
  check(roadmapSource.includes("authorization.checked = false"));
  check(stripeSource.includes("STRIPE_VALET_MONTHLY_PROCESSING_FEE_PRICE_ID"));
  check(envSource.includes("STRIPE_VALET_MONTHLY_PROCESSING_FEE_PRICE_ID="));
  check(stripeSource.includes('invoice?.billing_reason !== "subscription_cycle"'));
  check(!stripeSource.includes("payload:{invoice"));
}

async function run() {
  const {valid, oneTime} = await eligibilityTests();
  await priceAndSessionTests(valid, oneTime);
  await initialFulfillmentTests(valid);
  await renewalClassificationAndIdempotencyTests();
  await concurrencyAndRetryTests();
  await webhookFailureResponseTest();
  await financialReportTests();
  await emailAndSourceSecurityTests();
  process.stdout.write(`${JSON.stringify({
    assertions,
    offlineOnly:true,
    recurringEligibility:"svc13 quantity 1 only",
    monthlyAmounts:VALET_RECURRING_AMOUNTS,
    invoiceLevelIdempotency:true,
    financialReportRenewals:true,
    emailRetryCoverage:true,
    authorizationEvidenceUnchanged:true
  }, null, 2)}\n`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
