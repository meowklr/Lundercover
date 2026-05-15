/* ══════════════════════════════════════════════════════
   LUNDERCOVER — Orchestrator (UI + Engine + Network)
   ══════════════════════════════════════════════════════ */

import { GameEngine } from "./engine.js";
import { NetworkManager } from "./network.js";

/* ─── Globals ────────────────────────────────────── */
const engine = new GameEngine();
const network = new NetworkManager();

let netMode = "salon";  // "salon" | "host" | "client"
let myName = "";
let clientWord = "";
let clientRoleName = "";

let pendingClientVictory = null;
let lastConfettiKey = "";
let toastTimer = null;

const HOLD_REVEAL_MS = 280;

const HIDDEN_WORD_LABEL = "Mot caché jusqu'à la fin";
const DISCUSSION_PHASE_TOKEN = "__DISCUSSION__";
const VICTORY_RECAP_TOKEN = "__VICTORY_RECAP__";

/* ─── DOM refs ──────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const setText = (el, v) => { if (el) el.textContent = v; };
const esc = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");

/* ─── SCREENS ───────────────────────────────────── */
const showScreen = (id, anim) => {
  const target = $("screen-" + id);
  if (!target) return;

  const current = document.querySelector(".screen.active");
  if (current === target) return;

  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active", "zoom", "exit"));

  target.classList.add("active");
  if (anim === "zoom") target.classList.add("zoom");

  window.scrollTo({ top: 0, behavior: "smooth" });

  // Peek button visibility
  const peekBtn = $("btn-peek");
  if (peekBtn) {
    const clientPeekScreens = ["discussion", "client-info", "client-mrwhite", "client-vote"];
    const localPeekScreens = ["discussion", "vote", "result"];
    let canPeek = false;
    if (netMode === "client") {
      canPeek = clientPeekScreens.includes(id) && !!clientWord;
    } else if (netMode === "host") {
      canPeek = localPeekScreens.includes(id) && !!(engine.state.mots && engine.state.mots[myName]);
    } else {
      canPeek = localPeekScreens.includes(id) && !!engine.state.mots;
    }
    peekBtn.classList.toggle("is-hidden", !canPeek);
  }

  updateNetworkBanner();
};

/* ─── TOAST ─────────────────────────────────────── */
const toast = (msg, variant) => {
  const el = $("toast");
  const msgEl = $("toast-msg");
  if (el && msgEl) {
    setText(msgEl, msg);
    el.className = "toast-base show";
    if (variant === "error") el.classList.add("toast-error");
    else if (variant === "success") el.classList.add("toast-success");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }
};

/* ─── NETWORK BANNER ────────────────────────────── */
let nbTimer = null;
let lastNetworkTone = "";
let lastNetworkText = "";

const showNetworkBanner = (text, tone, autoHideMs) => {
  const banner = $("network-banner");
  if (!banner) return;
  const sameState = banner.classList.contains("show") && lastNetworkTone === (tone || "online") && lastNetworkText === text;
  if (sameState) return;
  clearTimeout(nbTimer);
  setText(banner, text);
  lastNetworkTone = tone || "online";
  lastNetworkText = text;
  banner.className = "network-banner show " + lastNetworkTone;
  if (autoHideMs > 0) {
    nbTimer = setTimeout(() => {
      banner.classList.remove("show", "offline", "reconnect", "online");
      lastNetworkTone = "";
      lastNetworkText = "";
    }, autoHideMs);
  }
};

const updateNetworkBanner = () => {
  if (!navigator.onLine) {
    showNetworkBanner("Hors ligne", "offline", 0);
    return;
  }
  if ((netMode === "host" || netMode === "client") && network.roomRef && network.connected === false) {
    showNetworkBanner("Reconnexion\u2026", "reconnect", 0);
    return;
  }
  showNetworkBanner("Connect\u00e9", "online", 1400);
};

/* ─── CONFETTI ──────────────────────────────────── */
const launchConfetti = () => {
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch (_) {}
  const colors = ["#e11d48","#f59e0b","#10b981","#6366f1","#ec4899","#f97316"];
  for (let i = 0; i < 60; i++) {
    const c = document.createElement("div");
    c.className = "confetti-piece";
    c.style.left = Math.random() * 100 + "vw";
    c.style.background = colors[Math.floor(Math.random() * colors.length)];
    c.style.width = (6 + Math.random() * 8) + "px";
    c.style.height = (6 + Math.random() * 8) + "px";
    c.style.borderRadius = Math.random() > .5 ? "50%" : "2px";
    c.style.animationDuration = (1.5 + Math.random() * 2) + "s";
    c.style.animationDelay = (Math.random() * .8) + "s";
    document.body.appendChild(c);
    c.addEventListener("animationend", () => c.remove());
  }
};

const launchConfettiOnce = (key) => {
  const stableKey = String(key || "");
  if (stableKey && lastConfettiKey === stableKey) return;
  if (stableKey) lastConfettiKey = stableKey;
  launchConfetti();
};

/* ─── RENDER HELPERS ────────────────────────────── */
const appendNameWithBadges = (container, name, hostName) => {
  const nameSpan = document.createElement("span");
  nameSpan.className = "name-inline" + (name === myName ? " name-self" : "");
  setText(nameSpan, name);
  container.appendChild(nameSpan);
};

const renderOrderList = (listEl, order, hostName) => {
  listEl.innerHTML = "";
  order.forEach((name, i) => {
    const item = document.createElement("div");
    item.className = "order-item";
    item.style.animationDelay = (i * 0.06) + "s";
    const num = document.createElement("div"); num.className = "order-num"; setText(num, i + 1);
    const nd = document.createElement("div"); nd.className = "order-name";
    appendNameWithBadges(nd, name, hostName);
    item.appendChild(num); item.appendChild(nd);
    listEl.appendChild(item);
  });
};

const renderPlayerPills = (gridId, names, hostName, removable) => {
  const grid = $(gridId);
  if (!grid) return;
  grid.innerHTML = "";
  names.forEach(name => {
    const pill = document.createElement("div");
    pill.className = "player-pill";
    const span = document.createElement("span");
    span.title = name; setText(span, name);
    pill.appendChild(span);
    if (removable && name !== myName) {
      const btn = document.createElement("button");
      btn.textContent = "\u2715";
      btn.setAttribute("aria-label", "Supprimer " + esc(name));
      btn.addEventListener("click", () => {
        engine.removePlayer(name);
        renderSetupPlayers();
      });
      pill.appendChild(btn);
    }
    grid.appendChild(pill);
  });
};

/* ─── SETUP SCREEN ──────────────────────────────── */
const renderSetupPlayers = () => {
  setText($("player-count"), engine.players.length);
  renderPlayerPills("player-grid", engine.players, myName, netMode === "salon");
  renderSetupRecap();
};

const renderSetupRecap = () => {
  const note = $("setup-recap-note");
  if (!note) return;

  const dist = engine.getDistribution();
  const impMinus = $("btn-imp-minus");
  const impPlus = $("btn-imp-plus");
  const impCount = $("imp-count");

  if (impCount) setText(impCount, engine.config.nbImposteurs);

  // Compact one-line summary
  const parts = [];
  if (dist.nbCitoyens > 0) parts.push(dist.nbCitoyens + " citoyen" + (dist.nbCitoyens > 1 ? "s" : ""));
  if (dist.nbImposteurs > 0) parts.push(dist.nbImposteurs + " imposteur" + (dist.nbImposteurs > 1 ? "s" : ""));
  if (dist.nbEspion > 0) parts.push("espion");
  if (dist.nbMrWhite > 0) parts.push("mr white");
  if (dist.nbAgentDouble > 0) parts.push("agent double");

  const tooManyImpostors = dist.nbImposteurs + dist.nbAgentDouble >= dist.nbCitoyens;
  setText(note, dist.isValid
    ? (tooManyImpostors
      ? "Invalide : trop d\u2019imposteurs par rapport aux citoyens"
      : parts.join(" \u00b7 ") + " \u2014 " + dist.nbPlayers + " joueurs")
    : "Configuration invalide : besoin d'au moins 1 citoyen");
  note.classList.toggle("warn", !dist.isValid || tooManyImpostors);

  if (impMinus) impMinus.disabled = engine.config.nbImposteurs <= 1;
  if (impPlus) {
    const maxAllowed = engine._maxImposteursForSetup();
    impPlus.disabled = engine.config.nbImposteurs >= 4 || engine.config.nbImposteurs >= maxAllowed;
  }

  renderLobbyRecap();
};

const buildRoleCards = (container) => {
  if (!container || container.dataset.built) return;
  container.dataset.built = "1";
  Object.entries(GameEngine.ROLES_INFO).forEach(([key, info]) => {
    const card = document.createElement("div");
    card.className = "role-card";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-pressed", "false");
    card.setAttribute("data-role-key", key);
    card.addEventListener("click", () => {
      engine.toggleRole(key);
      const selected = engine.config.rolesActifs[key];
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-pressed", String(selected));
      renderSetupRecap();
      renderLobbyRecap();
    });
    card.addEventListener("keydown", e => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); card.click(); }
    });
    const div = document.createElement("div");
    div.className = "role-info";
    const n = document.createElement("div"); n.className = "name"; setText(n, (info.emoji ? info.emoji + " " : "") + info.nom);
    const d = document.createElement("div"); d.className = "desc"; setText(d, info.desc);
    div.appendChild(n); div.appendChild(d);
    card.appendChild(div);
    container.appendChild(card);
  });
};

/* ─── LOBBY RECAP (online) ──────────────────────── */
const renderLobbyRecap = () => {
  const note = $("lobby-setup-recap-note");
  if (!note) return;

  const dist = engine.getDistribution();

  setText($("lobby-imp-count"), engine.config.nbImposteurs);
  document.querySelectorAll("[data-diff-lobby]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.diffLobby === engine.config.difficulte);
  });

  const parts = [];
  if (dist.nbCitoyens > 0) parts.push(dist.nbCitoyens + " citoyen" + (dist.nbCitoyens > 1 ? "s" : ""));
  if (dist.nbImposteurs > 0) parts.push(dist.nbImposteurs + " imposteur" + (dist.nbImposteurs > 1 ? "s" : ""));
  if (dist.nbEspion > 0) parts.push("espion");
  if (dist.nbMrWhite > 0) parts.push("mr white");
  if (dist.nbAgentDouble > 0) parts.push("agent double");

  const tooManyImpostors = dist.nbImposteurs + dist.nbAgentDouble >= dist.nbCitoyens;
  setText(note, dist.isValid
    ? (tooManyImpostors
      ? "Invalide : trop d\u2019imposteurs par rapport aux citoyens"
      : parts.join(" \u00b7 ") + " \u2014 " + dist.nbPlayers + " joueurs")
    : "Configuration invalide : besoin d'au moins 1 citoyen");
  note.classList.toggle("warn", !dist.isValid || tooManyImpostors);

  const impMinus = $("lobby-btn-imp-minus");
  const impPlus = $("lobby-btn-imp-plus");
  if (impMinus) impMinus.disabled = engine.config.nbImposteurs <= 1;
  if (impPlus) {
    const maxAllowed = engine._maxImposteursForSetup();
    impPlus.disabled = engine.config.nbImposteurs >= 4 || engine.config.nbImposteurs >= maxAllowed;
  }

  if (netMode === "host" && network.isHostRoom) {
    network.broadcastToClients({ type: "config-preview", preview: dist });
  }
};

/* ─── CLIENT ROLE PREVIEW ───────────────────────── */
const renderClientRolePreview = (preview) => {
  setText($("client-role-validity"), preview && preview.isValid ? "Valide" : (preview ? "A ajuster" : "En attente"));
  const diffLabel = (preview && preview.difficulte === "difficile") ? "Dur" : "Facile";
  setText($("client-config-line"), preview
    ? "Mode " + diffLabel + " \u2022 Joueurs " + (preview.nbPlayers || 0)
    : "Configuration en attente\u2026");
  setText($("client-role-line"), preview
    ? "Civils " + (preview.nbCitoyens || 0) + " \u2022 Imposteurs " + (preview.nbImposteurs || 0) + " \u2022 Espion " + (preview.nbEspion || 0) + " \u2022 Mr White " + (preview.nbMrWhite || 0) + " \u2022 Agent Double " + (preview.nbAgentDouble || 0)
    : "L\u2019h\u00f4te ajuste les r\u00f4les\u2026");
};

/* ─── HOLD-TO-REVEAL ────────────────────────────── */
function mountHoldReveal(container, options) {
  const word = String((options && options.word) || "");
  const roleName = String((options && options.roleName) || "");
  const onReveal = options && typeof options.onReveal === "function" ? options.onReveal : null;
  const onConfirm = options && typeof options.onConfirm === "function" ? options.onConfirm : null;
  const confirmLabel = String((options && options.confirmLabel) || "");

  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "hold-reveal-wrap";

  if (roleName) {
    const roleBadge = document.createElement("div");
    roleBadge.className = "role-badge";
    setText(roleBadge, roleName);
    wrap.appendChild(roleBadge);
  }

  const hint = document.createElement("p");
  hint.className = "text-muted hold-reveal-hint";
  setText(hint, "Reste appuy\u00e9 pour r\u00e9v\u00e9ler le mot");
  wrap.appendChild(hint);

  const pressBtn = document.createElement("button");
  pressBtn.className = "btn-reveal hold-reveal-btn";
  pressBtn.type = "button";
  pressBtn.innerHTML = '<span class="eye">\uD83D\uDC41\uFE0F</span><span>Maintenir pour voir</span>';
  wrap.appendChild(pressBtn);

  const holdProgress = document.createElement("div");
  holdProgress.className = "hold-reveal-progress";
  holdProgress.innerHTML = '<div class="hold-reveal-progress-fill"></div>';
  wrap.appendChild(holdProgress);

  const wordEl = document.createElement("div");
  wordEl.className = "big-word hold-reveal-word";
  setText(wordEl, "\u2022\u2022\u2022\u2022\u2022");
  wrap.appendChild(wordEl);

  let isPressing = false, isRevealed = false, holdAnimFrame = 0, holdStartTs = 0;

  const setProgress = (ratio) => {
    const fill = holdProgress.querySelector(".hold-reveal-progress-fill");
    if (fill) fill.style.width = Math.min(100, Math.max(0, ratio * 100)) + "%";
  };

  const reveal = () => {
    if (isRevealed) return;
    isRevealed = true;
    isPressing = false;
    setText(wordEl, word || "?");
    wordEl.classList.add("is-visible");
    if (onReveal) { try { onReveal(); } catch (_) {} }
    pressBtn.classList.add("is-holding");
    hint.classList.add("is-holding");
    holdProgress.classList.add("is-complete");
    setProgress(1);
    setText(hint, "Rel\u00e2che pour cacher");
  };

  const hide = () => {
    isPressing = false;
    isRevealed = false;
    setText(wordEl, "\u2022\u2022\u2022\u2022\u2022");
    wordEl.classList.remove("is-visible");
    pressBtn.classList.remove("is-holding");
    hint.classList.remove("is-holding");
    holdProgress.classList.remove("is-active", "is-complete");
    setProgress(0);
    setText(hint, "Reste appuy\u00e9 pour r\u00e9v\u00e9ler le mot");
  };

  const stepHold = (ts) => {
    if (!isPressing) return;
    if (!holdStartTs) holdStartTs = ts;
    const elapsed = ts - holdStartTs;
    const ratio = elapsed / HOLD_REVEAL_MS;
    setProgress(ratio);
    if (ratio >= 1) { reveal(); holdAnimFrame = 0; return; }
    holdAnimFrame = requestAnimationFrame(stepHold);
  };

  const startHold = (e) => {
    if (isPressing || isRevealed) return;
    e.preventDefault();
    isPressing = true;
    holdStartTs = 0;
    holdProgress.classList.add("is-active");
    hint.classList.add("is-holding");
    setText(hint, "Maintiens pour r\u00e9v\u00e9ler");
    if (holdAnimFrame) cancelAnimationFrame(holdAnimFrame);
    holdAnimFrame = requestAnimationFrame(stepHold);
  };

  const endHold = () => {
    if (holdAnimFrame) { cancelAnimationFrame(holdAnimFrame); holdAnimFrame = 0; }
    if (isRevealed) { hide(); return; }
    isPressing = false;
    holdStartTs = 0;
    hint.classList.remove("is-holding");
    setText(hint, "Reste appuy\u00e9 pour r\u00e9v\u00e9ler le mot");
    holdProgress.classList.remove("is-active");
    setProgress(0);
  };

  pressBtn.addEventListener("pointerdown", startHold);
  ["pointerup", "pointercancel", "pointerleave"].forEach(ev => pressBtn.addEventListener(ev, endHold));
  pressBtn.addEventListener("contextmenu", e => e.preventDefault());

  if (onConfirm) {
    const okBtn = document.createElement("button");
    okBtn.className = "btn btn-secondary full";
    okBtn.style.marginTop = "1.2rem";
    setText(okBtn, confirmLabel || "OK");
    okBtn.addEventListener("click", onConfirm);
    wrap.appendChild(okBtn);
  }
  container.appendChild(wrap);
}

/* ══════════════════════════════════════════════════
   GAME FLOW
   ══════════════════════════════════════════════════ */

/* ─── START GAME ────────────────────────────────── */
function startGame() {
  const result = engine.startGame();
  if (result.error) return toast(result.error);

  if (netMode === "host" && network.roomRef) {
    network.updateMeta({ status: "started" });
    // Send word to each remote client
    engine.players.forEach(name => {
      if (name === myName) return;
      const role = engine.state.roles[name];
      const roleName = GameEngine.getSpecialRoleRevealLabel(role);
      network.sendToClientByName(name, { type: "reveal", mot: engine.state.mots[name], roleName });
    });
    showHostReveal();
  } else if (netMode === "salon") {
    showReveal();
  }
}

/* ─── HOST REVEAL ───────────────────────────────── */
function showHostReveal() {
  setText($("reveal-name"), myName);
  setText($("reveal-counter"), "Ton mot secret");
  const progress = $("reveal-progress");
  if (progress) progress.style.width = "100%";

  const area = $("word-area");
  area.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "btn-reveal";
  btn.innerHTML = '<span class="eye">\uD83D\uDC41\uFE0F</span><span>VOIR MON MOT</span>';
  btn.addEventListener("click", () => {
    const role = engine.state.roles[myName];
    const roleName = GameEngine.getSpecialRoleRevealLabel(role);
    mountHoldReveal(area, {
      word: engine.state.mots[myName],
      roleName,
      confirmLabel: "OK, commencer \u2192",
      onConfirm: () => startDiscussion()
    });
  });
  area.appendChild(btn);
  showScreen("reveal", "zoom");
}

/* ─── SALON REVEAL ──────────────────────────────── */
function showReveal() {
  const name = engine.players[engine.state.revealedIndex];
  setText($("reveal-name"), name);
  setText($("reveal-counter"), "Joueur " + (engine.state.revealedIndex + 1) + " sur " + engine.players.length);
  const progress = $("reveal-progress");
  if (progress) progress.style.width = ((engine.state.revealedIndex + 1) / engine.players.length * 100) + "%";

  const area = $("word-area");
  area.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "btn-reveal";
  btn.innerHTML = '<span class="eye">\uD83D\uDC41\uFE0F</span><span>VOIR MON MOT</span>';
  btn.addEventListener("click", () => revealWord());
  area.appendChild(btn);
  showScreen("reveal", "zoom");
}

function revealWord() {
  const name = engine.players[engine.state.revealedIndex];
  const area = $("word-area");
  const role = engine.state.roles[name];
  const roleName = GameEngine.getSpecialRoleRevealLabel(role);
  mountHoldReveal(area, {
    word: engine.state.mots[name],
    roleName,
    confirmLabel: "OK, suivant \u2192",
    onConfirm: () => {
      const next = engine.advanceReveal();
      if (next.done) startDiscussion();
      else showReveal();
    }
  });
}

/* ─── DISCUSSION ────────────────────────────────── */
function startDiscussion() {
  const data = engine.startDiscussion();
  setText($("turn-number"), data.turn);
  $("btn-go-vote").style.display = "";
  $("btn-back-discussion").style.display = "";
  renderOrderList($("order-list"), data.order, myName);
  showScreen("discussion");

  if (netMode === "host") {
    network.broadcastToClients({
      type: "phase",
      icon: "DISC",
      title: DISCUSSION_PHASE_TOKEN,
      sub: JSON.stringify({ turn: data.turn, order: data.order, hostName: myName })
    });
  }
}

/* ─── VOTE ──────────────────────────────────────── */
let voteInterval = null;

function showVote(candidates) {
  const voteData = engine.startVote(candidates);
  $("btn-back-discussion").style.display = netMode === "salon" ? "" : "none";

  const grid = $("vote-grid");
  grid.innerHTML = "";

  const subEl = grid.parentElement.querySelector(".text-muted");
  if (subEl) {
    setText(subEl, voteData.isRevote
      ? "\u00c9galit\u00e9 ! Re-vote entre les joueurs ex \u00e6quo."
      : "D\u00e9signez l\u2019imposteur \u00e0 \u00e9liminer. Votre vote est d\u00e9finitif.");
  }

  if (netMode === "salon") {
    // Salon: host clicks to eliminate directly
    engine.state.joueursEnVie.forEach(name => {
      const btn = createVoteButton(name, "Eliminer \u2715", false, () => {
        grid.querySelectorAll(".vote-btn").forEach(b => b.disabled = true);
        btn.classList.add("voted");
        handleElimination(name);
      });
      grid.appendChild(btn);
    });
    showScreen("vote", "zoom");
    return;
  }

  // Online: distributed voting
  const hostCandidates = voteData.candidates.filter(n => n !== myName);

  if (engine.state.joueursEnVie.includes(myName)) {
    if (hostCandidates.length > 0) {
      hostCandidates.forEach(name => {
        const btn = createVoteButton(name, "Voter \u2715", false, () => {
          engine.castVote(myName, name);
          grid.querySelectorAll(".vote-btn").forEach(b => b.disabled = true);
          btn.classList.add("voted");
          updateVoteProgress();
          checkAllVotesIn();
        });
        grid.appendChild(btn);
      });
    } else {
      engine.castVote(myName, null);
    }
  }

  // Progress counter
  const counter = document.createElement("div");
  counter.className = "vote-counter";
  counter.id = "host-vote-counter";
  counter.innerHTML = "Votes : <span class='count'>0</span> / " + voteData.candidates.length;
  grid.appendChild(counter);

  const bar = document.createElement("div");
  bar.className = "vote-tally-bar";
  bar.innerHTML = "<div class='vote-tally-fill' id='host-vote-fill' style='width:0%'></div>";
  grid.appendChild(bar);

  // Broadcast to clients
  if (netMode === "host") {
    network.broadcastToClients({
      type: "vote-start",
      players: voteData.candidates,
      revote: voteData.isRevote
    });
  }

  showScreen("vote", "zoom");

  // Vote timer
  const timerText = $("vote-timer-text");
  const timerFill = $("vote-timer-fill");
  const timerContainer = $("vote-timer");
  if (timerContainer) {
    timerContainer.style.display = "";
    timerContainer.classList.remove("is-urgent");
  }
  let remaining = Math.ceil(engine.config.voteTimeoutMs / 1000);
  if (timerText) timerText.textContent = remaining + "s";
  if (timerFill) timerFill.style.width = "100%";

  const voteTimer = setTimeout(() => {
    toast("Temps \u00e9coul\u00e9 ! D\u00e9pouillement\u2026");
    tallyVotes();
  }, engine.config.voteTimeoutMs);

  voteInterval = setInterval(() => {
    remaining--;
    if (remaining < 0) remaining = 0;
    if (timerText) timerText.textContent = remaining + "s";
    if (timerFill) timerFill.style.width = (remaining / (engine.config.voteTimeoutMs / 1000) * 100) + "%";
    if (remaining <= 10 && timerContainer) timerContainer.classList.add("is-urgent");
  }, 1000);

  // Store for cleanup
  engine.state.voteTimer = voteTimer;
  engine.state.voteInterval = voteInterval;
}

function createVoteButton(name, label, isClient, onClick) {
  const btn = document.createElement("button");
  btn.className = "vote-btn";
  const sp = document.createElement("span"); setText(sp, name);
  const lbl = document.createElement("span"); lbl.className = "eliminate-label"; setText(lbl, label);
  btn.appendChild(sp); btn.appendChild(lbl);
  btn.addEventListener("click", onClick);
  return btn;
}

function updateVoteProgress() {
  const prog = engine.getVoteProgress();
  const counter = $("host-vote-counter");
  if (counter) counter.innerHTML = "Votes : <span class='count'>" + prog.cast + "</span> / " + prog.total;
  const fill = $("host-vote-fill");
  if (fill) fill.style.width = (prog.cast / prog.total * 100) + "%";
}

function checkAllVotesIn() {
  if (!engine.state.expectedVoters) return;
  if (engine.allVotesIn()) {
    clearTimeout(engine.state.voteTimer);
    setTimeout(tallyVotes, 600);
  }
}

function tallyVotes() {
  clearTimeout(engine.state.voteTimer);
  if (engine.state.voteInterval) { clearInterval(engine.state.voteInterval); engine.state.voteInterval = null; }
  const timerContainer = $("vote-timer");
  if (timerContainer) timerContainer.style.display = "none";

  const result = engine.tallyVotes();

  if (result.noVotes) {
    toast("Aucun vote valide. Tour suivant.");
    if (netMode === "host") {
      network.broadcastToClients({
        type: "phase", icon: "?", title: "Aucun \u00e9limin\u00e9", sub: "Pas de majorit\u00e9. Le d\u00e9bat continue."
      });
    }
    $("btn-back-discussion").style.display = "";
    cleanupVoteState();
    startDiscussion();
    return;
  }

  if (result.tied) {
    if (netMode === "host") {
      network.broadcastToClients({
        type: "phase", icon: "RE", title: "\u00c9galit\u00e9 !", sub: "Re-vote entre : " + result.tied.join(", ")
      });
    }
    toast("\u00c9galit\u00e9 ! Re-vote entre " + result.tied.join(", "));
    cleanupVoteState();
    setTimeout(() => showVote(result.tied), 2000);
    return;
  }

  if (result.eliminated) {
    if (netMode === "host") {
      network.broadcastToClients({
        type: "vote-result",
        eliminated: result.eliminated,
        votes: result.votes || {}
      });
    }
    cleanupVoteState();
    $("btn-back-discussion").style.display = "";
    handleElimination(result.eliminated);
  }
}

function cleanupVoteState() {
  engine.state.expectedVoters = null;
  engine.state.votes = {};
  engine.state.voteCandidates = null;
  if (voteInterval) { clearInterval(voteInterval); voteInterval = null; }
  const timerContainer = $("vote-timer");
  if (timerContainer) { timerContainer.style.display = "none"; timerContainer.classList.remove("is-urgent"); }
}

/* ─── ELIMINATION ───────────────────────────────── */
function handleElimination(target) {
  const elimResult = engine.handleElimination(target);

  if (elimResult.mrWhite) {
    if (netMode === "host") {
      if (target === myName) {
        showMrWhiteGuess(target);
      } else {
        network.sendToClientByName(target, { type: "mrwhite-guess" });
        network.broadcastToClients({
          type: "phase", icon: "\uD83D\uDC7B", title: "Mr. White d\u00e9masqu\u00e9 !", sub: target + " tente de deviner le mot\u2026"
        });
        showScreen("result", "zoom");
        setText($("result-name"), target);
        setText($("result-role"), "Mr. White");
        setText($("result-word"), "???");
        $("btn-next-turn").style.display = "none";
      }
    } else {
      showMrWhiteGuess(target);
    }
    return;
  }

  if (elimResult.victory) {
    showVictory(elimResult.victory);
    return;
  }

  if (elimResult.result) {
    showResult(elimResult.eliminated);
  }
}

/* ─── RESULT ─────────────────────────────────────── */
function showResult(eliminated) {
  setText($("result-name"), eliminated);
  setText($("result-role"), GameEngine.ROLE_LABELS[engine.state.roles[eliminated]] || engine.state.roles[eliminated]);
  setText($("result-word"), HIDDEN_WORD_LABEL);
  $("btn-next-turn").style.display = "";
  showScreen("result", "zoom");

  if (netMode === "host") {
    network.broadcastToClients({
      type: "phase", icon: "X",
      title: eliminated + " \u00e9limin\u00e9 !",
      sub: "R\u00f4le : " + (GameEngine.ROLE_LABELS[engine.state.roles[eliminated]] || engine.state.roles[eliminated])
    });
  }
}

/* ─── MR WHITE GUESS ────────────────────────────── */
function showMrWhiteGuess(name) {
  setText($("mrwhite-name"), name);
  $("mrwhite-input").value = "";
  showScreen("mrwhite", "zoom");
}

const validateMrWhite = () => {
  const raw = $("mrwhite-input").value.trim().slice(0, 40);
  if (!raw) return toast("Entre un mot !");
  const result = engine.checkMrWhiteGuess(raw);
  if (result.correct) {
    showVictory("mr_white");
  } else if (result.victory) {
    showVictory(result.victory);
  } else {
    toast("Mauvais mot ! Mr. White est \u00e9limin\u00e9.");
    showResult(engine.state.mrWhiteNom);
  }
};

/* ─── VICTORY ────────────────────────────────────── */
function showVictory(winner) {
  const info = engine.getVictoryInfo();
  if (winner) engine.state.winner = winner;

  setText($("victory-title"), info.title);
  setText($("victory-subtitle"), info.sub);
  setText($("v-word-citoyen"), engine.state.motCitoyen);
  setText($("v-word-imposteur"), engine.state.motImposteur);

  const recap = $("recap-roles");
  recap.innerHTML = "";
  engine.players.forEach(name => {
    const rk = engine.state.roles[name] || "--";
    const row = document.createElement("div"); row.className = "recap-row";
    const ns = document.createElement("span");
    appendNameWithBadges(ns, name, myName);
    const tag = document.createElement("span"); tag.className = "role-tag tag-" + rk;
    setText(tag, GameEngine.ROLE_LABELS[rk] || rk);
    row.appendChild(ns); row.appendChild(tag);
    recap.appendChild(row);
  });

  // Stagger reveal
  recap.querySelectorAll(".recap-row").forEach((row, i) => {
    row.style.opacity = "0";
    row.style.transform = "translateY(8px)";
    row.style.transition = "opacity .3s ease, transform .3s ease";
    row.style.transitionDelay = (0.3 + i * 0.06) + "s";
    requestAnimationFrame(() => {
      row.style.opacity = "1";
      row.style.transform = "translateY(0)";
    });
  });

  $("btn-replay").style.display = "";
  setText($("btn-replay"), netMode === "host" ? "Relancer dans ce lobby" : "Rejouer une partie");

  $("btn-back-menu").style.display = "";
  showScreen("victory", "zoom");

  const confettiKey = [
    netMode === "client" ? "client" : "host",
    info.title || "",
    engine.state.motCitoyen || "",
    engine.state.motImposteur || ""
  ].join("|");
  launchConfettiOnce(confettiKey);

  if (netMode === "host") {
    network.broadcastToClients({ type: "victory", title: info.title, sub: info.sub, motCitoyen: engine.state.motCitoyen, motImposteur: engine.state.motImposteur });
    network.broadcastToClients({
      type: "phase", icon: "FIN", title: VICTORY_RECAP_TOKEN,
      sub: JSON.stringify({ roles: engine.state.roles, hostName: myName })
    });
  }

}
function doReplay() {
  if (netMode === "host" && network.roomRef) {
    returnOnlineMatchToLobby(myName);
    return;
  }
  if (netMode === "client" && network.roomRef) {
    network.sendToHost({ type: "rematch-request" });
    toast("Demande de relance envoy\u00e9e \u00e0 l\u2019h\u00f4te.");
    return;
  }
  // Salon mode
  if (netMode === "salon" && engine.players.length >= 3) {
    engine.reset({ keepPlayers: true, keepConfig: true });
    lastConfettiKey = "";
    startGame();
  } else if (netMode === "salon") {
    toast("Il faut au moins 3 joueurs pour relancer. Retour au menu.");
    engine.reset();
    showScreen("menu");
  } else {
    engine.reset();
    clearGameCache();
    showScreen("menu");
  }
}

/* ─── ONLINE LOBBY RETURN ───────────────────────── */
function returnOnlineMatchToLobby(requestedByName) {
  engine.reset({ keepPlayers: true, keepConfig: true });
  pendingClientVictory = null;
  lastConfettiKey = "";
  clientWord = "";
  clientRoleName = "";

  if (netMode === "host") {
    network.updateMeta({ status: "lobby" });
    const preview = engine.getDistribution();
    network.broadcastToClients({ type: "rematch-lobby", by: requestedByName, preview });
    renderLobbyPlayers();
    showScreen("lobby", "zoom");
    toast("Retour au lobby" + (requestedByName && requestedByName !== myName ? " demand\u00e9 par " + requestedByName : ""));
  }
}

/* ══════════════════════════════════════════════════
   ONLINE HOST LOGIC
   ══════════════════════════════════════════════════ */

function renderLobbyPlayers() {
  const grid = $("lobby-players");
  if (!grid) return;

  // Rebuild players from hostConns
  engine.setPlayers([myName]);
  engine.players = [myName];

  const playersRef = network.roomRef ? network.roomRef.child("players") : null;
  if (playersRef) {
    playersRef.once("value").then(snap => {
      const names = [myName];
      snap.forEach(ch => {
        if (ch.key === network.myUid) return;
        const v = ch.val() || {};
        if (v.name && v.connected !== false) names.push(v.name);
      });
      engine.setPlayers(names);
      renderLobby();
    });
  }
}

function renderLobby() {
  setText($("lobby-count"), engine.players.length);
  renderPlayerPills("lobby-players", engine.players, myName, false);
  const btn = $("btn-lobby-start");
  const missing = Math.max(0, 3 - engine.players.length);
  if (btn) {
    btn.disabled = missing > 0;
    setText(btn, missing > 0 ? "Lancer la partie (3 joueurs minimum)" : "Lancer la partie \u203a");
  }
  const waiting = $("lobby-waiting");
  if (waiting) {
    waiting.style.display = "block";
    if (missing > 0) setText(waiting, "Encore " + missing + " joueur(s) avant configuration.");
    else setText(waiting, "Effectif complet. L\u2019h\u00f4te peut configurer puis lancer.");
  }
  renderSetupRecap();
  renderLobbyRecap();
}

/* ─── HOST: handle client actions ────────────────── */
let uidToName = {};

function resolvePlayerName(uid) {
  return uidToName[uid] || null;
}

/** Send the current game state to a reconnecting player */
function syncClientToGame(uid) {
  const playerName = resolvePlayerName(uid);
  if (!playerName || !engine.state.roles[playerName]) return;

  // Send their word
  const role = engine.state.roles[playerName];
  const roleName = GameEngine.getSpecialRoleRevealLabel(role);
  network.sendToClient(uid, {
    type: "reveal", mot: engine.state.mots[playerName], roleName
  });

  // Send current phase info
  switch (engine.state.phase) {
    case "discussion":
      network.sendToClient(uid, {
        type: "phase", icon: "DISC", title: DISCUSSION_PHASE_TOKEN,
        sub: JSON.stringify({ turn: engine.state.turn, order: engine.state.talkingOrder, hostName: myName })
      });
      break;
    case "vote":
      network.sendToClient(uid, {
        type: "vote-start",
        players: engine.state.voteCandidates || engine.state.joueursEnVie,
        revote: !!engine.state.wasRevote
      });
      break;
    case "result":
      network.sendToClient(uid, {
        type: "phase", icon: "X",
        title: (engine.state.lastEliminated || "") + " \u00e9limin\u00e9 !",
        sub: "R\u00f4le : " + (GameEngine.ROLE_LABELS[engine.state.roles[engine.state.lastEliminated]] || "")
      });
      break;
    case "mrwhite":
      if (playerName === engine.state.mrWhiteNom) {
        network.sendToClient(uid, { type: "mrwhite-guess" });
      } else {
        network.sendToClient(uid, {
          type: "phase", icon: "\uD83D\uDC7B", title: "Mr. White d\u00e9masqu\u00e9 !",
          sub: engine.state.mrWhiteNom + " tente de deviner le mot\u2026"
        });
      }
      break;
    case "victory": {
      const info = engine.getVictoryInfo();
      network.sendToClient(uid, {
        type: "victory", title: info.title, sub: info.sub,
        motCitoyen: engine.state.motCitoyen, motImposteur: engine.state.motImposteur
      });
      network.sendToClient(uid, {
        type: "phase", icon: "FIN", title: VICTORY_RECAP_TOKEN,
        sub: JSON.stringify({ roles: engine.state.roles, hostName: myName })
      });
      break;
    }
  }
  toast(playerName + " s\u2019est reconnect\u00e9", "success");
}

network.on("messageReceived", (fromUid, data) => {
  if (netMode !== "host" || !data || !data.type) return;

  switch (data.type) {
    case "rematch-request":
      if (engine.state.phase === "victory") returnOnlineMatchToLobby("un joueur");
      break;

    case "mrwhite-answer": {
      if (!engine.state.mrWhiteNom) break;
      const guess = String(data.guess || "").trim().slice(0, 40);
      const result = engine.checkMrWhiteGuess(guess);
      if (result.correct) {
        showVictory("mr_white");
      } else if (result.victory) {
        showVictory(result.victory);
      } else {
        network.sendToClient(fromUid, {
          type: "phase", icon: "X", title: "Mauvais mot !", sub: "Mr. White est \u00e9limin\u00e9 d\u00e9finitivement."
        });
        showResult(engine.state.mrWhiteNom);
      }
      break;
    }

    case "vote": {
      const voterName = resolvePlayerName(fromUid);
      if (!voterName) break;
      const target = String(data.target || "").trim().slice(0, 20);
      const result = engine.castVote(voterName, target);
      if (result.ok) {
        network.sendToClient(fromUid, { type: "vote-ack" });
        updateVoteProgress();
        checkAllVotesIn();
      }
      break;
    }
  }
});

/* ─── HOST: player list changes ──────────────────── */
let _prevPlayerList = [];
network.on("playersChange", (list) => {
  uidToName = {};
  list.forEach(p => { uidToName[p.uid] = p.name; });
  if (netMode !== "host") return;

  const names = list.map(p => p.name);
  const isGameActive = engine.state.phase && engine.state.phase !== "victory";

  if (isGameActive) {
    // Game is running — don't change engine.players, but handle disconnects gracefully
    const newUids = list.map(p => p.uid);
    const prevUids = _prevPlayerList.map(p => p.uid);
    const reconnectedUids = newUids.filter(uid => !prevUids.includes(uid));
    const disconnectedUids = prevUids.filter(uid => !newUids.includes(uid));

    // Remove disconnected players from expected voters (so vote tally doesn't wait forever)
    if (engine.state.expectedVoters) {
      const disconnectedNames = disconnectedUids.map(uid => uidToName[uid]).filter(Boolean);
      engine.state.expectedVoters = engine.state.expectedVoters.filter(
        n => !disconnectedNames.includes(n)
      );
      updateVoteProgress();
      checkAllVotesIn();
    }

    // Sync reconnected players to current game state
    reconnectedUids.forEach(uid => syncClientToGame(uid));

    // Toast for disconnections
    const disconnected = disconnectedUids.map(uid => uidToName[uid] || "?").filter(Boolean);
    disconnected.forEach(name => {
      toast(name + " s\u2019est d\u00e9connect\u00e9", "error");
    });
  } else {
    // Lobby mode — update players normally
    engine.setPlayers(names);
    renderLobby();
  }

  _prevPlayerList = list;
});

/* ══════════════════════════════════════════════════
   ONLINE CLIENT LOGIC
   ══════════════════════════════════════════════════ */

function renderClientLobby(names, hostName) {
  setText($("client-lobby-count"), names.length);
  const grid = $("client-lobby-players");
  if (grid) {
    grid.innerHTML = "";
    names.forEach(name => {
      const pill = document.createElement("div");
      pill.className = "player-pill";
      const span = document.createElement("span");
      appendNameWithBadges(span, name, hostName || "");
      pill.appendChild(span);
      grid.appendChild(pill);
    });
  }
  const waiting = $("client-lobby-waiting");
  if (waiting) waiting.style.display = names.length < 3 ? "block" : "none";
  setText($("client-lobby-status"), "En attente du lancement par l\u2019h\u00f4te\u2026");
}

function handleClientData(data) {
  if (!data || !data.type) return;

  switch (data.type) {
    case "reveal":
      clientWord = data.mot || "";
      clientRoleName = data.roleName || "";
      setText($("client-player-name"), myName);
      mountHoldReveal($("client-reveal-area"), { word: clientWord, roleName: clientRoleName });
      showScreen("client-reveal", "zoom");
      break;

    case "phase":
      if (data.title === DISCUSSION_PHASE_TOKEN) {
        const payload = JSON.parse(data.sub || "{}");
        showClientDiscussion(payload || {});
        break;
      }
      if (data.title === VICTORY_RECAP_TOKEN) {
        const payload = JSON.parse(data.sub || "{}");
        pendingClientVictory = { ...(pendingClientVictory || {}), ...(payload || {}) };
        if (pendingClientVictory && pendingClientVictory.title) showClientVictory(pendingClientVictory);
        break;
      }
      setText($("client-info-icon"), data.icon || "INFO");
      setText($("client-info-title"), data.title || "");
      setText($("client-info-sub"), data.sub || "");
      showScreen("client-info", "zoom");
      break;

    case "mrwhite-guess":
      showScreen("client-mrwhite", "zoom");
      break;

    case "victory":
      pendingClientVictory = {
        ...(pendingClientVictory || {}),
        title: data.title || "Fin !", sub: data.sub || "",
        motCitoyen: data.motCitoyen || "?", motImposteur: data.motImposteur || "?"
      };
      showClientVictory(pendingClientVictory);
      break;

    case "vote-start": {
      const candidates = data.players || [];
      const grid = $("client-vote-grid");
      const sentDiv = $("client-vote-sent");
      const sentSub = $("client-vote-sent-sub");
      grid.innerHTML = "";
      grid.style.display = "";
      sentDiv.classList.add("is-hidden");
      if (sentSub) setText(sentSub, "En attente des autres joueurs\u2026");
      setText($("client-vote-sub"), data.revote ? "\u00c9galit\u00e9 ! Re-vote entre les joueurs ex \u00e6quo." : "Choisis qui \u00e9liminer. Ton vote est d\u00e9finitif.");

      const votable = candidates.filter(n => n !== myName);
      votable.forEach(name => {
        const btn = createVoteButton(name, "Voter \u2715", true, () => {
          network.sendToHost({ type: "vote", target: name });
          grid.querySelectorAll(".vote-btn").forEach(b => b.disabled = true);
          btn.classList.add("voted");
          if (sentSub) setText(sentSub, "Vote enregistr\u00e9 contre " + name + ". En attente des autres joueurs\u2026");
          setTimeout(() => {
            grid.style.display = "none";
            sentDiv.classList.remove("is-hidden");
          }, 400);
        });
        grid.appendChild(btn);
      });

      if (votable.length === 0) {
        grid.style.display = "none";
        sentDiv.classList.remove("is-hidden");
        if (sentSub) setText(sentSub, "Aucun vote requis pour toi. En attente des autres joueurs\u2026");
      }

      showScreen("client-vote", "zoom");
      break;
    }

    case "vote-ack":
      setText($("client-vote-sent-sub"), "Vote confirm\u00e9 par l\u2019h\u00f4te. En attente des autres joueurs\u2026");
      break;

    case "vote-result":
      setText($("client-info-icon"), "VOTE");
      setText($("client-info-title"), (data.eliminated || "") + " \u00e9limin\u00e9 !");
      setText($("client-info-sub"), "Le mot reste cach\u00e9 jusqu\u2019\u00e0 la fin de partie.");
      showScreen("client-info", "zoom");
      break;

    case "config-preview":
      renderClientRolePreview(data.preview || null);
      break;

    case "rematch-lobby":
      pendingClientVictory = null;
      clientWord = "";
      clientRoleName = "";
      lastConfettiKey = "";
      if (data.preview) renderClientRolePreview(data.preview);
      setText($("client-lobby-status"), "Nouvelle manche en pr\u00e9paration\u2026");
      showScreen("client-wait", "zoom");
      if (data.by) toast("Retour au lobby demand\u00e9 par " + data.by);
      break;
  }
}

function showClientDiscussion(data) {
  const order = Array.isArray(data.order) ? data.order : [];
  const turn = Number.isFinite(data.turn) ? data.turn : 1;
  const hostName = data.hostName || "";
  setText($("turn-number"), turn);
  renderOrderList($("order-list"), order, hostName);
  $("btn-go-vote").style.display = "none";
  $("btn-back-discussion").style.display = "none";
  showScreen("discussion");
}

function showClientVictory(data) {
  setText($("victory-title"), data.title || "Fin !");
  setText($("victory-subtitle"), data.sub || "");
  setText($("v-word-citoyen"), data.motCitoyen || "?");
  setText($("v-word-imposteur"), data.motImposteur || "?");

  const recap = $("recap-roles");
  recap.innerHTML = "";
  const roles = data.roles || {};
  const hostName = data.hostName || "";
  Object.keys(roles).forEach(name => {
    const rk = roles[name] || "--";
    const row = document.createElement("div"); row.className = "recap-row";
    const ns = document.createElement("span");
    appendNameWithBadges(ns, name, hostName);
    const tag = document.createElement("span"); tag.className = "role-tag tag-" + rk;
    setText(tag, GameEngine.ROLE_LABELS[rk] || rk);
    row.appendChild(ns); row.appendChild(tag);
    recap.appendChild(row);
  });

  recap.querySelectorAll(".recap-row").forEach((row, i) => {
    row.style.opacity = "0";
    row.style.transform = "translateY(8px)";
    row.style.transition = "opacity .3s ease, transform .3s ease";
    row.style.transitionDelay = (0.3 + i * 0.06) + "s";
    requestAnimationFrame(() => {
      row.style.opacity = "1";
      row.style.transform = "translateY(0)";
    });
  });

  $("btn-replay").style.display = "";
  setText($("btn-replay"), "Relancer dans ce lobby");
  $("btn-back-menu").style.display = "";
  showScreen("victory", "zoom");
  launchConfettiOnce(["client", data.title || "", data.motCitoyen || "", data.motImposteur || ""].join("|"));
}

/* ─── CLIENT: network events ────────────────────── */
network.on("playersChange", (list) => {
  if (netMode === "client") {
    const hostName = (list.find(p => p.isHost) || {}).name || "";
    renderClientLobby(list.map(p => p.name), hostName);
    // If the host disappears during a game, the roomClosed event will fire
  }
});

network.on("messageReceived", (fromUid, data) => {
  if (netMode === "client") handleClientData(data);
});

network.on("roomClosed", () => {
  toast("Le salon a \u00e9t\u00e9 ferm\u00e9 par l\u2019h\u00f4te.");
  network.leaveRoom();
  showScreen("menu");
});

network.on("connectionChange", (connected) => {
  updateNetworkBanner();
});

/* ══════════════════════════════════════════════════
   JOIN ROOM
   ══════════════════════════════════════════════════ */

async function attemptJoin() {
  const nameRaw = $("join-name").value.trim().slice(0, 20);
  const codeRaw = $("join-code").value.trim().toUpperCase();

  if (!nameRaw) return toast("Entre ton pseudo !");
  if (!GameEngine.validateName(nameRaw)) return toast("Pseudo invalide.");
  if (codeRaw.length !== 4 || !/^[A-Z]{4}$/.test(codeRaw)) return toast("Code invalide (4 lettres).");

  myName = nameRaw;
  toast("Connexion Firebase\u2026");

  try {
    const result = await network.joinRoom(codeRaw, myName);
    network.setLastJoinName(myName);

    setText($("client-room-code"), result.code);
    setText($("client-dossier-ref"), "DOS-" + result.code + "-" + new Date().toISOString().slice(0, 10).replace(/-/g, ""));
    renderClientRolePreview(null);
    showScreen("client-wait", "zoom");
  } catch (err) {
    const msg = NetworkManager.formatError(err);
    toast("Connexion \u00e9chou\u00e9e : " + msg, "error");
  }
}

/* ══════════════════════════════════════════════════
   HOST ROOM CREATION
   ══════════════════════════════════════════════════ */

async function startHosting() {
  myName = $("host-name-input").value.trim().slice(0, 20);
  if (!myName) return toast("Entre ton pseudo !");
  if (!GameEngine.validateName(myName)) return toast("Pseudo invalide.");

  const startBtn = $("btn-start");
  const prevLabel = startBtn.textContent;
  startBtn.disabled = true;
  startBtn.textContent = "Cr\u00e9ation du salon\u2026";

  try {
    network.setHostName(myName);
    network.setLastJoinName(myName);
    const code = await network.createRoom();

    // Load deck state
    const deckState = await network.getDeckState();
    engine.setDeckState(deckState);

    setText($("lobby-code"), code);
    setText($("lobby-dossier"), "DOS-" + code + "-" + new Date().toISOString().slice(0, 10).replace(/-/g, ""));
    showScreen("lobby", "zoom");
    renderLobby();
  } catch (err) {
    toast("Impossible de cr\u00e9er le salon : " + NetworkManager.formatError(err), "error");
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = prevLabel;
  }
}

/* ─── CLIENT MR WHITE GUESS ──────────────────────── */
function sendClientMrWhite() {
  const raw = $("client-mrwhite-input").value.trim().slice(0, 40);
  if (!raw) return toast("Entre un mot !");
  network.sendToHost({ type: "mrwhite-answer", guess: raw });
  setText($("client-info-icon"), "\u2026");
  setText($("client-info-title"), "R\u00e9ponse envoy\u00e9e");
  setText($("client-info-sub"), "En attente du r\u00e9sultat\u2026");
  showScreen("client-info", "zoom");
}

/* ══════════════════════════════════════════════════
   CACHE
   ══════════════════════════════════════════════════ */
function clearGameCache() {
  try {
    const key = localStorage.getItem("uc_player_key_v1") || "";
    Object.keys(localStorage).filter(k => /^uc_/i.test(k)).forEach(k => localStorage.removeItem(k));
    if (key) localStorage.setItem("uc_player_key_v1", key);
  } catch (_) {}
  try {
    Object.keys(sessionStorage).filter(k => /^uc_/i.test(k)).forEach(k => sessionStorage.removeItem(k));
  } catch (_) {}
  if ("caches" in window) {
    caches.keys().then(names => names.forEach(n => caches.delete(n)));
  }
}

/* ══════════════════════════════════════════════════
   PEEK OVERLAY
   ══════════════════════════════════════════════════ */
function initPeek() {
  const peekOverlay = $("peek-overlay");
  const peekStepSelect = $("peek-step-select");
  const peekStepWord = $("peek-step-word");
  if (peekStepWord) peekStepWord.style.display = "none";

  const closePeek = () => { if (peekOverlay) peekOverlay.classList.remove("show"); };
  $("peek-close")?.addEventListener("click", closePeek);
  $("peek-ok")?.addEventListener("click", closePeek);

  $("btn-peek")?.addEventListener("click", () => {
    if (!peekOverlay) return;

    if (netMode === "client" || netMode === "host") {
      if (peekStepSelect) peekStepSelect.style.display = "none";
      if (peekStepWord) peekStepWord.style.display = "";
      setText($("peek-name"), myName);
      const roleArea = $("peek-role-area");
      if (roleArea) roleArea.innerHTML = "";
      if (clientRoleName) {
        const badge = document.createElement("div");
        badge.className = "role-badge";
        setText(badge, clientRoleName);
        roleArea?.appendChild(badge);
      }
      const ownWord = netMode === "client" ? clientWord : (engine.state.mots && engine.state.mots[myName]) || "";
      setText($("peek-word-text"), ownWord);
    } else {
      if (peekStepWord) peekStepWord.style.display = "none";
      if (peekStepSelect) peekStepSelect.style.display = "";
      const grid = $("peek-players");
      if (grid) {
        grid.innerHTML = "";
        (engine.state.joueursEnVie || []).forEach(name => {
          const btn = document.createElement("button");
          btn.className = "btn btn-secondary full";
          btn.style.marginBottom = ".5rem";
          setText(btn, name);
          btn.addEventListener("click", () => {
            if (peekStepSelect) peekStepSelect.style.display = "none";
            if (peekStepWord) peekStepWord.style.display = "";
            setText($("peek-name"), name);
            const roleArea = $("peek-role-area");
            if (roleArea) roleArea.innerHTML = "";
            const role = engine.state.roles[name];
            if (GameEngine.SPECIAL_ROLES.has(role)) {
              const badge = document.createElement("div");
              badge.className = "role-badge";
              setText(badge, GameEngine.getSpecialRoleRevealLabel(role));
              roleArea.appendChild(badge);
            }
            setText($("peek-word-text"), engine.state.mots[name]);
          });
          grid.appendChild(btn);
        });
      }
    }
    peekOverlay.classList.add("show");
  });
}

/* ══════════════════════════════════════════════════
   EVENT BINDING
   ══════════════════════════════════════════════════ */
function init() {
  // Build role cards
  buildRoleCards($("role-cards"));
  buildRoleCards($("lobby-role-cards"));

  // Menu → Salon
  $("btn-mode-salon").addEventListener("click", () => {
    netMode = "salon";
    engine.reset();
    $("setup-players-card").style.display = "";
    $("setup-host-name-card").style.display = "none";
    $("setup-options-card").style.display = "";
    setText($("btn-start"), "Lancer la partie \u203a");
    showScreen("setup");
    renderSetupPlayers();
  });

  // Menu → Host
  $("btn-mode-host").addEventListener("click", () => {
    netMode = "host";
    engine.reset();
    $("setup-players-card").style.display = "none";
    $("setup-host-name-card").style.display = "block";
    $("setup-options-card").style.display = "none";
    setText($("btn-start"), "Cr\u00e9er le salon \u203a");
    showScreen("setup");
  });

  // Menu → Join
  $("btn-mode-join").addEventListener("click", () => {
    netMode = "client";
    showScreen("join", "zoom");
  });

  // Setup back
  $("btn-setup-back").addEventListener("click", () => {
    if (netMode === "host" && network.isHostRoom) {
      showScreen("lobby", "zoom");
      return;
    }
    showScreen("menu");
  });

  // Join back
  $("btn-join-back").addEventListener("click", () => {
    network.leaveRoom();
    showScreen("menu");
  });

  $("btn-client-wait-back").addEventListener("click", () => {
    network.leaveRoom();
    showScreen("menu");
  });

  // Join connect
  $("btn-join-connect").addEventListener("click", () => attemptJoin().catch(err =>
    toast("Impossible de rejoindre : " + NetworkManager.formatError(err), "error")
  ));
  $("join-code").addEventListener("keydown", e => { if (e.key === "Enter") {
    attemptJoin().catch(err => toast("Impossible de rejoindre : " + NetworkManager.formatError(err), "error"));
  }});

  // Lobby back
  $("btn-lobby-back").addEventListener("click", () => {
    network.broadcastToClients({ type: "kick" });
    network.updateMeta({ status: "closed" });
    network.leaveRoom();
    showScreen("menu");
  });

  $("btn-copy-code").addEventListener("click", () => {
    navigator.clipboard.writeText(network.roomCode).then(() => toast("Code copi\u00e9 !")).catch(() => {});
  });

  $("btn-lobby-start").addEventListener("click", () => {
    if (engine.players.length < 3) return toast("Il faut au moins 3 joueurs connect\u00e9s.");
    startGame();
  });

  // Add player (salon)
  $("btn-add-player").addEventListener("click", () => {
    const raw = $("player-input").value.trim();
    const result = engine.addPlayer(raw);
    if (result.ok) {
      $("player-input").value = "";
      renderSetupPlayers();
    } else {
      toast(result.error);
    }
  });
  $("player-input").addEventListener("keydown", e => { if (e.key === "Enter") $("btn-add-player").click(); });

  // Difficulty
  document.querySelectorAll("[data-diff]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-diff]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      engine.setDifficulty(btn.dataset.diff);
      renderSetupRecap();
    });
  });
  document.querySelectorAll("[data-diff-lobby]").forEach(btn => {
    btn.addEventListener("click", () => {
      engine.setDifficulty(btn.dataset.diffLobby);
      renderSetupRecap();
      renderLobbyRecap();
    });
  });

  // Imposteur count
  $("btn-imp-minus").addEventListener("click", () => {
    if (engine.config.nbImposteurs > 1) {
      engine.setImposteurCount(engine.config.nbImposteurs - 1);
      renderSetupRecap();
    }
  });
  $("btn-imp-plus").addEventListener("click", () => {
    const max = engine._maxImposteursForSetup();
    if (engine.config.nbImposteurs >= 4 || engine.config.nbImposteurs >= max) {
      if (engine.players.length >= 3) toast("Trop d\u2019imposteurs pour " + engine.players.length + " joueurs.");
      return;
    }
    engine.setImposteurCount(engine.config.nbImposteurs + 1);
    renderSetupRecap();
  });
  $("lobby-btn-imp-minus").addEventListener("click", () => {
    if (engine.config.nbImposteurs > 1) {
      engine.setImposteurCount(engine.config.nbImposteurs - 1);
      renderSetupRecap();
      renderLobbyRecap();
    }
  });
  $("lobby-btn-imp-plus").addEventListener("click", () => {
    const max = engine._maxImposteursForSetup();
    if (engine.config.nbImposteurs >= 4 || engine.config.nbImposteurs >= max) {
      if (engine.players.length >= 3) toast("Trop d\u2019imposteurs pour " + engine.players.length + " joueurs.");
      return;
    }
    engine.setImposteurCount(engine.config.nbImposteurs + 1);
    renderSetupRecap();
    renderLobbyRecap();
  });

  // Timer config
  document.querySelectorAll("[data-timer]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-timer]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      engine.setVoteTimeout(Number(btn.dataset.timer) * 1000);
    });
  });
  document.querySelectorAll("[data-timer-lobby]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-timer-lobby]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      engine.setVoteTimeout(Number(btn.dataset.timerLobby) * 1000);
    });
  });

  // Custom words
  const renderCustomWordsList = () => {
    const list = $("custom-words-list");
    const countEl = $("custom-words-count");
    if (!list || !countEl) return;
    const words = engine.config.customWords || [];
    list.innerHTML = "";
    words.forEach((w, i) => {
      const pill = document.createElement("div");
      pill.className = "player-pill";
      const span = document.createElement("span");
      setText(span, w.citoyen + " / " + w.imposteur);
      const del = document.createElement("button");
      del.textContent = "\u2715";
      del.addEventListener("click", () => {
        engine.config.customWords.splice(i, 1);
        renderCustomWordsList();
      });
      pill.appendChild(span); pill.appendChild(del);
      list.appendChild(pill);
    });
    setText(countEl, words.length + " paire(s) ajout\u00e9e(s)");
  };

  $("btn-add-custom-word")?.addEventListener("click", () => {
    const citoyen = $("custom-word-citoyen").value.trim().slice(0, 30);
    const imposteur = $("custom-word-imposteur").value.trim().slice(0, 30);
    if (!citoyen || !imposteur) return toast("Remplis les deux mots !");
    if (!engine.config.customWords) engine.config.customWords = [];
    if (engine.config.customWords.length >= 200) return toast("Maximum 200 paires.");
    engine.config.customWords.push({ citoyen, imposteur });
    $("custom-word-citoyen").value = "";
    $("custom-word-imposteur").value = "";
    renderCustomWordsList();
  });

  // Dark mode
  const initTheme = () => {
    const stored = localStorage.getItem("uc_theme");
    if (stored === "dark") document.body.classList.add("dark");
    else if (stored === "light") document.body.classList.remove("dark");
    else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.body.classList.add("dark");
    }
    const metaTheme = $("meta-theme-color");
    if (metaTheme) {
      metaTheme.content = document.body.classList.contains("dark") ? "#1a1c1e" : "#e9e2d5";
    }
  };
  initTheme();

  $("btn-theme")?.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    const isDark = document.body.classList.contains("dark");
    localStorage.setItem("uc_theme", isDark ? "dark" : "light");
    const metaTheme = $("meta-theme-color");
    if (metaTheme) metaTheme.content = isDark ? "#1a1c1e" : "#e9e2d5";
  });

  // Start / Create room
  $("btn-start").addEventListener("click", async () => {
    if (netMode === "host") {
      if (network.isHostRoom && network.roomRef) {
        if (engine.players.length < 3) return toast("Il faut au moins 3 joueurs connect\u00e9s.");
        startGame();
        return;
      }
      await startHosting();
      return;
    }
    // Salon mode
    if (engine.players.length < 3) return toast("Il faut au moins 3 joueurs.");
    startGame();
  });

  // Discussion → Vote
  $("btn-go-vote").addEventListener("click", () => showVote());
  $("btn-back-discussion").addEventListener("click", () => showScreen("discussion"));

  // Vote → Next turn
  $("btn-next-turn").addEventListener("click", () => startDiscussion());

  // Mr White validate
  $("btn-mrwhite-validate").addEventListener("click", validateMrWhite);
  $("mrwhite-input").addEventListener("keydown", e => { if (e.key === "Enter") validateMrWhite(); });

  // Client Mr White
  $("btn-client-mrwhite").addEventListener("click", sendClientMrWhite);
  $("client-mrwhite-input").addEventListener("keydown", e => { if (e.key === "Enter") sendClientMrWhite(); });

  // Replay
  $("btn-replay").addEventListener("click", doReplay);

  // Back to menu
  $("btn-back-menu").addEventListener("click", () => {
    network.leaveRoom().catch(() => {});
    engine.reset();
    lastConfettiKey = "";
    clientWord = "";
    clientRoleName = "";
    showScreen("menu");
  });

  // Clear cache
  $("btn-clear-cache").addEventListener("click", () => {
    clearGameCache();
    toast("Cache vid\u00e9 ! Rechargement\u2026");
    setTimeout(() => location.reload(), 800);
  });

  // Version tag
  const vTag = $("version-tag");
  if (vTag) {
    const d = new Date();
    setText(vTag, "v" + d.getFullYear() + "." + (d.getMonth() + 1) + "." + d.getDate());
  }

  // Rules disclosure
  initMenuRules();
  initPeek();

  // Network listeners
  window.addEventListener("online", updateNetworkBanner);
  window.addEventListener("offline", updateNetworkBanner);

  // Global error handler — catches unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    const msg = NetworkManager.formatError(event.reason);
    toast("Erreur : " + msg, "error");
    if (event.reason && event.reason.code) {
      try { console.error("[UC ERROR]", event.reason.code, event.reason.message); } catch (_) {}
    }
    event.preventDefault();
  });

  updateNetworkBanner();

  // Show menu
  showScreen("menu");
}

/* ─── RULES DISCLOSURE ──────────────────────────── */
let lastRulesMobileState = null;

const initMenuRules = () => {
  const rules = $("menu-rules");
  const toggle = $("menu-rules-toggle");
  if (!rules || !toggle) return;

  const setOpen = (open, animate = true) => {
    const content = $("menu-rules-content");
    if (!content) return;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");

    if (open) {
      rules.classList.add("open");
      const targetHeight = content.scrollHeight;
      if (!animate) {
        content.style.maxHeight = targetHeight + "px";
        content.style.opacity = "1";
        content.style.transform = "translateY(0)";
        return;
      }
      requestAnimationFrame(() => {
        content.style.maxHeight = targetHeight + "px";
        content.style.opacity = "1";
        content.style.transform = "translateY(0)";
      });
    } else {
      if (!animate) {
        rules.classList.remove("open");
        content.style.maxHeight = "0px";
        content.style.opacity = "0";
        content.style.transform = "translateY(-4px)";
        return;
      }
      requestAnimationFrame(() => {
        rules.classList.remove("open");
        content.style.maxHeight = "0px";
        content.style.opacity = "0";
        content.style.transform = "translateY(-4px)";
      });
    }
  };

  toggle.addEventListener("click", () => setOpen(!rules.classList.contains("open"), true));

  const syncRules = () => {
    if (!rules) return;
    const isMobile = window.matchMedia("(max-width: 640px)").matches;
    if (lastRulesMobileState === null) {
      lastRulesMobileState = isMobile;
      setOpen(!isMobile, false);
      return;
    }
    if (lastRulesMobileState && !isMobile) setOpen(true, true);
    lastRulesMobileState = isMobile;
  };

  window.addEventListener("resize", syncRules);
  syncRules();
};

// Auto-scroll inputs on mobile
document.querySelectorAll('input[type="text"], textarea').forEach(el => {
  el.addEventListener("focus", () => {
    const isTouch = window.matchMedia("(hover: none)").matches || ("ontouchstart" in window);
    if (!isTouch) return;
    setTimeout(() => { try { el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" }); } catch (_) {} }, 180);
  });
});

/* ─── BOOT ──────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", init);
