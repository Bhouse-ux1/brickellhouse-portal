const chatWidget = document.querySelector("#residentChat");

if (chatWidget) {
  const launcher = chatWidget.querySelector("#chatLauncher");
  const panel = chatWidget.querySelector("#chatPanel");
  const closeButton = chatWidget.querySelector("#chatClose");
  const form = chatWidget.querySelector("#chatForm");
  const input = chatWidget.querySelector("#chatInput");
  const messages = chatWidget.querySelector("#chatMessages");
  const sendButton = chatWidget.querySelector("#chatSend");
  const teaser = chatWidget.querySelector("#chatTeaser");
  const errorMessage = "Sorry, I could not respond right now. Please try again.";
  const promptStorageKey = "bh_ai_prompt_seen";
  const promptDelay = 4200;
  const promptVisibleDuration = 7600;
  const conversation = [];
  const maxConversationMessages = 10;
  let promptHideTimer;

  function setChatOpen(open) {
    chatWidget.classList.toggle("open", open);
    chatWidget.classList.remove("teasing");
    if (promptHideTimer) clearTimeout(promptHideTimer);
    launcher.setAttribute("aria-expanded", String(open));
    panel.setAttribute("aria-hidden", String(!open));
    if (open) sessionStorage.setItem(promptStorageKey, "1");
    if (open) requestAnimationFrame(() => input.focus());
  }

  function appendMessage(role, text) {
    const bubble = document.createElement("div");
    bubble.className = `chat-message ${role}`;
    if (role.includes("assistant")) {
      bubble.innerHTML = linkifyText(text);
    } else {
      bubble.textContent = text;
    }
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
    while (conversation.length > maxConversationMessages) conversation.shift();
  }

  function isLauncherClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("#chatLauncher")) return true;
    if (target && panel.contains(target)) return false;
    const rect = launcher.getBoundingClientRect();
    const buffer = window.matchMedia("(max-width: 700px)").matches ? 8 : 24;
    return event.clientX >= rect.left - buffer
      && event.clientX <= rect.right + buffer
      && event.clientY >= rect.top - buffer
      && event.clientY <= rect.bottom + buffer;
  }

  function toggleChatFromLauncher(event) {
    event.preventDefault();
    setChatOpen(!chatWidget.classList.contains("open"));
  }

  document.addEventListener("click", event => {
    if (!isLauncherClick(event)) return;
    toggleChatFromLauncher(event);
  }, true);
  teaser?.addEventListener("click", () => setChatOpen(true));
  closeButton.addEventListener("click", () => setChatOpen(false));

  if (!sessionStorage.getItem(promptStorageKey)) {
    setTimeout(() => {
      if (chatWidget.classList.contains("open")) return;
      chatWidget.classList.add("teasing");
      sessionStorage.setItem(promptStorageKey, "1");
      promptHideTimer = setTimeout(() => chatWidget.classList.remove("teasing"), promptVisibleDuration);
    }, promptDelay);
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    appendMessage("resident", message);
    const history = conversation.slice(-8);
    remember("user", message);
    const loading = appendMessage("assistant loading", "Thinking");
    sendButton.disabled = true;

    try {
      const response = await fetch("/api/chat", {
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({message,history})
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || errorMessage);
      loading.classList.remove("loading");
      loading.innerHTML = linkifyText(payload.reply);
      remember("assistant", payload.reply);
    } catch (error) {
      loading.classList.remove("loading");
      loading.classList.add("error");
      loading.textContent = errorMessage;
    } finally {
      sendButton.disabled = false;
      input.focus();
    }
  });
}
