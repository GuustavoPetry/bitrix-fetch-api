const methodInput = document.getElementById("method");
const bodyInput = document.getElementById("body");
const bodyHighlight = document.getElementById("body-highlight");
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

/* ---------- Highlight de sintaxe JSON ---------- */

const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightJson(text) {
  return escapeHtml(text).replace(JSON_TOKEN, (match, str, colon) => {
    if (str !== undefined) {
      const cls = colon ? "tk-key" : "tk-string";
      return `<span class="${cls}">${str}</span>${colon ?? ""}`;
    }
    if (/^(?:true|false|null)$/.test(match)) {
      return `<span class="tk-bool">${match}</span>`;
    }
    return `<span class="tk-number">${match}</span>`;
  });
}

function updateBodyHighlight() {
  // a quebra extra no fim mantém a altura do <pre> igual à do textarea
  bodyHighlight.innerHTML = highlightJson(bodyInput.value) + "\n";
  syncBodyScroll();
}

function syncBodyScroll() {
  bodyHighlight.scrollTop = bodyInput.scrollTop;
  bodyHighlight.scrollLeft = bodyInput.scrollLeft;
}

bodyInput.addEventListener("scroll", syncBodyScroll);

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

// valida + repinta o highlight (chamado a cada edição)
function refresh() {
  validateJson();
  updateBodyHighlight();
}

bodyInput.addEventListener("input", refresh);

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
    refresh();
    return;
  }

  // Auto-fecha { [ "
  if (PAIRS[e.key] && start === end) {
    e.preventDefault();
    el.value =
      value.slice(0, start) + e.key + PAIRS[e.key] + value.slice(end);
    el.selectionStart = el.selectionEnd = start + 1;
    refresh();
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

    refresh();
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

function flashButton(btn, label) {
  const original = btn.dataset.original ?? btn.textContent;
  btn.dataset.original = original;
  btn.textContent = label;
  setTimeout(() => (btn.textContent = original), 1200);
}

formatBtn.addEventListener("click", () => {
  const text = bodyInput.value.trim();

  if (!text) {
    flashButton(formatBtn, "Campo vazio");
    return;
  }
  if (!validateJson(false)) {
    flashButton(formatBtn, "JSON inválido");
    return;
  }

  bodyInput.value = JSON.stringify(JSON.parse(text), null, 2);
  refresh();
  flashButton(formatBtn, "Formatado!");
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

    responseEl.innerHTML = highlightJson(JSON.stringify(payload.data, null, 2));
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
  const text = responseEl.textContent;

  try {
    // navigator.clipboard é bloqueado em alguns iframes (ex.: Bitrix24)
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  flashButton(copyBtn, "Copiado!");
});

/* ---------- Estado inicial ---------- */

updateBodyHighlight();
