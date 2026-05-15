/* ══════════════════════════════════════════════════════
   LUNDERCOVER — Chat Manager (online discussion)
   ══════════════════════════════════════════════════════ */

/**
 * Manages the chat UI during online discussion phase.
 * Renders messages, handles input, integrates with NetworkManager.
 */
export class ChatManager {
  /**
   * @param {NetworkManager} network - The network manager instance
   * @param {Object} options
   * @param {string} options.containerId - DOM id for the chat container
   * @param {string} options.myName - Current player name
   * @param {Function} [options.onNewMessage] - Called when a new message arrives
   */
  constructor(network, options = {}) {
    this.network = network;
    this.myName = options.myName || "";
    this.containerId = options.containerId || "chat-container";
    this.messages = [];
    this._bound = false;
    this._listening = false;
    this._onNewMessage = options.onNewMessage || null;

    this._buildUI();
  }

  /* ─── SETUP ─────────────────────────────────────── */

  setPlayerName(name) {
    this.myName = name;
  }

  /** Creates the chat DOM if container exists */
  _buildUI() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    container.innerHTML = `
      <div class="chat-box">
        <div class="chat-messages" id="chat-messages">
          <p class="chat-hint text-muted">Chat de discussion — utilisez-le pour d\u00e9battre sans r\u00e9v\u00e9ler votre mot.</p>
        </div>
        <div class="chat-input-row">
          <input type="text" class="chat-input" id="chat-input"
                 placeholder="Votre message\u2026" maxlength="200" autocomplete="off" />
          <button class="btn btn-secondary chat-send-btn" id="chat-send-btn" title="Envoyer">
            \u27A4
          </button>
        </div>
      </div>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    if (this._bound) return;
    this._bound = true;

    const input = document.getElementById("chat-input");
    const sendBtn = document.getElementById("chat-send-btn");
    if (!input || !sendBtn) return;

    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      this.network.sendChatMessage(text);
      input.value = "";
    };

    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); send(); }
    });
  }

  /* ─── LISTENING ─────────────────────────────────── */

  startListening() {
    if (this._listening) return;
    this._listening = true;
    this.network.listenChat((from, text, ts) => {
      this._addMessage(from, text, ts);
    });
  }

  _addMessage(from, text, ts) {
    this.messages.push({ from, text, ts });
    this._renderMessage(from, text, ts);

    if (this._onNewMessage) {
      this._onNewMessage(from, text, ts);
    }
  }

  _renderMessage(from, text, ts) {
    const list = document.getElementById("chat-messages");
    if (!list) return;

    // Remove hint on first real message
    const hint = list.querySelector(".chat-hint");
    if (hint && this.messages.length >= 1) hint.remove();

    const div = document.createElement("div");
    div.className = "chat-msg" + (from === this.myName ? " chat-msg-self" : "");

    const nameSpan = document.createElement("span");
    nameSpan.className = "chat-msg-name";
    nameSpan.textContent = from === this.myName ? "toi" : from;

    const textSpan = document.createElement("span");
    textSpan.className = "chat-msg-text";
    textSpan.textContent = text;

    div.appendChild(nameSpan);
    div.appendChild(textSpan);
    list.appendChild(div);

    // Auto-scroll
    list.scrollTop = list.scrollHeight;
  }

  /* ─── SHOW / HIDE ───────────────────────────────── */

  show() {
    const container = document.getElementById(this.containerId);
    if (container) container.style.display = "";
  }

  hide() {
    const container = document.getElementById(this.containerId);
    if (container) container.style.display = "none";
  }

  clear() {
    this.messages = [];
    this._listening = false;
    const list = document.getElementById("chat-messages");
    if (list) {
      list.innerHTML = '<p class="chat-hint text-muted">Chat de discussion — utilisez-le pour d\u00e9battre sans r\u00e9v\u00e9ler votre mot.</p>';
    }
  }
}
