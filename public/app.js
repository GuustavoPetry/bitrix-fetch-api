const methodInput = document.getElementById("method");
const bodyInput = document.getElementById("body");
const jsonError = document.getElementById("json-error");
const sendBtn = document.getElementById("send");
const formatBtn = document.getElementById("format");
const copyBtn = document.getElementById("copy");
const responseEl = document.getElementById("response");
const statusEl = document.getElementById("status");
const elapsedEl = document.getElementById("elapsed");
const contextEl = document.getElementById("context");

/* ---------- Contexto Bitrix24 ---------- */

fetch("/context")
  .then((r) => r.json())
  .then(({ domain, authenticated }) => {
    contextEl.textContent = authenticated
      ? `conectado: ${domain}`
      : `${domain} — sem AUTH_ID (abra dentro do Bitrix24)`;
    contextEl.className = `badge ${authenticated ? "badge-ok" : "badge-warn"}`;
  })
  .catch(() => {
    contextEl.textContent = "falha ao obter contexto";
    contextEl.className = "badge badge-err";
  });

/* ---------- Validação de JSON ---------- */

function validateJson(showEmptyOk = true) {
  const text = bodyInput.value.trim();

  if (!text) {
    bodyInput.classList.remove("invalid");
    jsonError.classList.add("hidden");
    return showEmptyOk;
  }

  try {
    JSON.parse(text);
    bodyInput.classList.remove("invalid");
    jsonError.classList.add("hidden");
    return true;
  } catch (err) {
    bodyInput.classList.add("invalid");
    jsonError.textContent = `JSON inválido: ${err.message}`;
    jsonError.classList.remove("hidden");
    return false;
  }
}

bodyInput.addEventListener("input", () => validateJson());

/* ---------- Facilitadores de sintaxe ---------- */

const PAIRS = { "{": "}", "[": "]", '"': '"' };

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value =
    textarea.value.slice(0, start) + text + textarea.value.slice(end);
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
}

bodyInput.addEventListener("keydown", (e) => {
  const el = e.target;
  const { selectionStart: start, selectionEnd: end, value } = el;

  // Ctrl+Enter envia (precisa vir antes do tratamento de Enter)
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    send();
    return;
  }

  // Tab insere 2 espaços
  if (e.key === "Tab") {
    e.preventDefault();
    insertAtCursor(el, "  ");
    return;
  }

  // Auto-fecha { [ "
  if (PAIRS[e.key] && start === end) {
    e.preventDefault();
    el.value =
      value.slice(0, start) + e.key + PAIRS[e.key] + value.slice(end);
    el.selectionStart = el.selectionEnd = start + 1;
    return;
  }

  // Digitar o fechamento sobre o caractere já auto-fechado
  if (["}", "]", '"'].includes(e.key) && value[start] === e.key && start === end) {
    e.preventDefault();
    el.selectionStart = el.selectionEnd = start + 1;
    return;
  }

  // Enter mantém indentação; dentro de {} ou [] quebra e indenta os dois lados
  if (e.key === "Enter") {
    e.preventDefault();

    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const indent = (value.slice(lineStart, start).match(/^[ \t]*/) || [""])[0];
    const prev = value[start - 1];
    const next = value[start];
    const opensBlock = (prev === "{" && next === "}") || (prev === "[" && next === "]");

    if (opensBlock) {
      const insertion = `\n${indent}  \n${indent}`;
      el.value = value.slice(0, start) + insertion + value.slice(end);
      el.selectionStart = el.selectionEnd = start + indent.length + 3;
    } else {
      const extra = prev === "{" || prev === "[" ? "  " : "";
      const insertion = `\n${indent}${extra}`;
      el.value = value.slice(0, start) + insertion + value.slice(end);
      el.selectionStart = el.selectionEnd = start + insertion.length;
    }

    validateJson();
    return;
  }
});

// Ctrl+Enter também fora do textarea
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    send();
  }
});

/* ---------- Formatar ---------- */

formatBtn.addEventListener("click", () => {
  if (!validateJson(false)) return;
  const text = bodyInput.value.trim();
  if (text) {
    bodyInput.value = JSON.stringify(JSON.parse(text), null, 2);
  }
});

/* ---------- Enviar ---------- */

async function send() {
  const method = methodInput.value.trim();

  if (!method) {
    methodInput.focus();
    return;
  }
  if (!validateJson(false)) return;

  const text = bodyInput.value.trim();
  const params = text ? JSON.parse(text) : {};

  sendBtn.disabled = true;
  statusEl.classList.add("hidden");
  elapsedEl.textContent = "";
  responseEl.textContent = "Enviando…";

  const started = performance.now();

  try {
    const res = await fetch("/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
    });

    const payload = await res.json();
    const elapsed = Math.round(performance.now() - started);

    statusEl.textContent = `HTTP ${payload.status}`;
    statusEl.className = `badge ${payload.status >= 200 && payload.status < 300 ? "badge-ok" : "badge-err"}`;
    elapsedEl.textContent = `${elapsed} ms`;

    responseEl.textContent = JSON.stringify(payload.data, null, 2);
  } catch (err) {
    statusEl.textContent = "erro";
    statusEl.className = "badge badge-err";
    responseEl.textContent = String(err);
  } finally {
    sendBtn.disabled = false;
  }
}

sendBtn.addEventListener("click", send);

/* ---------- Copiar resposta ---------- */

copyBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(responseEl.textContent);
  copyBtn.textContent = "Copiado!";
  setTimeout(() => (copyBtn.textContent = "Copiar"), 1200);
});
