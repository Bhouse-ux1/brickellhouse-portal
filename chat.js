const LUNA_CONVERSATION_STORAGE_KEY = "bh_luna_conversation_id";
const LUNA_CONVERSATION_TOKEN_STORAGE_KEY = "bh_luna_conversation_token";
const LUNA_HISTORY_STORAGE_KEY = "bh_luna_conversation_history";
const LUNA_HISTORY_TTL_MS = 2 * 60 * 60 * 1000;
const LUNA_MAX_HISTORY_MESSAGES = 20;

function sanitizeLunaHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-LUNA_MAX_HISTORY_MESSAGES).map(item => {
    const role = item && (item.role === "user" || item.role === "assistant") ? item.role : null;
    const content = String(item?.content || "").trim().slice(0, 900);
    return role && content ? {role,content} : null;
  }).filter(Boolean);
}

function safeStorageGet(storage, key) {
  try {
    return storage?.getItem(key) || null;
  } catch (error) {
    return null;
  }
}

function safeStorageSet(storage, key, value) {
  try {
    storage?.setItem(key, value);
    return Boolean(storage);
  } catch (error) {
    return false;
  }
}

function safeStorageRemove(storage, key) {
  try {
    storage?.removeItem(key);
    return Boolean(storage);
  } catch (error) {
    return false;
  }
}

function getLunaSessionStorage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch (error) {
    return null;
  }
}

function readLunaSession(storage, now = Date.now()) {
  try {
    const parsed = JSON.parse(safeStorageGet(storage, LUNA_HISTORY_STORAGE_KEY) || "null");
    if (!parsed || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= now) {
      safeStorageRemove(storage, LUNA_HISTORY_STORAGE_KEY);
      safeStorageRemove(storage, LUNA_CONVERSATION_STORAGE_KEY);
      safeStorageRemove(storage, LUNA_CONVERSATION_TOKEN_STORAGE_KEY);
      return {messages:[],conversationId:"",conversationToken:"",expiresAt:0,expired:Boolean(parsed)};
    }
    return {
      messages:sanitizeLunaHistory(parsed.messages),
      conversationId:safeStorageGet(storage, LUNA_CONVERSATION_STORAGE_KEY) || "",
      conversationToken:safeStorageGet(storage, LUNA_CONVERSATION_TOKEN_STORAGE_KEY) || "",
      expiresAt:parsed.expiresAt,
      expired:false
    };
  } catch (error) {
    safeStorageRemove(storage, LUNA_HISTORY_STORAGE_KEY);
    safeStorageRemove(storage, LUNA_CONVERSATION_STORAGE_KEY);
    safeStorageRemove(storage, LUNA_CONVERSATION_TOKEN_STORAGE_KEY);
    return {messages:[],conversationId:"",conversationToken:"",expiresAt:0,expired:true};
  }
}

function writeLunaHistory(storage, messages, now = Date.now(), expiresAt = now + LUNA_HISTORY_TTL_MS) {
  const sanitized = sanitizeLunaHistory(messages);
  safeStorageSet(storage, LUNA_HISTORY_STORAGE_KEY, JSON.stringify({
    expiresAt,
    messages:sanitized
  }));
  return sanitized;
}

function clearLunaSession(storage) {
  safeStorageRemove(storage, LUNA_HISTORY_STORAGE_KEY);
  safeStorageRemove(storage, LUNA_CONVERSATION_STORAGE_KEY);
  safeStorageRemove(storage, LUNA_CONVERSATION_TOKEN_STORAGE_KEY);
}

function createLunaRequestGeneration() {
  let generation = 0;
  return {
    capture:() => generation,
    invalidate:() => ++generation,
    isCurrent:value => value === generation
  };
}

function applyLunaConversationId(payload, currentId, storage) {
  const nextId = typeof payload?.conversationId === "string" ? payload.conversationId.trim() : "";
  if (!nextId) return currentId;
  safeStorageSet(storage, LUNA_CONVERSATION_STORAGE_KEY, nextId);
  return nextId;
}

function applyLunaConversationIdentity(payload, currentIdentity, storage) {
  const current = currentIdentity || {};
  const currentConversationId = String(current.conversationId || "");
  const currentConversationToken = String(current.conversationToken || "");
  const conversationId = typeof payload?.conversationId === "string" && payload.conversationId.trim()
    ? payload.conversationId.trim()
    : currentConversationId;
  const conversationToken = typeof payload?.conversationToken === "string"
    ? payload.conversationToken.trim()
    : currentConversationToken;
  const expiresAt = Number.isFinite(Number(payload?.conversationExpiresAt))
    ? Number(payload.conversationExpiresAt)
    : Number(current.expiresAt) || 0;
  if (conversationId && conversationId !== currentConversationId) {
    safeStorageSet(storage, LUNA_CONVERSATION_STORAGE_KEY, conversationId);
  }
  if (conversationToken && conversationToken !== currentConversationToken) {
    safeStorageSet(storage, LUNA_CONVERSATION_TOKEN_STORAGE_KEY, conversationToken);
  } else if (!conversationToken && currentConversationToken) {
    safeStorageRemove(storage, LUNA_CONVERSATION_TOKEN_STORAGE_KEY);
  }
  return {conversationId,conversationToken,expiresAt};
}

async function requestLunaConversationIdentity(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("Luna session initialization is unavailable");
  const response = await fetchImpl("/api/chat", {
    method:"POST",
    headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({action:"init"})
  });
  const payload = await response.json();
  if (!response.ok || !payload.success || !payload.conversationId) {
    throw new Error(payload.message || "Luna session initialization failed");
  }
  return payload;
}

function createAnonymousConversationId(cryptoSource = globalThis.crypto) {
  try {
    if (typeof cryptoSource?.randomUUID === "function") return cryptoSource.randomUUID();
    if (typeof cryptoSource?.getRandomValues !== "function") return "";
    const bytes = new Uint8Array(16);
    cryptoSource.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  } catch (error) {
    return "";
  }
}

function initResidentChat() {
  const chatWidget = document.querySelector("#residentChat");
  if (!chatWidget || chatWidget.dataset.chatReady === "true") return;

  const launcher = chatWidget.querySelector("#chatLauncher");
  const panel = chatWidget.querySelector("#chatPanel");
  const closeButton = chatWidget.querySelector("#chatClose");
  const form = chatWidget.querySelector("#chatForm");
  const input = chatWidget.querySelector("#chatInput");
  const messages = chatWidget.querySelector("#chatMessages");
  const sendButton = chatWidget.querySelector("#chatSend");
  const clearButton = chatWidget.querySelector("#chatClear");
  const teaser = chatWidget.querySelector("#chatTeaser");
  const chatText = key => window.BH_I18N?.t(key) || key;
  const promptStorageKey = "bh_ai_prompt_seen";
  const promptDelay = 4200;
  const promptVisibleDuration = 7600;
  const storage = getLunaSessionStorage();
  const conversation = [];
  let conversationId = "";
  let conversationToken = "";
  let conversationExpiresAt = 0;
  let sessionHydrated = false;
  let identityInitializedForPage = false;
  let identityInitialization = null;
  let activeRequestGeneration = null;
  let promptHideTimer;
  const requestGeneration = createLunaRequestGeneration();

  if (!launcher || !panel || !closeButton || !form || !input || !messages || !sendButton) return;
  chatWidget.dataset.chatReady = "true";

  function setChatOpen(open) {
    if (open) hydrateConversationSession();
    chatWidget.classList.toggle("open", open);
    chatWidget.classList.remove("teasing");
    if (promptHideTimer) clearTimeout(promptHideTimer);
    launcher.setAttribute("aria-expanded", String(open));
    panel.setAttribute("aria-hidden", String(!open));
    if (open) safeStorageSet(storage, promptStorageKey, "1");
    if (open) requestAnimationFrame(() => input.focus());
  }

  function createMessageBubble(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `chat-message ${role}`;
    if (role.includes("assistant")) {
      bubble.innerHTML = linkifyText(text);
    } else {
      bubble.textContent = text;
    }
    return bubble;
  }

  function appendMessage(role, text) {
    const bubble = createMessageBubble(role, text);
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      "\"":"&quot;",
      "'":"&#39;"
    })[character]);
  }

  function linkifyText(value) {
    const escaped = escapeHtml(value);
    return escaped.replace(/https?:\/\/[^\s<>"']+/g, url => {
      const cleanUrl = url.replace(/[),.;:!?]+$/g, "");
      const trailing = url.slice(cleanUrl.length);
      return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${trailing}`;
    });
  }

  function remember(role, content) {
    conversation.push({role, content});
    const now = Date.now();
    if (!conversationExpiresAt || conversationExpiresAt <= now) conversationExpiresAt = now + LUNA_HISTORY_TTL_MS;
    const sanitized = writeLunaHistory(storage, conversation, now, conversationExpiresAt);
    conversation.splice(0, conversation.length, ...sanitized);
  }

  function hydrateConversationSession() {
    if (sessionHydrated) return;
    sessionHydrated = true;
    const restoredSession = readLunaSession(storage);
    conversation.splice(0, conversation.length, ...restoredSession.messages);
    conversationId = restoredSession.conversationId;
    conversationToken = restoredSession.conversationToken;
    conversationExpiresAt = restoredSession.expiresAt;
    identityInitializedForPage = Boolean(conversationId && conversationToken && conversationExpiresAt > Date.now());

    if (!conversation.length) return;
    const fragment = document.createDocumentFragment();
    for (const item of conversation) {
      fragment.appendChild(createMessageBubble(item.role === "assistant" ? "assistant" : "resident", item.content));
    }
    messages.appendChild(fragment);
    messages.scrollTop = messages.scrollHeight;
  }

  async function ensureConversationIdentity(generation = requestGeneration.capture()) {
    hydrateConversationSession();
    if (conversationId && conversationExpiresAt > Date.now() && (conversationToken || identityInitializedForPage)) {
      return true;
    }
    if (identityInitialization?.generation === generation) return identityInitialization.promise;

    const promise = requestLunaConversationIdentity().then(payload => {
      if (!requestGeneration.isCurrent(generation)) return false;
      const identity = applyLunaConversationIdentity(payload, {conversationId,conversationToken,expiresAt:conversationExpiresAt}, storage);
      conversationId = identity.conversationId;
      conversationToken = identity.conversationToken;
      conversationExpiresAt = identity.expiresAt || Date.now() + LUNA_HISTORY_TTL_MS;
      identityInitializedForPage = Boolean(conversationId && (conversationToken || payload.contextAvailable === false || identityInitializedForPage));
      writeLunaHistory(storage, conversation, Date.now(), conversationExpiresAt);
      return true;
    });
    identityInitialization = {generation,promise};
    try {
      return await promise;
    } finally {
      if (identityInitialization?.promise === promise) identityInitialization = null;
    }
  }

  function clearConversation() {
    hydrateConversationSession();
    requestGeneration.invalidate();
    identityInitialization = null;
    identityInitializedForPage = false;
    activeRequestGeneration = null;
    clearLunaSession(storage);
    conversation.splice(0, conversation.length);
    conversationId = "";
    conversationToken = "";
    conversationExpiresAt = 0;
    sendButton.disabled = false;
    messages.querySelectorAll(".chat-message:not(.chat-welcome)").forEach(message => message.remove());
    const generation = requestGeneration.capture();
    void ensureConversationIdentity(generation).catch(() => {
      // Luna can initialize again on the resident's next message.
    });
  }

  function openChat(event) {
    event.preventDefault();
    setChatOpen(true);
    void ensureConversationIdentity().catch(() => {
      // Luna can initialize again when the resident sends a message.
    });
  }

  launcher.addEventListener("click", openChat);
  teaser?.addEventListener("click", openChat);
  closeButton.addEventListener("click", () => setChatOpen(false));
  clearButton?.addEventListener("click", () => {
    clearConversation();
    input.value = "";
    input.focus();
  });

  const scheduleHistoryHydration = typeof window.requestIdleCallback === "function"
    ? callback => window.requestIdleCallback(callback, {timeout:1500})
    : callback => setTimeout(callback, 1200);
  scheduleHistoryHydration(hydrateConversationSession);

  if (!safeStorageGet(storage, promptStorageKey)) {
    setTimeout(() => {
      if (chatWidget.classList.contains("open")) return;
      chatWidget.classList.add("teasing");
      safeStorageSet(storage, promptStorageKey, "1");
      promptHideTimer = setTimeout(() => chatWidget.classList.remove("teasing"), promptVisibleDuration);
    }, promptDelay);
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || activeRequestGeneration !== null) return;
    hydrateConversationSession();
    if (conversationExpiresAt && conversationExpiresAt <= Date.now()) clearConversation();
    const generation = requestGeneration.capture();
    activeRequestGeneration = generation;
    input.value = "";
    appendMessage("resident", message);
    const loading = appendMessage("assistant loading", chatText("luna.thinking"));
    sendButton.disabled = true;
    remember("user", message);

    try {
      await ensureConversationIdentity(generation);
      if (!requestGeneration.isCurrent(generation)) return;
      const requestId = createAnonymousConversationId();
      if (!requestId) throw new Error("Luna request initialization failed");
      const response = await fetch("/api/chat", {
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({
          message,
          conversationId,
          conversationToken,
          requestId,
          language:window.BH_I18N?.getLanguage() || "en"
        })
      });
      const payload = await response.json();
      if (!requestGeneration.isCurrent(generation)) return;
      const identity = applyLunaConversationIdentity(payload, {conversationId,conversationToken,expiresAt:conversationExpiresAt}, storage);
      conversationId = identity.conversationId;
      conversationToken = identity.conversationToken;
      conversationExpiresAt = identity.expiresAt || conversationExpiresAt;
      identityInitializedForPage = Boolean(conversationId && (conversationToken || payload.contextAvailable === false || identityInitializedForPage));
      if (!response.ok || !payload.success) {
        const requestError = new Error(payload.message || chatText("luna.error"));
        requestError.residentMessageKey = response.status === 429 ? "luna.rateLimit" : "luna.error";
        throw requestError;
      }
      loading.classList.remove("loading");
      loading.innerHTML = linkifyText(payload.reply);
      remember("assistant", payload.reply);
    } catch (error) {
      if (!requestGeneration.isCurrent(generation)) return;
      loading.classList.remove("loading");
      loading.classList.add("error");
      loading.textContent = chatText(error.residentMessageKey || "luna.error");
    } finally {
      if (requestGeneration.isCurrent(generation) && activeRequestGeneration === generation) {
        activeRequestGeneration = null;
        sendButton.disabled = false;
        input.focus();
      }
    }
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initResidentChat);
  } else {
    initResidentChat();
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    LUNA_CONVERSATION_STORAGE_KEY,
    LUNA_CONVERSATION_TOKEN_STORAGE_KEY,
    LUNA_HISTORY_STORAGE_KEY,
    LUNA_HISTORY_TTL_MS,
    LUNA_MAX_HISTORY_MESSAGES,
    sanitizeLunaHistory,
    safeStorageGet,
    safeStorageSet,
    safeStorageRemove,
    getLunaSessionStorage,
    readLunaSession,
    writeLunaHistory,
    clearLunaSession,
    createLunaRequestGeneration,
    applyLunaConversationId,
    applyLunaConversationIdentity,
    requestLunaConversationIdentity,
    createAnonymousConversationId
  };
}
