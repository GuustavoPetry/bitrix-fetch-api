/* Widget flutuante do "Bitrix Copilot" — chat com o bot de IA que monta e
 * executa métodos da API REST do Bitrix24. Toda execução real acontece pela
 * mesma função `send()` da UI principal (window.bitrixConsole), que por sua
 * vez chama a rota /call já existente — o chat nunca chama o Bitrix24 direto.
 */

const chatToggle = document.getElementById("chat-toggle");
const chatPanel = document.getElementById("chat-panel");
const chatClose = document.getElementById("chat-close");
const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

const history = [];

function toggleChat(open) {
  chatPanel.classList.toggle("hidden", !open);
  if (open) chatInput.focus();
}

chatToggle.addEventListener("click", () => toggleChat(chatPanel.classList.contains("hidden")));
chatClose.addEventListener("click", () => toggleChat(false));

function appendMessage(text, who) {
  const el = document.createElement("div");
  el.className = `chat-msg chat-msg-${who}`;
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return el;
}

function appendConfirmCard(method, params) {
  const wrap = document.createElement("div");
  wrap.className = "chat-msg chat-msg-bot chat-confirm";

  const label = document.createElement("div");
  label.textContent = `Método pronto: ${method} — não é somente leitura, revise antes de executar.`;
  wrap.appendChild(label);

  const pre = document.createElement("pre");
  pre.textContent = params ? JSON.stringify(params, null, 2) : "(sem payload)";
  wrap.appendChild(pre);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-send";
  btn.textContent = "Executar agora";
  btn.addEventListener("click", () => {
    window.bitrixConsole.setRequest(method, params);
    window.bitrixConsole.send();
    btn.disabled = true;
    btn.textContent = "Enviado ▶";
  });
  wrap.appendChild(btn);

  chatMessages.appendChild(wrap);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendChatMessage(text) {
  history.push({ role: "user", content: text });
  appendMessage(text, "user");

  const pending = appendMessage("Pensando…", "bot");

  let payload;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });

    payload = await res.json();

    if (!res.ok) {
      pending.textContent = payload.error || "Não consegui falar com o assistente agora.";
      return;
    }
  } catch (err) {
    pending.textContent = "Erro de rede ao falar com o assistente.";
    return;
  }

  pending.textContent = payload.reply || "(sem resposta)";
  history.push({ role: "assistant", content: payload.reply || "" });

  if (!payload.method) return;

  if (payload.requiresConfirmation) {
    window.bitrixConsole.setRequest(payload.method, payload.params);
    appendConfirmCard(payload.method, payload.params);
  } else {
    // Método de leitura: preenche os campos e já dispara a chamada via /call,
    // exatamente como se o usuário tivesse clicado em ▶ na UI principal.
    window.bitrixConsole.setRequest(payload.method, payload.params);
    window.bitrixConsole.send();
  }
}

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";
  sendChatMessage(text);
});

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});
