const crypto = require("crypto");
const {supabaseRequest} = require("./_supabase");
const IDENTITY_KNOWLEDGE = require("./_knowledge/brickellhouse/01_identity_contacts.json");
const FAQ_KNOWLEDGE = require("./_knowledge/brickellhouse/10_faq.json");
const VENDOR_KNOWLEDGE = require("./_knowledge/brickellhouse/12_vendors.json");
const BOARD_KNOWLEDGE = require("./_knowledge/brickellhouse/13_board.json");

const TRUSTED_CONTEXT_TTL_MS = 2 * 60 * 60 * 1000;
const TRUSTED_CONTEXT_MAX_MESSAGES = 20;
const TRUSTED_CONTEXT_MAX_TURNS = 10;
const TRUSTED_CONTEXT_MAX_MESSAGE_LENGTH = 900;
const TRUSTED_CONTEXT_MAX_STATE_BYTES = 4096;
const TRUSTED_CONTEXT_RESERVATION_TTL_MS = 2 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ATTRIBUTES = new Set(["position", "email", "phone", "hours", "price", "policy", "contact", "availability", "location", "unknown"]);
const SAFE_TOPICS = new Set([
  "constitution", "emergencyUrgent", "vendors", "residentStore", "packagesReceiving",
  "parkingAps", "movesContractorsDeliveries", "amenities", "rulesViolations",
  "hoaManagementPrivacy", "board", "faq", "identityContacts", "conversationStyle", "unknown"
]);
const SAFE_ENTITY_TYPES = new Set(["board", "staff", "vendor", "amenity", "parking", "contact", "product"]);

function toApprovedEntityId(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function vendorIds() {
  const ignored = new Set(["aliases_es", "examples_es"]);
  const ids = new Set();
  Object.entries(VENDOR_KNOWLEDGE).forEach(([key, entries]) => {
    if (ignored.has(key) || !Array.isArray(entries)) return;
    entries.forEach(entry => ids.add(toApprovedEntityId(String(entry).split(":")[0])));
  });
  return [...ids].sort();
}

const APPROVED_CONTEXT_ENTITY_IDS = Object.freeze({
  board:Object.freeze((BOARD_KNOWLEDGE.members || []).map(member => toApprovedEntityId(member.name)).sort()),
  staff:Object.freeze(["administrator", "assistant-manager", "general-manager"]),
  vendor:Object.freeze(vendorIds()),
  amenity:Object.freeze(["bbq", "business_center", "clubroom_lounge", "gym_fitness_center", "owners_lounge", "party_event_room", "pool_spa", "rooftop_terrace", "sauna", "theater"]),
  parking:Object.freeze(["aps", "parking-attendant", "valet"]),
  contact:Object.freeze(["front_desk", "maintenance", "management", "receiving"])
});
const APPROVED_ENTITY_IDS = Object.fromEntries(
  Object.entries(APPROVED_CONTEXT_ENTITY_IDS).map(([type, ids]) => [type, new Set(ids)])
);

function collectPublicContactFacts(value, facts = new Set()) {
  if (typeof value === "string") {
    for (const email of value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []) facts.add(email);
    for (const phone of value.match(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g) || []) facts.add(phone);
    return facts;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectPublicContactFacts(item, facts));
    return facts;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach(item => collectPublicContactFacts(item, facts));
  }
  return facts;
}

const APPROVED_PUBLIC_FACTS = [...collectPublicContactFacts({IDENTITY_KNOWLEDGE,VENDOR_KNOWLEDGE})];
if (FAQ_KNOWLEDGE.building_address) APPROVED_PUBLIC_FACTS.push(FAQ_KNOWLEDGE.building_address);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function placeholderLetters(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function protectApprovedPublicFacts(value) {
  let text = String(value || "");
  const replacements = [];
  [...new Set(APPROVED_PUBLIC_FACTS)].sort((a, b) => b.length - a.length).forEach(fact => {
    const token = `@@LUNAPUBLIC${placeholderLetters(replacements.length)}@@`;
    const pattern = new RegExp(escapeRegExp(fact), "gi");
    if (!pattern.test(text)) return;
    pattern.lastIndex = 0;
    text = text.replace(pattern, token);
    replacements.push({token,fact});
  });
  return {
    text,
    restore:next => replacements.reduce((result, item) => result.split(item.token).join(item.fact), next)
  };
}

function redactIdentityClaims(value) {
  let text = value;
  const nameWord = "[a-z\\u00c0-\\u024f][a-z\\u00c0-\\u024f'\\u2019-]*";
  const nameSequence = `${nameWord}(?:\\s+${nameWord}){0,3}`;
  const claimBoundary = "(?=\\s+(?:in|from|at|and|with|my|unit|apt|apartment|de|en|con|mi|unidad|apartamento|for)\\b|\\s*[,.;!?]|$)";
  const nonNameLeads = new Set([
    "a", "an", "the", "happy", "sorry", "ready", "here", "there", "looking", "trying", "asking",
    "having", "interested", "unable", "not", "available", "home", "fine", "good", "new", "calling",
    "how", "what", "where", "when", "why", "i", "we", "at", "for", "from", "with", "management", "resident", "neighbor",
    "feliz", "listo", "lista", "aqui", "aqu\u00ed", "bien", "nuevo", "nueva", "buscando", "tratando", "con"
  ]);
  const replaceCandidate = (match, prefix, candidate) => {
    const first = candidate.trim().split(/\s+/)[0].toLowerCase();
    return nonNameLeads.has(first) ? match : `${prefix} [name]`;
  };

  const explicitClaim = new RegExp(`\\b(my name(?:\\s+is|'s|\\u2019s)|me llamo|mi nombre es|this is|call me|puede llamarme|habla)\\s+(${nameSequence})${claimBoundary}`, "gi");
  text = text.replace(explicitClaim, replaceCandidate);

  const identityClaim = new RegExp(`\\b(i am|i['\\u2019]m|soy)\\s+(${nameSequence})${claimBoundary}`, "gi");
  text = text.replace(identityClaim, replaceCandidate);

  const directAddress = new RegExp(`\\b(hello|hi|hola|nice to meet you|good to meet you|of course|thank you|thanks|gracias)\\s*[,;:]?\\s+(${nameSequence})(?=\\s*[,.;!?]|$)`, "gi");
  text = text.replace(directAddress, replaceCandidate);
  text = text.replace(/\b(your name is|the resident's name is|the resident is)\s+[a-z\u00c0-\u024f'-]+(?:\s+[a-z\u00c0-\u024f'-]+){0,3}/gi, "$1 [name]");
  return text;
}

function redactSensitiveContext(value) {
  const protectedFacts = protectApprovedPublicFacts(String(value || "").replace(/\s+/g, " ").trim());
  let text = redactIdentityClaims(protectedFacts.text);

  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
  text = text.replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, "[phone]");
  text = text.replace(/\b(?:unit|apt|apartment|suite|#|unidad|apartamento)\s*[A-Z]?\d{2,6}[A-Z]?\b/gi, "[unit]");
  text = text.replace(/\b(?:my address is|our address is|i live at|we live at|mi direcci[oó]n es|vivo en)\b[^.?!\n]*/gi, "[address]");
  text = text.replace(/\b\d{1,6}\s+[A-Za-z0-9 .'-]{2,}\s+(?:street|st|avenue|ave|road|rd|drive|dr|court|ct|lane|ln|boulevard|blvd|way|terrace|ter|place|pl)\b/gi, "[address]");

  text = text.replace(/\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bearer[_ -]?token|client[_ -]?secret|secret[_ -]?key|password|passcode|security code|pin)\b\s*(?:is|es|=|:)?\s*["']?[A-Za-z0-9._~+/=-]{3,}/gi, "[credential]");
  text = text.replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g, "[credential]");
  text = text.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[credential]");
  text = text.replace(/\b(?:ssn|social security|routing|bank account|account number|credit card|debit card|card number|cvv|cvc)\b[^.?!\n]*/gi, "[payment information]");
  text = text.replace(/\b(?:\d[ -]*?){13,19}\b/g, "[payment number]");

  text = text.replace(/\b(?:my|our|mi|nuestro|nuestra)\s+(?:car|vehicle|auto|automobile|carro|veh[ií]culo)\b[^.?!\n]*/gi, "[vehicle information]");
  text = text.replace(/\b(?:i drive|i own|we drive|we own|conduzco|manejo|tengo un carro|tengo un veh[ií]culo)\b[^.?!\n]*/gi, "[vehicle information]");
  text = text.replace(/\b(?:license plate|plate number|tag number|vehicle tag|placa|matr[ií]cula|vin)\b[^.?!\n]*/gi, "[vehicle identifier]");
  text = text.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, "[vehicle identifier]");

  text = text.replace(/\b(?:gl(?:\s+code)?|general ledger(?:\s+(?:code|account|reference))?|accounting(?:\s+(?:code|reference|account))?)\b\s*[-:#]?\s*[A-Za-z0-9._-]*/gi, "[accounting reference]");
  text = text.replace(/\b(?=[A-Za-z0-9_-]{12,64}\b)(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g, "[identifier]");
  text = text.replace(/(?:\d[\s-]*){12,}/g, "[number]");

  return protectedFacts.restore(text).slice(0, TRUSTED_CONTEXT_MAX_MESSAGE_LENGTH);
}

function redactResidentContext(value) {
  return redactSensitiveContext(value);
}

function validateTrustedHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-TRUSTED_CONTEXT_MAX_MESSAGES).map(item => {
    const role = item?.role === "user" || item?.role === "assistant" ? item.role : null;
    if (!role) return null;
    const content = redactSensitiveContext(String(item?.content || "").trim());
    return content ? {role,content} : null;
  }).filter(Boolean);
}

function sanitizeEntityReference(entity, options = {}) {
  if (!entity || typeof entity !== "object") return null;
  const keys = Object.keys(entity);
  if (keys.length !== 2 || !keys.includes("type") || !keys.includes("id")) return null;
  const type = String(entity.type || "");
  const id = String(entity.id || "");
  if (!SAFE_ENTITY_TYPES.has(type) || !/^[a-z][a-z0-9_-]{0,79}$/.test(id)) return null;
  if (type === "product") {
    if (!/^svc\d{1,4}$/.test(id)) return null;
    if (options.allowStoredProductIds) return {type,id};
    const approvedProductIds = options.approvedProductIds instanceof Set
      ? options.approvedProductIds
      : new Set(Array.isArray(options.approvedProductIds) ? options.approvedProductIds : []);
    return approvedProductIds.has(id) ? {type,id} : null;
  }
  return APPROVED_ENTITY_IDS[type]?.has(id) ? {type,id} : null;
}

function emptyConversationState() {
  return {activeTopic:"unknown",entities:[],candidateReferents:[],lastRequestedAttribute:"unknown"};
}

function sanitizeConversationState(state, options = {}) {
  const value = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  const entities = (Array.isArray(value.entities) ? value.entities : [])
    .map(entity => sanitizeEntityReference(entity, options))
    .filter(Boolean)
    .slice(0, 10);
  const candidateReferents = (Array.isArray(value.candidateReferents) ? value.candidateReferents : [])
    .map(entity => sanitizeEntityReference(entity, options))
    .filter(Boolean)
    .slice(0, 10);
  const requested = SAFE_ATTRIBUTES.has(value.lastRequestedAttribute) ? value.lastRequestedAttribute : "unknown";
  const result = {
    activeTopic:SAFE_TOPICS.has(value.activeTopic) ? value.activeTopic : "unknown",
    entities,
    candidateReferents,
    lastRequestedAttribute:requested
  };
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > TRUSTED_CONTEXT_MAX_STATE_BYTES) {
    return emptyConversationState();
  }
  return result;
}

function sanitizeStoredConversationState(state) {
  return sanitizeConversationState(state, {allowStoredProductIds:true});
}

function emptyTrustedContext(extra = {}) {
  return {
    messages:[],
    state:sanitizeConversationState({}),
    version:0,
    expiresAt:0,
    ...extra
  };
}

function isUuid(value) {
  return UUID_PATTERN.test(String(value || ""));
}

function tokenSecret(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "secret")) return String(options.secret || "");
  return String(process.env.LUNA_CONTEXT_SIGNING_SECRET || "");
}

function tokenSignature(conversationId, expiresAt, secret) {
  return crypto.createHmac("sha256", secret)
    .update(`luna-context-v1:${conversationId}:${expiresAt}`)
    .digest("base64url");
}

function createSignedConversationToken(conversationId, expiresAt, options = {}) {
  const secret = tokenSecret(options);
  const expiry = Math.trunc(Number(expiresAt));
  if (!secret || !isUuid(conversationId) || !Number.isFinite(expiry)) return "";
  return `v1.${expiry}.${tokenSignature(conversationId, expiry, secret)}`;
}

function verifySignedConversationToken(conversationId, token, options = {}) {
  const secret = tokenSecret(options);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (!secret || !isUuid(conversationId) || typeof token !== "string" || token.length > 128) {
    return {valid:false,reason:"invalid"};
  }
  const match = /^v1\.(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return {valid:false,reason:"invalid"};
  const expiresAt = Number(match[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return {valid:false,reason:"expired",expiresAt};
  const expected = Buffer.from(tokenSignature(conversationId, expiresAt, secret));
  const supplied = Buffer.from(match[2]);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    return {valid:false,reason:"invalid",expiresAt};
  }
  return {valid:true,expiresAt};
}

function createConversationIdentity(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const conversationId = randomUUID();
  const expiresAt = now + TRUSTED_CONTEXT_TTL_MS;
  const conversationToken = createSignedConversationToken(conversationId, expiresAt, options);
  return {conversationId,conversationToken,expiresAt};
}

async function loadTrustedConversationContext(conversationId, options = {}) {
  if (!isUuid(conversationId)) return emptyTrustedContext();
  const request = options.request || supabaseRequest;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const rows = await request(
    `luna_conversation_contexts?conversation_id=eq.${encodeURIComponent(conversationId)}&select=version,context_state,expires_at&limit=1`,
    {method:"GET",prefer:""}
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return emptyTrustedContext();
  const expiresAt = Date.parse(row.expires_at || "");
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    await request("rpc/delete_expired_luna_conversation_context", {
      method:"POST",
      body:{p_conversation_id:conversationId,p_observed_expires_at:row.expires_at},
      prefer:"return=minimal"
    });
    return emptyTrustedContext({expired:true});
  }
  const version = Number.isSafeInteger(Number(row.version)) && Number(row.version) >= 0 ? Number(row.version) : 0;
  const turns = await request(
    `luna_conversation_turns?conversation_id=eq.${encodeURIComponent(conversationId)}&sequence=lte.${version}&select=sequence,user_content,assistant_content&order=sequence.desc&limit=${TRUSTED_CONTEXT_MAX_TURNS}`,
    {method:"GET",prefer:""}
  );
  const messages = (Array.isArray(turns) ? turns.slice().reverse() : []).flatMap(turn => [
    {role:"user",content:turn.user_content},
    {role:"assistant",content:turn.assistant_content}
  ]);
  return {
    messages:validateTrustedHistory(messages),
    state:sanitizeStoredConversationState(row.context_state),
    version,
    expiresAt,
    expired:false
  };
}

async function reserveTrustedConversationRequest(conversationId, requestId, reservationId, options = {}) {
  if (!isUuid(conversationId) || !isUuid(requestId) || !isUuid(reservationId)) {
    throw new Error("Invalid trusted context reservation identifier");
  }
  const request = options.request || supabaseRequest;
  const rows = await request("rpc/reserve_luna_conversation_request", {
    method:"POST",
    body:{
      p_conversation_id:conversationId,
      p_request_id:requestId,
      p_reservation_id:reservationId
    },
    prefer:"return=representation"
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.result_status) throw new Error("Trusted context reservation returned no result");
  return {
    status:row.result_status,
    sequence:Number(row.result_sequence) || 0,
    version:Number(row.result_version) || 0,
    expiresAt:Date.parse(row.result_expires_at || "") || 0,
    reply:row.result_assistant_content || ""
  };
}

async function appendTrustedConversationTurn(conversationId, requestId, reservationId, expectedVersion, userContent, assistantContent, state, options = {}) {
  if (!isUuid(conversationId) || !isUuid(requestId) || !isUuid(reservationId)) throw new Error("Invalid trusted context identifier");
  const request = options.request || supabaseRequest;
  const safeUser = redactResidentContext(userContent);
  const safeAssistant = redactSensitiveContext(assistantContent);
  const safeState = sanitizeConversationState(state, {approvedProductIds:options.approvedProductIds});
  if (!safeUser || !safeAssistant) throw new Error("Trusted context turn is empty after redaction");
  const rows = await request("rpc/append_luna_conversation_turn", {
    method:"POST",
    body:{
      p_conversation_id:conversationId,
      p_request_id:requestId,
      p_reservation_id:reservationId,
      p_expected_version:Number(expectedVersion) || 0,
      p_user_content:safeUser,
      p_assistant_content:safeAssistant,
      p_context_state:safeState
    },
    prefer:"return=representation"
  });
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.result_status) throw new Error("Trusted context append returned no result");
  try {
    await request("rpc/purge_expired_luna_conversation_contexts", {method:"POST",body:{},prefer:"return=minimal"});
  } catch (error) {
    // The turn is already committed; cleanup failure must not cause a duplicate retry.
  }
  return {
    status:row.result_status,
    sequence:Number(row.result_sequence) || 0,
    version:Number(row.result_version) || 0,
    expiresAt:Date.parse(row.result_expires_at || "") || 0,
    reply:row.result_assistant_content || "",
    userContent:safeUser,
    assistantContent:safeAssistant,
    state:safeState
  };
}

module.exports = {
  TRUSTED_CONTEXT_TTL_MS,
  TRUSTED_CONTEXT_MAX_MESSAGES,
  TRUSTED_CONTEXT_MAX_TURNS,
  TRUSTED_CONTEXT_MAX_MESSAGE_LENGTH,
  TRUSTED_CONTEXT_MAX_STATE_BYTES,
  TRUSTED_CONTEXT_RESERVATION_TTL_MS,
  APPROVED_PUBLIC_FACTS,
  APPROVED_CONTEXT_ENTITY_IDS,
  SAFE_TOPICS,
  SAFE_ENTITY_TYPES,
  isUuid,
  toApprovedEntityId,
  redactSensitiveContext,
  redactResidentContext,
  validateTrustedHistory,
  sanitizeConversationState,
  createSignedConversationToken,
  verifySignedConversationToken,
  createConversationIdentity,
  loadTrustedConversationContext,
  reserveTrustedConversationRequest,
  appendTrustedConversationTurn
};
