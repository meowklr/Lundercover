(() => {
  "use strict";

  /* ── Securite ── */
  const esc = (s) =>
    String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  const setText = (el, v) => { el.textContent = v; };

  /* ── Donnees (PAIRES dans words.js) ── */

  const ROLES_INFO = {
    espion:       { nom: "Espion",       emoji: "\u{1F575}\uFE0F", desc: "Conna\u00eet les DEUX mots. Joue avec les citoyens." },
    mr_white:     { nom: "Mr. White",    emoji: "\uD83E\uDECE",    desc: "N'a AUCUN mot. Doit deviner le mot citoyen s'il est \u00e9limin\u00e9." },
    agent_double: { nom: "Agent Double", emoji: "\uD83D\uDD04",    desc: "A le mot citoyen mais gagne avec les imposteurs." }
  };

  const ROLE_LABELS = {
    citoyen: "Citoyen", imposteur: "Imposteur",
    espion: "Espion", mr_white: "Mr. White", agent_double: "Agent Double"
  };

  const SPECIAL_ROLES = new Set(["espion", "mr_white", "agent_double"]);
  const getSpecialRoleRevealLabel = (role) =>
    SPECIAL_ROLES.has(role) ? ("ROLE SPECIAL : " + ROLES_INFO[role].nom.toUpperCase()) : "";

  /* ── Etat ── */
  let players = [];
  let config = {
    nbImposteurs: 1, difficulte: "facile",
    rolesActifs: { espion: false, mr_white: false, agent_double: false }
  };
  let game = {};
  let mrWhiteAliveSnapshot = [];
  let clientWord = "";
  let clientRoleName = "";
  let pendingClientVictory = null;
  let lastConfettiKey = "";
  let hostConfigFromLobby = false;

  /* ── Mode reseau ── */
  let netMode = "salon";   // "salon" | "host" | "client"
  let hostConns = {};      // host: { uid: { name } }
  let clientConn = null;   // compatibility object: { send(data) }
  let myName = "";
  let roomCode = "";
  let db = null;
  let auth = null;
  let myUid = "";
  let roomRef = null;
  let roomListenerRefs = [];
  let isHostRoom = false;
  let presenceHeartbeatTimer = null;
  let firebaseInfoConnected = null;
  let networkBannerTimer = null;
  let lastNetworkTone = "";
  let lastNetworkText = "";
  const pairDeckState = {
    facile: { deck: [], lastKey: "" },
    difficile: { deck: [], lastKey: "" }
  };

  const CODE_REGEX = /^[A-Z]{4}$/;
  const NAME_REGEX = /^[\p{L}\p{N} '\-]+$/u;
  const PLAYER_KEY_STORAGE = "uc_player_key_v1";
  const HIDDEN_WORD_LABEL = "Mot caché jusqu'à la fin";
  const DISCUSSION_PHASE_TOKEN = "__DISCUSSION__";
  const VICTORY_RECAP_TOKEN = "__VICTORY_RECAP__";
  const FIREBASE_CONNECT_TIMEOUT_MS = 12000;
  const FIREBASE_READ_TIMEOUT_MS = 10000;
  const PRESENCE_HEARTBEAT_MS = 15000;
  const HOLD_REVEAL_MS = 280;

  const DEBUG_MODE = (() => {
    try {
      return /(?:\?|&)debug=1(?:&|$)/.test(window.location.search) || localStorage.getItem("uc_debug") === "1";
    } catch (_) {
      return false;
    }
  })();

  const debugLog = (...args) => {
    if (!DEBUG_MODE) return;
    try { console.log("[UC DEBUG]", ...args); } catch (_) {}
  };

  let lastRulesMobileState = null;
  const setMenuRulesOpen = (open, animate = true) => {
    const rules = document.getElementById("menu-rules");
    const toggle = document.getElementById("menu-rules-toggle");
    const content = document.getElementById("menu-rules-content");
    if (!rules || !toggle || !content) return;

    const isOpen = rules.classList.contains("open");
    if (open === isOpen && !animate) return;

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
      const startHeight = parseFloat(content.style.maxHeight || "0") || 0;
      content.style.maxHeight = startHeight + "px";
      content.style.opacity = startHeight > 0 ? "1" : "0";
      content.style.transform = startHeight > 0 ? "translateY(0)" : "translateY(-4px)";
      requestAnimationFrame(() => {
        content.style.maxHeight = targetHeight + "px";
        content.style.opacity = "1";
        content.style.transform = "translateY(0)";
      });
      return;
    }

    const startHeight = content.scrollHeight;
    if (!animate) {
      rules.classList.remove("open");
      content.style.maxHeight = "0px";
      content.style.opacity = "0";
      content.style.transform = "translateY(-4px)";
      return;
    }

    content.style.maxHeight = startHeight + "px";
    content.style.opacity = "1";
    content.style.transform = "translateY(0)";
    requestAnimationFrame(() => {
      rules.classList.remove("open");
      content.style.maxHeight = "0px";
      content.style.opacity = "0";
      content.style.transform = "translateY(-4px)";
    });
  };

  const initMenuRulesDisclosure = () => {
    const rules = document.getElementById("menu-rules");
    const toggle = document.getElementById("menu-rules-toggle");
    if (!rules || !toggle) return;

    toggle.addEventListener("click", () => {
      setMenuRulesOpen(!rules.classList.contains("open"), true);
    });
  };

  const syncMenuRulesDisclosure = () => {
    const rules = document.getElementById("menu-rules");
    if (!rules) return;
    try {
      const isMobile = window.matchMedia("(max-width: 640px)").matches;
      if (lastRulesMobileState === null) {
        lastRulesMobileState = isMobile;
        setMenuRulesOpen(!isMobile, false);
        return;
      }

      if (lastRulesMobileState && !isMobile) {
        setMenuRulesOpen(true, true);
      }
      lastRulesMobileState = isMobile;
    } catch (_) {
      setMenuRulesOpen(true, false);
    }
  };

  const clearNetworkBannerTimer = () => {
    if (networkBannerTimer) {
      clearTimeout(networkBannerTimer);
      networkBannerTimer = null;
    }
  };

  const showNetworkBanner = (text, tone, autoHideMs) => {
    const banner = document.getElementById("network-banner");
    if (!banner) return;

    const sameState = banner.classList.contains("show") && lastNetworkTone === (tone || "online") && lastNetworkText === text;
    if (sameState) return;

    clearNetworkBannerTimer();
    setText(banner, text);
    lastNetworkTone = tone || "online";
    lastNetworkText = text;
    banner.className = "network-banner show " + lastNetworkTone;
    if (autoHideMs > 0) {
      networkBannerTimer = setTimeout(() => {
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

    if ((netMode === "host" || netMode === "client") && roomRef && firebaseInfoConnected === false) {
      showNetworkBanner("Reconnexion…", "reconnect", 0);
      return;
    }

    showNetworkBanner("Connecté", "online", 1400);
  };

  const refreshLobbyHints = () => {
    const hostWaiting = document.getElementById("lobby-waiting");
    const hostStartBtn = document.getElementById("btn-lobby-start");
    const clientStatus = document.getElementById("client-lobby-status");
    const clientWaiting = document.getElementById("client-lobby-waiting");
    const clientCount = Number((document.getElementById("client-lobby-count") || {}).textContent || 0);

    if (firebaseInfoConnected === false) {
      if (hostWaiting && netMode === "host") {
        setText(hostWaiting, "Connexion instable… reconnexion au salon en cours.");
        hostWaiting.style.display = "block";
      }
      if (clientStatus && clientWaiting && netMode === "client") {
        setText(clientStatus, "Reconnexion au salon…");
        setText(clientWaiting, "Ne ferme pas l'application.");
        clientWaiting.style.display = "block";
      }
      return;
    }

    if (hostWaiting && hostStartBtn && netMode === "host") {
      const total = players.length;
      const missing = Math.max(0, 3 - total);
      if (missing > 0) {
        setText(hostWaiting, "Encore " + missing + " joueur(s) avant configuration.");
        hostWaiting.style.display = "block";
      } else {
        setText(hostWaiting, "Effectif complet. L'hôte peut configurer puis lancer.");
        hostWaiting.style.display = "block";
      }
    }

    if (clientStatus && clientWaiting && netMode === "client") {
      const missing = Math.max(0, 3 - clientCount);
      if (missing > 0) {
        setText(clientStatus, "En attente du lancement par l'hôte… (" + missing + " joueur(s) manquant(s))");
        setText(clientWaiting, "Le salon se remplit…");
        clientWaiting.style.display = "block";
      } else {
        setText(clientStatus, "Salon prêt. En attente du lancement par l'hôte…");
        clientWaiting.style.display = "none";
      }
    }
  };

  const makeLocalPlayerKey = () => {
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch (_) {}
    return "pk_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  };

  const getOrCreatePlayerKey = () => {
    try {
      const existing = localStorage.getItem(PLAYER_KEY_STORAGE);
      if (existing && existing.length >= 12) return existing;
      const created = makeLocalPlayerKey();
      localStorage.setItem(PLAYER_KEY_STORAGE, created);
      return created;
    } catch (_) {
      return makeLocalPlayerKey();
    }
  };

  const myPlayerKey = getOrCreatePlayerKey();

  const detachRoomListeners = () => {
    roomListenerRefs.forEach(({ ref, event, cb }) => {
      try { ref.off(event, cb); } catch (_) {}
    });
    roomListenerRefs = [];
  };

  const onRoom = (ref, event, cb) => {
    ref.on(event, cb);
    roomListenerRefs.push({ ref, event, cb });
  };

  const firebaseReady = async () => {
    if (db && auth && myUid) return;
    if (!window.firebase) throw new Error("firebase-sdk-missing");
    if (!window.FIREBASE_CONFIG) throw new Error("firebase-config-missing");
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    db = firebase.database();
    auth = firebase.auth();
    if (!auth.currentUser) await auth.signInAnonymously();
    myUid = auth.currentUser.uid;

    const infoRef = db.ref(".info/connected");
    infoRef.off("value");
    infoRef.on("value", (snap) => {
      firebaseInfoConnected = !!snap.val();
      updateNetworkBanner();
      refreshLobbyHints();
    });
  };

  const roomPath = (code) => "rooms/" + code;

  const buildDossierRef = (code) => {
    const c = String(code || "----").toUpperCase();
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return "DOS-" + c + "-" + stamp;
  };

  const withTimeout = (promise, timeoutMs, code) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error("timeout");
        err.code = code || "timeout";
        reject(err);
      }, timeoutMs);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });

  const serverTimestamp = () => {
    try {
      return firebase.database.ServerValue.TIMESTAMP;
    } catch (_) {
      return Date.now();
    }
  };

  const stopPresenceHeartbeat = () => {
    if (presenceHeartbeatTimer) {
      clearInterval(presenceHeartbeatTimer);
      presenceHeartbeatTimer = null;
    }
  };

  const startPresenceHeartbeat = () => {
    stopPresenceHeartbeat();
    if (!roomRef || !myUid) return;
    const meRef = roomRef.child("players").child(myUid);
    const ping = () => {
      meRef.update({ connected: true, lastSeen: serverTimestamp() }).catch(() => {});
    };
    ping();
    presenceHeartbeatTimer = setInterval(ping, PRESENCE_HEARTBEAT_MS);
  };

  const hasStartedOnlineGame = () => {
    return !!(netMode === "host" && game && game.roles && Object.keys(game.roles).length);
  };

  function syncClientToCurrentGame(uid, playerName, playerKey) {
    if (!uid || !playerName || !hasStartedOnlineGame()) return;

    if (!game.playerKeys || game.playerKeys[playerName] !== playerKey) {
      sendMessageToUid(uid, { type: "kick" });
      return;
    }

    if (!game.roles[playerName]) {
      sendMessageToUid(uid, { type: "kick" });
      if (roomRef) roomRef.child("players").child(uid).remove().catch(() => {});
      return;
    }

    const role = game.roles[playerName];
    const roleName = getSpecialRoleRevealLabel(role);

    sendMessageToUid(uid, {
      type: "reveal",
      mot: game.mots[playerName] || "",
      roleName
    });

    switch (game.phase) {
      case "discussion":
        sendMessageToUid(uid, {
          type: "phase",
          icon: "DISC",
          title: DISCUSSION_PHASE_TOKEN,
          sub: JSON.stringify({
            turn: game.turn || 1,
            order: game.talkingOrder || game.joueursEnVie || [],
            hostName: myName
          })
        });
        break;

      case "vote":
        sendMessageToUid(uid, {
          type: "vote-start",
          players: game.voteCandidates || game.joueursEnVie || [],
          revote: !!game.wasRevote
        });
        break;

      case "result": {
        const eliminated = game.lastEliminated || "";
        if (eliminated) {
          sendMessageToUid(uid, {
            type: "phase",
            icon: "X",
            title: eliminated + " éliminé !",
            sub: "Rôle : " + (ROLE_LABELS[game.roles[eliminated]] || game.roles[eliminated] || "")
          });
        }
        break;
      }

      case "mrwhite":
        if (playerName === game.mrWhiteNom) {
          sendMessageToUid(uid, { type: "mrwhite-guess" });
        } else if (game.mrWhiteNom) {
          sendMessageToUid(uid, {
            type: "phase",
            icon: "👻",
            title: "Mr. White démasqué !",
            sub: game.mrWhiteNom + " tente de deviner le mot…"
          });
        }
        break;

      case "victory": {
        const T = {
          citoyens:   { title: "Victoire Citoyenne !",  sub: "Le groupe a survécu à l'infiltration." },
          imposteurs: { title: "L'Imposteur Gagne !",   sub: "L'infiltration a été un succès total." },
          mr_white:   { title: "Mr. White l'emporte !", sub: "L'infiltration a échoué mais Mr. White a tout compris." }
        };
        const t = T[game.winner] || { title: "Fin !", sub: "" };
        sendMessageToUid(uid, {
          type: "victory",
          title: t.title,
          sub: t.sub,
          motCitoyen: game.motCitoyen || "?",
          motImposteur: game.motImposteur || "?"
        });
        sendMessageToUid(uid, {
          type: "phase",
          icon: "FIN",
          title: VICTORY_RECAP_TOKEN,
          sub: JSON.stringify({
            roles: game.roles || {},
            hostName: myName
          })
        });
        break;
      }

      default:
        break;
    }
  }

  const safeParseJson = (raw, fallback = null) => {
    if (typeof raw !== "string") return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  };

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
    setText(hint, "Reste appuyé pour révéler le mot");
    wrap.appendChild(hint);

    const pressBtn = document.createElement("button");
    pressBtn.className = "btn-reveal hold-reveal-btn";
    pressBtn.type = "button";
    const eye = document.createElement("span"); eye.className = "eye"; eye.textContent = "\uD83D\uDC41\uFE0F";
    const label = document.createElement("span"); setText(label, "Maintenir pour voir");
    pressBtn.appendChild(eye);
    pressBtn.appendChild(label);
    wrap.appendChild(pressBtn);

    const holdProgress = document.createElement("div");
    holdProgress.className = "hold-reveal-progress";
    const holdProgressFill = document.createElement("div");
    holdProgressFill.className = "hold-reveal-progress-fill";
    holdProgress.appendChild(holdProgressFill);
    wrap.appendChild(holdProgress);

    const wordEl = document.createElement("div");
    wordEl.className = "big-word hold-reveal-word";
    setText(wordEl, "•••••");
    wrap.appendChild(wordEl);

    let isPressing = false;
    let isRevealed = false;
    let holdAnimFrame = 0;
    let holdStartTs = 0;

    const setProgress = (ratio) => {
      const clamped = Math.max(0, Math.min(1, ratio));
      holdProgressFill.style.width = (clamped * 100) + "%";
    };

    const resetProgress = () => {
      holdProgress.classList.remove("is-active", "is-complete");
      setProgress(0);
    };

    const reveal = () => {
      if (isRevealed) return;
      isRevealed = true;
      isPressing = false;
      setText(wordEl, word || "?");
      wordEl.classList.add("is-visible");
      if (onReveal) {
        try { onReveal(); } catch (_) {}
      }
      pressBtn.classList.add("is-holding");
      hint.classList.add("is-holding");
      holdProgress.classList.add("is-complete");
      setProgress(1);
      setText(hint, "Relâche pour cacher");
    };

    const hide = () => {
      isPressing = false;
      isRevealed = false;
      setText(wordEl, "•••••");
      wordEl.classList.remove("is-visible");
      pressBtn.classList.remove("is-holding");
      hint.classList.remove("is-holding");
      resetProgress();
      setText(hint, "Reste appuyé pour révéler le mot");
    };

    const stepHold = (ts) => {
      if (!isPressing) return;
      if (!holdStartTs) holdStartTs = ts;

      const elapsed = ts - holdStartTs;
      const ratio = elapsed / HOLD_REVEAL_MS;
      setProgress(ratio);

      if (ratio >= 1) {
        reveal();
        holdAnimFrame = 0;
        return;
      }

      holdAnimFrame = requestAnimationFrame(stepHold);
    };

    const startHold = () => {
      if (isPressing || isRevealed) return;
      isPressing = true;
      holdStartTs = 0;
      holdProgress.classList.add("is-active");
      hint.classList.add("is-holding");
      setText(hint, "Maintiens pour révéler");
      if (holdAnimFrame) cancelAnimationFrame(holdAnimFrame);
      holdAnimFrame = requestAnimationFrame(stepHold);
    };

    const endHold = () => {
      if (holdAnimFrame) {
        cancelAnimationFrame(holdAnimFrame);
        holdAnimFrame = 0;
      }
      if (isRevealed) {
        hide();
        return;
      }
      isPressing = false;
      holdStartTs = 0;
      hint.classList.remove("is-holding");
      setText(hint, "Reste appuyé pour révéler le mot");
      resetProgress();
    };

    if (window.PointerEvent) {
      pressBtn.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        pressBtn.setPointerCapture && pressBtn.setPointerCapture(e.pointerId);
        startHold();
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => {
        pressBtn.addEventListener(ev, endHold);
      });
    } else {
      pressBtn.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        startHold();
      });
      pressBtn.addEventListener("mouseup", endHold);
      pressBtn.addEventListener("mouseleave", endHold);
      pressBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startHold(); }, { passive: false });
      pressBtn.addEventListener("touchend", endHold);
      pressBtn.addEventListener("touchcancel", endHold);
    }

    pressBtn.addEventListener("contextmenu", (e) => e.preventDefault());

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

  function appendNameWithBadges(container, name, hostName) {
    const nameSpan = document.createElement("span");
    nameSpan.className = "name-inline";
    setText(nameSpan, name);
    container.appendChild(nameSpan);

    if (name === myName) {
      const me = document.createElement("span");
      me.className = "name-badge";
      setText(me, "toi");
      container.appendChild(me);
    }
    if (hostName && name === hostName) {
      const host = document.createElement("span");
      host.className = "name-badge host";
      setText(host, "hôte");
      container.appendChild(host);
    }
  }

  function renderOrderList(listEl, order, hostName) {
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
  }

  function renderClientWaitLobby(names, hostName) {
    const grid = document.getElementById("client-lobby-players");
    const countEl = document.getElementById("client-lobby-count");
    const waitingEl = document.getElementById("client-lobby-waiting");
    const statusEl = document.getElementById("client-lobby-status");

    if (!grid || !countEl || !waitingEl || !statusEl) return;

    const list = Array.isArray(names) ? names : [];
    setText(countEl, list.length);
    grid.innerHTML = "";

    list.forEach((name) => {
      const pill = document.createElement("div");
      pill.className = "player-pill";
      const span = document.createElement("span");
      appendNameWithBadges(span, name, hostName || "");
      pill.appendChild(span);
      grid.appendChild(pill);
    });

    waitingEl.style.display = list.length < 3 ? "block" : "none";
    setText(statusEl, "En attente du lancement par l'hôte…");
    refreshLobbyHints();
  }

  function showClientDiscussion(data) {
    const order = Array.isArray(data.order) ? data.order : [];
    const turn = Number.isFinite(data.turn) ? data.turn : 1;
    const hostName = data.hostName || "";

    setText(document.getElementById("turn-number"), turn);
    renderOrderList(document.getElementById("order-list"), order, hostName);

    document.getElementById("btn-go-vote").style.display = "none";
    document.getElementById("btn-back-discussion").style.display = "none";
    showScreen("discussion");
  }

  function showClientVictory(data) {
    setText(document.getElementById("victory-title"), data.title || "Fin !");
    setText(document.getElementById("victory-subtitle"), data.sub || "");
    setText(document.getElementById("v-word-citoyen"), data.motCitoyen || "?");
    setText(document.getElementById("v-word-imposteur"), data.motImposteur || "?");

    const recap = document.getElementById("recap-roles");
    recap.innerHTML = "";
    const roles = data.roles || {};
    const hostName = data.hostName || "";
    Object.keys(roles).forEach((name) => {
      const rk = roles[name] || "--";
      const row = document.createElement("div"); row.className = "recap-row";
      const ns = document.createElement("span");
      appendNameWithBadges(ns, name, hostName);
      const tag = document.createElement("span"); tag.className = "role-tag tag-" + rk;
      setText(tag, ROLE_LABELS[rk] || rk);
      row.appendChild(ns); row.appendChild(tag);
      recap.appendChild(row);
    });

    const replayBtn = document.getElementById("btn-replay");
    replayBtn.style.display = "";
    setText(replayBtn, "Relancer dans ce lobby");
    showScreen("victory", "zoom");
    const confettiKey = [
      "client",
      data.title || "",
      data.motCitoyen || "",
      data.motImposteur || ""
    ].join("|");
    launchConfettiOnce(confettiKey);
  }

  function normalizeDeck(rawDeck) {
    const list = Array.isArray(rawDeck) ? rawDeck : (rawDeck ? Object.values(rawDeck) : []);
    return list
      .filter((it) => it && typeof it.key === "string" && Array.isArray(it.pair) && it.pair.length === 2)
      .map((it) => ({ key: it.key, pair: [String(it.pair[0]), String(it.pair[1])] }));
  }

  async function loadPairDeckStateFromRoom() {
    if (!roomRef) return;
    const snap = await roomRef.child("pairDeckState").once("value");
    const saved = snap.val() || {};
    ["facile", "difficile"].forEach((difficulty) => {
      const src = saved[difficulty] || {};
      pairDeckState[difficulty] = {
        deck: normalizeDeck(src.deck),
        lastKey: typeof src.lastKey === "string" ? src.lastKey : ""
      };
    });
  }

  function persistPairDeckStateToRoom() {
    if (!roomRef || !isHostRoom) return;
    const payload = {};
    ["facile", "difficile"].forEach((difficulty) => {
      const state = pairDeckState[difficulty] || { deck: [], lastKey: "" };
      payload[difficulty] = {
        lastKey: state.lastKey || "",
        deck: (state.deck || []).map((it) => ({ key: it.key, pair: it.pair }))
      };
    });
    roomRef.child("pairDeckState").set(payload).catch(() => {});
  }

  const canonicalPairKey = (pair) => {
    const a = String(pair[0] || "").trim().toLowerCase();
    const b = String(pair[1] || "").trim().toLowerCase();
    return a < b ? a + "|" + b : b + "|" + a;
  };

  function buildPairDeck(pool, lastKey) {
    const deck = shuffle(pool).map((pair) => ({ pair, key: canonicalPairKey(pair) }));
    if (deck.length > 1 && lastKey && deck[0].key === lastKey) {
      const idx = deck.findIndex((item) => item.key !== lastKey);
      if (idx > 0) [deck[0], deck[idx]] = [deck[idx], deck[0]];
    }
    return deck;
  }

  function pickWordPair(difficulty) {
    const pool = PAIRES[difficulty] || [];
    if (pool.length === 0) return null;

    const state = pairDeckState[difficulty] || (pairDeckState[difficulty] = { deck: [], lastKey: "" });
    if (state.deck.length === 0) {
      state.deck = buildPairDeck(pool, state.lastKey);
    }

    const next = state.deck.shift();
    if (!next) return null;
    state.lastKey = next.key;
    if (netMode === "host") persistPairDeckStateToRoom();
    return next.pair;
  }

  function sendMessageToUid(uid, msg) {
    if (!roomRef || !uid) return;
    debugLog("send->client", { uid, type: msg && msg.type });
    roomRef
      .child("mailboxes")
      .child(uid)
      .push({ ...msg, ts: Date.now() })
      .catch((err) => {
        const details = getErrorDetails(err);
        console.warn("mailbox-write-failed", uid, msg && msg.type, details);
        if ((msg && msg.type) !== "vote-ack") {
          toast("Envoi vers joueur échoué: " + details);
        }
      });
  }

  function sendActionToHost(msg) {
    if (!roomRef) return;
    debugLog("send->host", { type: msg && msg.type, fromUid: myUid });
    roomRef
      .child("actions")
      .push({ ...msg, fromUid: myUid, ts: Date.now() })
      .catch(() => {});
  }

  /* ── Toast ── */
  let toastTimer;
  const toast = (msg) => {
    const el = document.getElementById("toast");
    const msgEl = document.getElementById("toast-msg");
    setText(msgEl, msg);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  };

  const getErrorDetails = (err) => {
    if (!err) return "Erreur inconnue.";
    const code = String(err.code || "");
    const message = String(err.message || "");

    if (code.includes("permission-denied") || message.includes("permission_denied")) {
      return "Accès refusé par les règles Firebase (permission_denied).";
    }
    if (code.includes("network-request-failed")) {
      return "Problème réseau. Vérifie ta connexion Internet.";
    }
    if (code.includes("firebase-timeout-connect")) {
      return "Connexion Firebase trop lente. Sur iPhone 4G, désactive VPN/Relais privé puis réessaie.";
    }
    if (code.includes("firebase-timeout-read")) {
      return "Connexion au salon trop lente. Réessaie dans quelques secondes.";
    }
    if (code.includes("too-many-requests")) {
      return "Trop de requêtes. Attends quelques secondes.";
    }
    if (code.includes("operation-not-allowed")) {
      return "Auth anonyme désactivée dans Firebase.";
    }
    if (code.includes("invalid-api-key")) {
      return "Clé API Firebase invalide dans firebase-config.js.";
    }
    if (code.includes("app-deleted") || code.includes("no-app")) {
      return "Configuration Firebase invalide ou non chargée.";
    }
    if (message) return message.slice(0, 140);
    return "Erreur inconnue.";
  };

  /* ── Navigation ── */
  const showScreen = (id, anim) => {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active", "zoom"));
    const s = document.getElementById("screen-" + id);
    s.classList.add("active");
    if (anim === "zoom") s.classList.add("zoom");
    window.scrollTo({ top: 0, behavior: "smooth" });

    /* Show/hide peek button */
    const peekBtn = document.getElementById("btn-peek");
    if (peekBtn) {
      const clientPeekScreens = ["discussion", "client-info", "client-mrwhite", "client-vote"];
      const localPeekScreens = ["discussion", "vote", "result"];
      let canPeek = false;

      if (netMode === "client") {
        canPeek = clientPeekScreens.includes(id) && !!clientWord;
      } else if (netMode === "host") {
        canPeek = localPeekScreens.includes(id) && !!(game.mots && game.mots[myName]);
      } else {
        canPeek = localPeekScreens.includes(id) && !!game.mots;
      }

      peekBtn.classList.toggle("is-hidden", !canPeek);
    }

    updateNetworkBanner();
  };

  /* ── Confetti ── */
  const launchConfetti = () => {
    try {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
    } catch (_) {}

    const colors = ["#e11d48","#f59e0b","#10b981","#6366f1","#ec4899","#f97316"];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement("div");
      c.className = "confetti-piece";
      c.style.left              = Math.random() * 100 + "vw";
      c.style.background        = colors[Math.floor(Math.random() * colors.length)];
      c.style.width             = (6 + Math.random() * 8) + "px";
      c.style.height            = (6 + Math.random() * 8) + "px";
      c.style.borderRadius      = Math.random() > .5 ? "50%" : "2px";
      c.style.animationDuration = (1.5 + Math.random() * 2) + "s";
      c.style.animationDelay    = (Math.random() * .8) + "s";
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

  /* ── Shuffle ── */
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  /* ── Code generation ── */
  const makeCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    let code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  };

  const setupPlayersCard = document.getElementById("setup-players-card");
  const setupHostNameCard = document.getElementById("setup-host-name-card");
  const setupOptionsCard = document.getElementById("setup-options-card");
  const lobbyRoleCardsContainer = document.getElementById("lobby-role-cards");

  const buildRoleDistribution = (totalPlayers) => {
    const nbPlayers = Math.max(0, Number(totalPlayers) || 0);
    const nbImposteurs = config.nbImposteurs;
    const nbEspion = config.rolesActifs.espion ? 1 : 0;
    const nbMrWhite = config.rolesActifs.mr_white ? 1 : 0;
    const nbAgentDouble = config.rolesActifs.agent_double ? 1 : 0;
    const nbSpeciaux = nbEspion + nbMrWhite + nbAgentDouble;
    const nbCitoyens = Math.max(0, nbPlayers - nbImposteurs - nbSpeciaux);
    const nonCitoyens = nbImposteurs + nbSpeciaux;
    const isValid = nbPlayers >= 3 && nonCitoyens < nbPlayers;
    return {
      nbPlayers,
      nbCitoyens,
      nbImposteurs,
      nbEspion,
      nbMrWhite,
      nbAgentDouble,
      isValid,
      difficulte: config.difficulte
    };
  };

  const renderClientRolePreview = (preview) => {
    const validity = document.getElementById("client-role-validity");
    const configLine = document.getElementById("client-config-line");
    const line = document.getElementById("client-role-line");
    if (!validity || !line || !configLine) return;

    if (!preview || typeof preview !== "object") {
      setText(validity, "En attente");
      setText(configLine, "Configuration en attente…");
      setText(line, "L'hôte ajuste les rôles…");
      return;
    }

    setText(validity, preview.isValid ? "Valide" : "A ajuster");
    const diffLabel = preview.difficulte === "difficile" ? "Dur" : "Facile";
    setText(configLine, "Mode " + diffLabel + " • Joueurs " + (preview.nbPlayers || 0));
    setText(
      line,
      "Civils " + (preview.nbCitoyens || 0) +
      " • Imposteurs " + (preview.nbImposteurs || 0) +
      " • Espion " + (preview.nbEspion || 0) +
      " • Mr White " + (preview.nbMrWhite || 0) +
      " • Agent Double " + (preview.nbAgentDouble || 0)
    );
  };

  const publishLobbyConfigPreview = () => {
    if (netMode !== "host" || !isHostRoom || !roomRef) return;
    const preview = buildRoleDistribution(players.length);
    Object.keys(hostConns).forEach((uid) => {
      sendMessageToUid(uid, {
        type: "config-preview",
        preview
      });
    });
  };

  const setHostSetupMode = (fromLobby) => {
    hostConfigFromLobby = !!fromLobby;
    setupPlayersCard.style.display = "none";

    if (fromLobby) {
      setupHostNameCard.style.display = "none";
      setupOptionsCard.style.display = "";
      document.getElementById("btn-start").textContent = "Lancer la partie \u203A";
      players = [myName, ...Object.values(hostConns).map(c => c.name)];
      renderSetupRecap();
      return;
    }

    setupHostNameCard.style.display = "block";
    setupOptionsCard.style.display = "none";
    document.getElementById("btn-start").textContent = "Créer le salon \u203A";
  };

  function renderLobbyRoleConfig() {
    const recapGrid = document.getElementById("lobby-setup-recap-grid");
    const recapNote = document.getElementById("lobby-setup-recap-note");
    const impMinusBtn = document.getElementById("lobby-btn-imp-minus");
    const impPlusBtn = document.getElementById("lobby-btn-imp-plus");
    const impCount = document.getElementById("lobby-imp-count");
    if (!recapGrid || !recapNote || !impMinusBtn || !impPlusBtn || !impCount) return;

    if (netMode === "host" && isHostRoom) {
      players = [myName, ...Object.values(hostConns).map(c => c.name)];
    }

    const dist = buildRoleDistribution(players.length);
    setText(impCount, config.nbImposteurs);

    document.querySelectorAll("[data-diff-lobby]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.diffLobby === config.difficulte);
    });

    if (lobbyRoleCardsContainer) {
      lobbyRoleCardsContainer.querySelectorAll("[data-role-key]").forEach((card) => {
        const key = card.getAttribute("data-role-key");
        const selected = !!config.rolesActifs[key];
        card.classList.toggle("selected", selected);
        card.setAttribute("aria-pressed", String(selected));
      });
    }

    recapGrid.innerHTML = "";
    [
      ["Joueurs", String(dist.nbPlayers)],
      ["Citoyens", String(dist.nbCitoyens)],
      ["Imposteurs", String(dist.nbImposteurs)],
      ["Espion", String(dist.nbEspion)],
      ["Mr White", String(dist.nbMrWhite)],
      ["Agent Double", String(dist.nbAgentDouble)]
    ].forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "setup-recap-item";
      const left = document.createElement("span");
      left.className = "label";
      setText(left, label);
      const right = document.createElement("span");
      right.className = "value";
      setText(right, value);
      item.appendChild(left);
      item.appendChild(right);
      recapGrid.appendChild(item);
    });

    recapNote.classList.toggle("warn", !dist.isValid);
    setText(
      recapNote,
      dist.isValid
        ? "Répartition calculée sur les joueurs actuellement connectés."
        : "Configuration invalide: il faut au moins 1 citoyen."
    );

    const maxAllowed = maxImposteursForCurrentSetup();
    impMinusBtn.disabled = config.nbImposteurs <= 1;
    impPlusBtn.disabled = config.nbImposteurs >= 4 || config.nbImposteurs >= maxAllowed;
    publishLobbyConfigPreview();
  }

  /* ══════════════════════════════
     MENU SCREEN
  ══════════════════════════════ */
  document.getElementById("btn-mode-salon").addEventListener("click", () => {
    netMode = "salon";
    players = [];
    hostConfigFromLobby = false;
    setupPlayersCard.style.display = "";
    setupHostNameCard.style.display = "none";
    setupOptionsCard.style.display = "";
    document.getElementById("btn-start").textContent = "Lancer la partie \u203A";
    showScreen("setup");
    renderPlayers();
    renderSetupRecap();
  });

  /* Setup back */
  document.getElementById("btn-setup-back").addEventListener("click", () => {
    if (netMode === "host" && hostConfigFromLobby && isHostRoom) {
      showScreen("lobby", "zoom");
      return;
    }
    showScreen("menu");
  });

  document.getElementById("btn-mode-host").addEventListener("click", () => {
    netMode = "host";
    players = [];
    setHostSetupMode(false);
    showScreen("setup");
    renderSetupRecap();
  });

  document.getElementById("btn-mode-join").addEventListener("click", () => {
    netMode = "client";
    showScreen("join", "zoom");
  });

  /* ══════════════════════════════
     JOIN SCREEN (client)
  ══════════════════════════════ */
  document.getElementById("btn-join-back").addEventListener("click", () => {
    destroyPeer();
    showScreen("menu");
  });

  document.getElementById("btn-client-wait-back").addEventListener("click", () => {
    destroyPeer();
    showScreen("menu");
  });

  document.getElementById("btn-join-connect").addEventListener("click", () => {
    attemptJoin().catch((err) => toast("Impossible de rejoindre : " + getErrorDetails(err)));
  });
  document.getElementById("join-code").addEventListener("keydown", e => {
    if (e.key === "Enter") attemptJoin().catch((err) => toast("Impossible de rejoindre : " + getErrorDetails(err)));
  });

  async function attemptJoin() {
    const nameRaw = document.getElementById("join-name").value.trim().slice(0, 20);
    const codeRaw = document.getElementById("join-code").value.trim().toUpperCase();
    if (!nameRaw) return toast("Entre ton pseudo !");
    if (!NAME_REGEX.test(nameRaw)) return toast("Pseudo invalide.");
    if (codeRaw.length !== 4 || !CODE_REGEX.test(codeRaw)) return toast("Code invalide (4 lettres).");

    myName = nameRaw;
    roomCode = codeRaw;
    toast("Connexion Firebase…");
    destroyPeer();

    try {
      await withTimeout(firebaseReady(), FIREBASE_CONNECT_TIMEOUT_MS, "firebase-timeout-connect");
    } catch (err) {
      toast("Firebase indisponible : " + getErrorDetails(err));
      return;
    }

    roomRef = db.ref(roomPath(roomCode));
    isHostRoom = false;

    const metaSnap = await withTimeout(
      roomRef.child("meta").once("value"),
      FIREBASE_READ_TIMEOUT_MS,
      "firebase-timeout-read"
    );
    const meta = metaSnap.val();
    if (!meta || !meta.hostUid) {
      toast("Partie introuvable.");
      destroyPeer();
      return;
    }
    if (meta.status === "closed") {
      toast("Le salon est fermé.");
      destroyPeer();
      return;
    }

    const playersSnap = await withTimeout(
      roomRef.child("players").once("value"),
      FIREBASE_READ_TIMEOUT_MS,
      "firebase-timeout-read"
    );
    const existingRows = [];
    playersSnap.forEach((ch) => {
      const v = ch.val() || {};
      if (v.name) {
        existingRows.push({
          uid: ch.key,
          name: v.name,
          connected: v.connected !== false,
          playerKey: String(v.playerKey || "")
        });
      }
    });

    const sameNameRows = existingRows.filter((r) => r.name === myName);
    const sameNameConnectedOther = sameNameRows.some((r) => r.uid !== myUid && r.connected);
    const reservedByOtherIdentity = sameNameRows.some((r) => r.uid !== myUid && r.playerKey !== myPlayerKey);

    if (meta.status === "lobby" && sameNameConnectedOther) {
      toast("Ce pseudo est déjà pris.");
      destroyPeer();
      return;
    }

    if (meta.status !== "lobby" && reservedByOtherIdentity) {
      toast("Ce pseudo est réservé dans cette partie.");
      destroyPeer();
      return;
    }

    const meRef = roomRef.child("players").child(myUid);
    await meRef.set({
      name: myName,
      isHost: false,
      connected: true,
      playerKey: myPlayerKey,
      reconnecting: meta.status !== "lobby",
      lastSeen: serverTimestamp(),
      joinedAt: Date.now()
    });
    meRef.onDisconnect().update({ connected: false, lastSeen: serverTimestamp() });
    startPresenceHeartbeat();

    clientConn = { send: sendActionToHost };

    onRoom(roomRef.child("meta"), "value", (snap) => {
      const m = snap.val();
      if (!m || m.status === "closed") {
        toast("Le salon a été fermé par l'hôte.");
        destroyPeer();
        showScreen("menu");
      }
    });

    onRoom(roomRef.child("players"), "value", (snap) => {
      const rows = [];
      snap.forEach((ch) => {
        const v = ch.val() || {};
        if (v.name && v.connected !== false) rows.push({ name: v.name, isHost: !!v.isHost });
      });
      const hostName = (rows.find((r) => r.isHost) || {}).name || "";
      renderClientWaitLobby(rows.map((r) => r.name), hostName);
    });

    const inboxRef = roomRef.child("mailboxes").child(myUid);
    onRoom(inboxRef, "child_added", (snap) => {
      const data = snap.val();
      if (data) handleClientData(data);
      snap.ref.remove().catch(() => {});
    });

    setText(document.getElementById("client-room-code"), roomCode);
    setText(document.getElementById("client-dossier-ref"), buildDossierRef(roomCode));
    renderClientRolePreview(null);
    showScreen("client-wait", "zoom");
  }

  /* ── Client message handler ── */
  function handleClientData(data) {
    if (!data || !data.type) return;

    switch (data.type) {
      case "reveal":
        clientWord = data.mot || "";
        clientRoleName = data.roleName || "";
        setText(document.getElementById("client-player-name"), myName);
        mountHoldReveal(document.getElementById("client-reveal-area"), {
          word: clientWord,
          roleName: clientRoleName
        });
        showScreen("client-reveal", "zoom");
        break;

      case "phase":
        if (data.title === DISCUSSION_PHASE_TOKEN) {
          const payload = safeParseJson(data.sub, {});
          showClientDiscussion(payload || {});
          break;
        }
        if (data.title === VICTORY_RECAP_TOKEN) {
          const payload = safeParseJson(data.sub, {});
          pendingClientVictory = {
            ...(pendingClientVictory || {}),
            ...(payload || {})
          };
          if (pendingClientVictory && pendingClientVictory.title) {
            showClientVictory(pendingClientVictory);
          }
          break;
        }
        document.getElementById("client-info-icon").textContent = data.icon || "INFO";
        setText(document.getElementById("client-info-title"), data.title || "");
        setText(document.getElementById("client-info-sub"), data.sub || "");
        showScreen("client-info", "zoom");
        break;

      case "phase-discussion":
        showClientDiscussion(data);
        break;

      case "mrwhite-guess":
        showScreen("client-mrwhite", "zoom");
        break;

      case "victory":
        pendingClientVictory = {
          ...(pendingClientVictory || {}),
          title: data.title || "Fin !",
          sub: data.sub || "",
          motCitoyen: data.motCitoyen || "?",
          motImposteur: data.motImposteur || "?"
        };
        showClientVictory(pendingClientVictory);
        break;

      case "kick":
        toast("Vous avez \u00e9t\u00e9 d\u00e9connect\u00e9.");
        destroyPeer();
        showScreen("menu");
        break;

      case "vote-start": {
        const candidates = data.players || [];
        const isRevote = !!data.revote;
        const grid = document.getElementById("client-vote-grid");
        const sentDiv = document.getElementById("client-vote-sent");
        const sentSub = document.getElementById("client-vote-sent-sub");
        grid.innerHTML = "";
        grid.style.display = "";
        sentDiv.classList.add("is-hidden");
        if (sentSub) setText(sentSub, "En attente des autres joueurs…");
        const sub = document.getElementById("client-vote-sub");
        setText(sub, isRevote
          ? "Égalité ! Re-vote entre les joueurs ex æquo."
          : "Choisis qui éliminer. Ton vote est définitif.");

        const votable = candidates.filter(n => n !== myName);
        votable.forEach(name => {
          const btn = document.createElement("button");
          btn.className = "vote-btn";
          const sp = document.createElement("span"); setText(sp, name);
          const lbl = document.createElement("span"); lbl.className = "eliminate-label"; setText(lbl, "Voter \u2715");
          btn.appendChild(sp); btn.appendChild(lbl);
          btn.addEventListener("click", () => {
            if (clientConn) clientConn.send({ type: "vote", target: name });
            grid.querySelectorAll(".vote-btn").forEach(b => { b.disabled = true; });
            btn.classList.add("voted");
            if (sentSub) setText(sentSub, "Vote enregistré contre " + name + ". En attente des autres joueurs…");
            /* Show sent confirmation after short delay */
            setTimeout(() => {
              grid.style.display = "none";
              sentDiv.classList.remove("is-hidden");
            }, 400);
          });
          grid.appendChild(btn);
        });

        /* If this player is not in the alive list (eliminated), show wait */
        if (votable.length === 0) {
          grid.style.display = "none";
          sentDiv.classList.remove("is-hidden");
          if (sentSub) setText(sentSub, "Aucun vote requis pour toi. En attente des autres joueurs…");
        }

        showScreen("client-vote", "zoom");
        break;
      }

      case "vote-ack":
        {
          const sentSub = document.getElementById("client-vote-sent-sub");
          if (sentSub) setText(sentSub, "Vote confirmé par l'hôte. En attente des autres joueurs…");
        }
        break;

      case "vote-result": {
        const eliminated = data.eliminated || "";
        document.getElementById("client-info-icon").textContent = "VOTE";
        setText(document.getElementById("client-info-title"), eliminated + " \u00e9limin\u00e9 !");
        setText(document.getElementById("client-info-sub"), "Le mot reste cach\u00e9 jusqu'\u00e0 la fin de partie.");
        showScreen("client-info", "zoom");
        break;
      }

      case "config-preview":
        renderClientRolePreview(data.preview || null);
        break;

      case "rematch-lobby":
        pendingClientVictory = null;
        clientWord = "";
        clientRoleName = "";
        lastConfettiKey = "";
        if (data.preview) renderClientRolePreview(data.preview);
        setText(document.getElementById("client-lobby-status"), "Nouvelle manche en préparation…");
        showScreen("client-wait", "zoom");
        if (data.by) toast("Retour au lobby demandé par " + data.by);
        break;
    }
  }

  /* ── Client Mr White guess ── */
  document.getElementById("btn-client-mrwhite").addEventListener("click", sendClientMrWhite);
  document.getElementById("client-mrwhite-input").addEventListener("keydown", e => {
    if (e.key === "Enter") sendClientMrWhite();
  });
  function sendClientMrWhite() {
    const raw = document.getElementById("client-mrwhite-input").value.trim().slice(0, 40);
    if (!raw) return toast("Entre un mot !");
    if (clientConn) clientConn.send({ type: "mrwhite-answer", guess: raw });
    document.getElementById("client-info-icon").textContent = "…";
    setText(document.getElementById("client-info-title"), "R\u00e9ponse envoy\u00e9e");
    setText(document.getElementById("client-info-sub"), "En attente du r\u00e9sultat\u2026");
    showScreen("client-info", "zoom");
  }

  /* ══════════════════════════════
     LOBBY (host)
  ══════════════════════════════ */
  document.getElementById("btn-lobby-back").addEventListener("click", () => {
    hostConfigFromLobby = false;
    broadcastToClients({ type: "kick" });
    if (roomRef) roomRef.child("meta").update({ status: "closed" }).catch(() => {});
    destroyPeer();
    showScreen("menu");
  });

  document.getElementById("btn-copy-code").addEventListener("click", () => {
    navigator.clipboard.writeText(roomCode).then(() => toast("Code copi\u00e9 !")).catch(() => {});
  });

  document.getElementById("btn-lobby-start").addEventListener("click", () => {
    const allNames = [myName, ...Object.values(hostConns).map(c => c.name)];
    if (allNames.length < 3) return toast("Il faut au moins 3 joueurs (toi inclus).");
    players = allNames;
    startGame();
  });

  function renderLobby() {
    const grid = document.getElementById("lobby-players");
    const remoteNames = Object.values(hostConns).map(c => c.name);
    const allNames = [myName, ...remoteNames];
    players = allNames;
    renderSetupRecap();
    renderLobbyRoleConfig();
    setText(document.getElementById("lobby-count"), allNames.length);
    grid.innerHTML = "";
    allNames.forEach((name) => {
      const pill = document.createElement("div");
      pill.className = "player-pill";
      const span = document.createElement("span");
      appendNameWithBadges(span, name, myName);
      pill.appendChild(span);
      grid.appendChild(pill);
    });
    const btn = document.getElementById("btn-lobby-start");
    const missing = Math.max(0, 3 - allNames.length);
    btn.disabled = missing > 0;
    setText(
      btn,
      missing > 0
        ? "Lancer la partie (3 joueurs minimum)"
        : "Lancer la partie \u203a"
    );
    const waiting = document.getElementById("lobby-waiting");
    waiting.style.display = "block";
    refreshLobbyHints();
  }

  async function startHosting() {
    roomCode = makeCode();
    destroyPeer();

    try {
      await withTimeout(firebaseReady(), FIREBASE_CONNECT_TIMEOUT_MS, "firebase-timeout-connect");
    } catch (err) {
      toast("Firebase indisponible : " + getErrorDetails(err));
      return;
    }

    try {
      isHostRoom = true;
      roomRef = null;
      for (let i = 0; i < 8; i++) {
        const candidate = makeCode();
        const candidateRef = db.ref(roomPath(candidate));
        const tx = await candidateRef.child("meta").transaction((curr) => {
          if (curr) return;
          return {
            hostUid: myUid,
            status: "lobby",
            createdAt: Date.now()
          };
        });
        if (tx.committed) {
          roomCode = candidate;
          roomRef = candidateRef;
          break;
        }
      }

      if (!roomRef) {
        throw new Error("room-not-created");
      }

      await roomRef.child("players").child(myUid).set({
        name: myName,
        isHost: true,
        connected: true,
        playerKey: myPlayerKey,
        lastSeen: serverTimestamp(),
        joinedAt: Date.now()
      });
      await loadPairDeckStateFromRoom();
      persistPairDeckStateToRoom();
      roomRef.child("players").child(myUid).onDisconnect().update({ connected: false, lastSeen: serverTimestamp() });
      roomRef.child("meta").child("status").onDisconnect().set("closed");

      onRoom(roomRef.child("players"), "value", (snap) => {
        const prevMap = hostConns;
        const map = {};
        snap.forEach((ch) => {
          if (ch.key === myUid) return;
          const v = ch.val() || {};
          if (v.name && v.connected !== false) {
            map[ch.key] = {
              name: v.name,
              playerKey: String(v.playerKey || "")
            };
          }
        });
        hostConns = map;

        if (hasStartedOnlineGame()) {
          Object.keys(map)
            .filter((uid) => !prevMap[uid])
            .forEach((uid) => syncClientToCurrentGame(uid, map[uid].name, map[uid].playerKey));
        }

        if (game.expectedVoters) {
          const currentNames = [myName, ...Object.values(hostConns).map(c => c.name)];
          game.expectedVoters = game.expectedVoters.filter(n => currentNames.includes(n));
          updateVoteProgress();
          checkAllVotesIn();
        }

        renderLobby();
      });

      onRoom(roomRef.child("actions"), "child_added", (snap) => {
        const data = snap.val();
        if (data) handleHostData(data.fromUid, data);
        snap.ref.remove().catch(() => {});
      });

      setText(document.getElementById("lobby-code"), roomCode);
      setText(document.getElementById("lobby-dossier"), buildDossierRef(roomCode));
      showScreen("lobby", "zoom");
      renderLobby();
    } catch (err) {
      destroyPeer();
      throw err;
    }
  }

  function handleHostData(fromUid, data) {
    if (!data || !data.type) return;
    switch (data.type) {
      case "rematch-request": {
        const requester = hostConns[fromUid] && hostConns[fromUid].name;
        if (!requester) break;
        if (!game || game.phase !== "victory") break;
        returnOnlineMatchToLobby(requester);
        break;
      }

      case "mrwhite-answer": {
        const voter = hostConns[fromUid];
        if (!voter || !game.joueursEnVie.includes(voter.name)) break;
        const guess = String(data.guess || "").trim().slice(0, 40);
        if (guess.toLowerCase() === game.motCitoyen.toLowerCase()) {
          showVictory("mr_white", game.mrWhiteNom);
        } else {
          checkWin(mrWhiteAliveSnapshot, game.mrWhiteNom);
        }
        break;
      }
      case "vote": {
        const voterName = hostConns[fromUid] && hostConns[fromUid].name;
        if (!voterName) break;
        const target = String(data.target || "").trim().slice(0, 20);
        /* Validate: voter alive, target alive & in candidates, no duplicate */
        if (!game.joueursEnVie.includes(voterName)) break;
        if (!game.voteCandidates || !game.voteCandidates.includes(target)) break;
        if (voterName === target) break;
        if (game.votes[voterName] !== undefined) break;
        game.votes[voterName] = target;
        sendMessageToUid(fromUid, { type: "vote-ack" });
        updateVoteProgress();
        checkAllVotesIn();
        break;
      }
    }
  }

  /* ── Broadcast to all clients ── */
  function broadcastToClients(msg) {
    Object.keys(hostConns).forEach((uid) => sendMessageToUid(uid, msg));
  }

  function sendToClient(playerName, msg) {
    const uid = Object.keys(hostConns).find((k) => hostConns[k].name === playerName);
    if (uid) sendMessageToUid(uid, msg);
  }

  function returnOnlineMatchToLobby(requestedByName) {
    const requester = String(requestedByName || myName || "").slice(0, 20);
    game = {};
    pendingClientVictory = null;
    lastConfettiKey = "";
    clientWord = "";
    clientRoleName = "";

    if (netMode === "host") {
      if (roomRef) {
        roomRef.child("meta").update({ status: "lobby" }).catch(() => {});
      }
      players = [myName, ...Object.values(hostConns).map(c => c.name)];
      const preview = buildRoleDistribution(players.length);
      broadcastToClients({ type: "rematch-lobby", by: requester, preview });
      renderLobby();
      showScreen("lobby", "zoom");
      toast("Retour au lobby" + (requester && requester !== myName ? " demandé par " + requester : ""));
      return;
    }

    setText(document.getElementById("client-lobby-status"), "Nouvelle manche en préparation…");
    showScreen("client-wait", "zoom");
  }

  /* ── Cleanup ── */
  function destroyPeer() {
    stopPresenceHeartbeat();
    hostConfigFromLobby = false;
    if (roomRef && myUid) {
      try {
        if (isHostRoom) {
          roomRef.child("meta").update({ status: "closed" }).catch(() => {});
          roomRef.child("players").child(myUid).update({ connected: false, lastSeen: serverTimestamp() }).catch(() => {});
        } else {
          roomRef.child("players").child(myUid).update({ connected: false, lastSeen: serverTimestamp() }).catch(() => {});
        }
      } catch (_) {}
    }
    detachRoomListeners();
    roomRef = null;
    isHostRoom = false;
    hostConns = {};
    clientConn = null;
  }

  /* ══════════════════════════════
     SETUP SCREEN (salon + host config)
  ══════════════════════════════ */
  const renderPlayers = () => {
    const grid = document.getElementById("player-grid");
    setText(document.getElementById("player-count"), players.length);
    grid.innerHTML = "";
    players.forEach(name => {
      const pill = document.createElement("div");
      pill.className = "player-pill";
      const span = document.createElement("span");
      span.title = name; setText(span, name);
      const btn = document.createElement("button");
      btn.textContent = "\u2715";
      btn.setAttribute("aria-label", "Supprimer " + esc(name));
      btn.addEventListener("click", () => removePlayer(name));
      pill.appendChild(span); pill.appendChild(btn);
      grid.appendChild(pill);
    });
    renderSetupRecap();
  };

  function renderSetupRecap() {
    const grid = document.getElementById("setup-recap-grid");
    const note = document.getElementById("setup-recap-note");
    const impMinusBtn = document.getElementById("btn-imp-minus");
    const impPlusBtn = document.getElementById("btn-imp-plus");
    if (!grid || !note) return;

    if (netMode === "host" && isHostRoom) {
      players = [myName, ...Object.values(hostConns).map(c => c.name)];
    }

    const nbPlayers = players.length;
    const nbImposteurs = config.nbImposteurs;
    const nbEspion = config.rolesActifs.espion ? 1 : 0;
    const nbMrWhite = config.rolesActifs.mr_white ? 1 : 0;
    const nbAgentDouble = config.rolesActifs.agent_double ? 1 : 0;
    const nbSpeciaux = nbEspion + nbMrWhite + nbAgentDouble;
    const nbCitoyens = Math.max(0, nbPlayers - nbImposteurs - nbSpeciaux);
    const nonCitoyens = nbImposteurs + nbSpeciaux;
    const isInvalid = nonCitoyens >= nbPlayers && nbPlayers > 0;

    const items = [
      ["Joueurs", String(nbPlayers)],
      ["Citoyens", String(nbCitoyens)],
      ["Imposteurs", String(nbImposteurs)],
      ["Espion", String(nbEspion)],
      ["Mr White", String(nbMrWhite)],
      ["Agent Double", String(nbAgentDouble)]
    ];

    grid.innerHTML = "";
    items.forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "setup-recap-item";
      const left = document.createElement("span");
      left.className = "label";
      setText(left, label);
      const right = document.createElement("span");
      right.className = "value";
      setText(right, value);
      item.appendChild(left);
      item.appendChild(right);
      grid.appendChild(item);
    });

    note.classList.toggle("warn", isInvalid);
    setText(
      note,
      isInvalid
        ? "Configuration invalide: il faut au moins 1 citoyen."
        : "R\u00e9partition calcul\u00e9e automatiquement selon vos options."
    );

    if (impMinusBtn) {
      impMinusBtn.disabled = config.nbImposteurs <= 1;
      impMinusBtn.setAttribute("aria-disabled", String(impMinusBtn.disabled));
    }
    if (impPlusBtn) {
      const maxAllowed = maxImposteursForCurrentSetup();
      impPlusBtn.disabled = config.nbImposteurs >= 4 || config.nbImposteurs >= maxAllowed;
      impPlusBtn.setAttribute("aria-disabled", String(impPlusBtn.disabled));
    }

    publishLobbyConfigPreview();
  }

  const addPlayer = () => {
    const input = document.getElementById("player-input");
    const raw = input.value.trim().slice(0, 20);
    if (!raw) return;
    if (!NAME_REGEX.test(raw)) return toast("Nom invalide (lettres/chiffres uniquement).");
    if (players.includes(raw)) return toast("Ce nom existe d\u00e9j\u00e0 !");
    if (players.length >= 12) return toast("Maximum 12 joueurs.");
    players.push(raw);
    input.value = "";
    renderPlayers();
  };

  const removePlayer = (name) => {
    players = players.filter(p => p !== name);
    renderPlayers();
  };

  document.getElementById("btn-add-player").addEventListener("click", addPlayer);
  document.getElementById("player-input").addEventListener("keydown", e => {
    if (e.key === "Enter") addPlayer();
  });

  /* Difficulte */
  document.querySelectorAll("[data-diff]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-diff]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      config.difficulte = btn.dataset.diff;
      renderSetupRecap();
    });
  });

  document.querySelectorAll("[data-diff-lobby]").forEach(btn => {
    btn.addEventListener("click", () => {
      config.difficulte = btn.dataset.diffLobby;
      renderSetupRecap();
      renderLobbyRoleConfig();
    });
  });

  /* Nb imposteurs */
  const maxImposteursForCurrentSetup = () => {
    const nbSpeciaux = Object.values(config.rolesActifs).filter(Boolean).length;
    if (players.length < 3) return 4;
    return Math.max(1, players.length - nbSpeciaux - 1);
  };

  document.getElementById("btn-imp-minus").addEventListener("click", () => {
    if (config.nbImposteurs > 1) {
      config.nbImposteurs--;
      setText(document.getElementById("imp-count"), config.nbImposteurs);
      renderSetupRecap();
      renderLobbyRoleConfig();
    }
  });
  document.getElementById("btn-imp-plus").addEventListener("click", () => {
    const maxAllowed = maxImposteursForCurrentSetup();
    if (config.nbImposteurs >= 4) return;
    if (config.nbImposteurs >= maxAllowed) {
      if (players.length >= 3) {
        toast("Trop d'imposteurs pour " + players.length + " joueurs.");
      }
      return;
    }
    config.nbImposteurs++;
    setText(document.getElementById("imp-count"), config.nbImposteurs);
    renderSetupRecap();
    renderLobbyRoleConfig();
  });

  document.getElementById("lobby-btn-imp-minus").addEventListener("click", () => {
    if (config.nbImposteurs > 1) {
      config.nbImposteurs--;
      setText(document.getElementById("imp-count"), config.nbImposteurs);
      renderSetupRecap();
      renderLobbyRoleConfig();
    }
  });

  document.getElementById("lobby-btn-imp-plus").addEventListener("click", () => {
    const maxAllowed = maxImposteursForCurrentSetup();
    if (config.nbImposteurs >= 4) return;
    if (config.nbImposteurs >= maxAllowed) {
      if (players.length >= 3) {
        toast("Trop d'imposteurs pour " + players.length + " joueurs.");
      }
      return;
    }
    config.nbImposteurs++;
    setText(document.getElementById("imp-count"), config.nbImposteurs);
    renderSetupRecap();
    renderLobbyRoleConfig();
  });

  /* Roles speciaux */
  const roleCardsContainer = document.getElementById("role-cards");
  Object.entries(ROLES_INFO).forEach(([key, info]) => {
    const card = document.createElement("div");
    card.className = "role-card";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-pressed", "false");
    card.addEventListener("click", () => {
      config.rolesActifs[key] = !config.rolesActifs[key];
      card.classList.toggle("selected", config.rolesActifs[key]);
      card.setAttribute("aria-pressed", String(config.rolesActifs[key]));
      renderSetupRecap();
    });
    card.addEventListener("keydown", e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); card.click(); } });
    const div = document.createElement("div");
    div.className = "role-info";
    const n = document.createElement("div"); n.className = "name"; setText(n, (info.emoji ? info.emoji + " " : "") + info.nom);
    const d = document.createElement("div"); d.className = "desc"; setText(d, info.desc);
    div.appendChild(n); div.appendChild(d);
    card.appendChild(div);
    roleCardsContainer.appendChild(card);
  });

  if (lobbyRoleCardsContainer) {
    Object.entries(ROLES_INFO).forEach(([key, info]) => {
      const card = document.createElement("div");
      card.className = "role-card";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-pressed", "false");
      card.setAttribute("data-role-key", key);
      card.addEventListener("click", () => {
        config.rolesActifs[key] = !config.rolesActifs[key];
        renderSetupRecap();
        renderLobbyRoleConfig();
      });
      card.addEventListener("keydown", e => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          card.click();
        }
      });
      const div = document.createElement("div");
      div.className = "role-info";
      const n = document.createElement("div"); n.className = "name"; setText(n, (info.emoji ? info.emoji + " " : "") + info.nom);
      const d = document.createElement("div"); d.className = "desc"; setText(d, info.desc);
      div.appendChild(n); div.appendChild(d);
      card.appendChild(div);
      lobbyRoleCardsContainer.appendChild(card);
    });
  }
  renderSetupRecap();
  renderLobbyRoleConfig();

  /* ══════════════════════════════
     START GAME
  ══════════════════════════════ */
  document.getElementById("btn-start").addEventListener("click", async () => {
    if (netMode === "host") {
      if (isHostRoom && roomRef) {
        players = [myName, ...Object.values(hostConns).map(c => c.name)];
        startGame();
        return;
      }

      const nameRaw = document.getElementById("host-name-input").value.trim().slice(0, 20);
      if (!nameRaw) return toast("Entre ton pseudo !");
      if (!NAME_REGEX.test(nameRaw)) return toast("Pseudo invalide.");
      myName = nameRaw;
      const startBtn = document.getElementById("btn-start");
      const previousLabel = startBtn.textContent;
      startBtn.disabled = true;
      startBtn.textContent = "Création du salon…";
      try {
        await startHosting();
        hostConfigFromLobby = false;
      } catch (err) {
        toast("Impossible de créer le salon : " + getErrorDetails(err));
      } finally {
        startBtn.disabled = false;
        startBtn.textContent = previousLabel;
      }
      return;
    }
    startGame();
  });

  function startGame() {
    if (netMode === "host") {
      players = [myName, ...Object.values(hostConns).map(c => c.name)];
    }

    if (netMode === "salon" && players.length < 3) return toast("Il faut au moins 3 joueurs.");
    if (netMode === "host" && players.length < 3) return toast("Il faut au moins 3 joueurs connect\u00e9s.");

    const nbSpeciaux = Object.values(config.rolesActifs).filter(Boolean).length;
    if (config.nbImposteurs + nbSpeciaux >= players.length)
      return toast("Trop de r\u00f4les sp\u00e9ciaux pour ce nombre de joueurs !");

    const pair = pickWordPair(config.difficulte);
    if (!pair) return toast("Aucune paire de mots disponible pour cette difficulté.");
    lastConfettiKey = "";
    const [motA, motB] = Math.random() > .5 ? [pair[0], pair[1]] : [pair[1], pair[0]];

    const shuffled = shuffle(players);
    const roles = {}, mots = {};
    let ptr = 0;
    for (let i = 0; i < config.nbImposteurs; i++) {
      const p = shuffled[ptr++]; roles[p] = "imposteur"; mots[p] = motB;
    }
    if (config.rolesActifs.espion) {
      const p = shuffled[ptr++]; roles[p] = "espion"; mots[p] = motA + " / " + motB;
    }
    if (config.rolesActifs.mr_white) {
      const p = shuffled[ptr++]; roles[p] = "mr_white"; mots[p] = "???";
    }
    if (config.rolesActifs.agent_double) {
      const p = shuffled[ptr++]; roles[p] = "agent_double"; mots[p] = motA;
    }
    while (ptr < shuffled.length) {
      const p = shuffled[ptr++]; roles[p] = "citoyen"; mots[p] = motA;
    }

    const playerKeys = {};
    playerKeys[myName] = myPlayerKey;
    Object.values(hostConns).forEach((c) => {
      if (c && c.name) playerKeys[c.name] = c.playerKey || "";
    });

    game = {
      motCitoyen: motA, motImposteur: motB,
      roles, mots,
      playerKeys,
      joueursEnVie: [...players],
      revealedIndex: 0, turn: 0, mrWhiteNom: null,
      phase: netMode === "host" ? "reveal" : "reveal"
    };

    if (netMode === "host" && roomRef) {
      roomRef.child("meta").update({ status: "started" }).catch(() => {});
    }

    if (netMode === "host") {
      // Send each remote client their word
      players.forEach(name => {
        if (name === myName) return; // host sees their own word below
        const role = roles[name];
        const roleName = getSpecialRoleRevealLabel(role);
        sendToClient(name, { type: "reveal", mot: mots[name], roleName });
      });
      // Show host their own word via reveal screen
      game.revealedIndex = players.indexOf(myName);
      showHostReveal();
    } else {
      showReveal();
    }
  }

  /* ══════════════════════════════
     HOST REVEAL (host sees own word)
  ══════════════════════════════ */
  function showHostReveal() {
    const name = myName;
    setText(document.getElementById("reveal-name"), name);
    setText(document.getElementById("reveal-counter"), "Ton mot secret");
    document.getElementById("reveal-progress").style.width = "100%";

    const area = document.getElementById("word-area");
    area.innerHTML = "";
    const btn = document.createElement("button");
    btn.className = "btn-reveal";
    const eye  = document.createElement("span"); eye.className = "eye"; eye.textContent = "\uD83D\uDC41\uFE0F";
    const span = document.createElement("span"); span.textContent = "VOIR MON MOT";
    btn.appendChild(eye); btn.appendChild(span);
    btn.addEventListener("click", () => {
      const role = game.roles[name];
      const roleName = getSpecialRoleRevealLabel(role);
      mountHoldReveal(area, {
        word: game.mots[name],
        roleName,
        confirmLabel: "OK, commencer \u2192",
        onConfirm: () => startDiscussion()
      });
    });
    area.appendChild(btn);
    showScreen("reveal", "zoom");
  }

  /* ══════════════════════════════
     REVEAL (salon only)
  ══════════════════════════════ */
  function showReveal() {
    const name = players[game.revealedIndex];
    setText(document.getElementById("reveal-name"), name);
    setText(document.getElementById("reveal-counter"),
      "Joueur " + (game.revealedIndex + 1) + " sur " + players.length);
    document.getElementById("reveal-progress").style.width =
      ((game.revealedIndex + 1) / players.length * 100) + "%";

    const area = document.getElementById("word-area");
    area.innerHTML = "";
    const btn = document.createElement("button");
    btn.className = "btn-reveal";
    const eye  = document.createElement("span"); eye.className = "eye"; eye.textContent = "\uD83D\uDC41\uFE0F";
    const span = document.createElement("span"); span.textContent = "VOIR MON MOT";
    btn.appendChild(eye); btn.appendChild(span);
    btn.addEventListener("click", revealWord);
    area.appendChild(btn);
    showScreen("reveal", "zoom");
  }

  function revealWord() {
    const name = players[game.revealedIndex];
    const area = document.getElementById("word-area");
    const role = game.roles[name];
    const roleName = getSpecialRoleRevealLabel(role);
    mountHoldReveal(area, {
      word: game.mots[name],
      roleName,
      confirmLabel: "OK, suivant \u2192",
      onConfirm: nextReveal
    });
  }

  function nextReveal() {
    if (game.revealedIndex < players.length - 1) {
      game.revealedIndex++;
      showReveal();
    } else {
      startDiscussion();
    }
  }

  /* ══════════════════════════════
     DISCUSSION
  ══════════════════════════════ */
  function startDiscussion() {
    debugLog("phase", "discussion");
    game.phase = "discussion";
    game.turn++;
    const order = shuffle(game.joueursEnVie);
    game.talkingOrder = order;
    setText(document.getElementById("turn-number"), game.turn);
    document.getElementById("btn-go-vote").style.display = "";
    document.getElementById("btn-back-discussion").style.display = "";

    const list = document.getElementById("order-list");
    renderOrderList(list, order, myName);

    showScreen("discussion");

    if (netMode === "host") {
      broadcastToClients({
        type: "phase",
        icon: "DISC",
        title: DISCUSSION_PHASE_TOKEN,
        sub: JSON.stringify({
          turn: game.turn,
          order,
          hostName: myName
        })
      });
    }
  }

  document.getElementById("btn-go-vote").addEventListener("click", () => showVote());
  document.getElementById("btn-back-discussion").addEventListener("click", () => showScreen("discussion"));

  /* ══════════════════════════════
     VOTE
  ══════════════════════════════ */
  const VOTE_TIMEOUT_MS = 60000; // 60 seconds

  function showVote(candidates) {
    debugLog("phase", "vote", { revote: !!candidates });
    game.phase = "vote";
    const grid = document.getElementById("vote-grid");
    grid.innerHTML = "";

    /* Salon mode: host picks elimination directly (unchanged) */
    if (netMode === "salon") {
      game.joueursEnVie.forEach(name => {
        const btn = document.createElement("button");
        btn.className = "vote-btn";
        const sp = document.createElement("span"); setText(sp, name);
        const lbl = document.createElement("span"); lbl.className = "eliminate-label"; setText(lbl, "Éliminer \u2715");
        btn.appendChild(sp); btn.appendChild(lbl);
        btn.addEventListener("click", () => handleElimination(name));
        grid.appendChild(btn);
      });
      showScreen("vote", "zoom");
      return;
    }

    /* Online mode: distributed voting */
    const votablePlayers = candidates || game.joueursEnVie;
    const isRevote = !!candidates;
    if (!isRevote) game.wasRevote = false;

    game.votes = {};
    game.expectedVoters = [...game.joueursEnVie];
    game.voteCandidates = votablePlayers;
    clearTimeout(game.voteTimer);

    /* Broadcast vote-start to clients */
    broadcastToClients({
      type: "vote-start",
      players: votablePlayers,
      revote: isRevote
    });

    /* Host votes too — show vote UI */
    const hostCandidates = votablePlayers.filter(n => n !== myName);
    if (game.joueursEnVie.includes(myName)) {
      if (hostCandidates.length > 0) {
        hostCandidates.forEach(name => {
          const btn = document.createElement("button");
          btn.className = "vote-btn";
          const sp = document.createElement("span"); setText(sp, name);
          const lbl = document.createElement("span"); lbl.className = "eliminate-label"; setText(lbl, "Voter \u2715");
          btn.appendChild(sp); btn.appendChild(lbl);
          btn.addEventListener("click", () => {
            registerHostVote(name);
            grid.querySelectorAll(".vote-btn").forEach(b => { b.disabled = true; });
            btn.classList.add("voted");
          });
          grid.appendChild(btn);
        });
      } else {
        /* Host is the only candidate — auto-skip their vote */
        game.votes[myName] = null;
      }
    }

    /* Progress counter */
    const counter = document.createElement("div");
    counter.className = "vote-counter";
    counter.id = "host-vote-counter";
    counter.innerHTML = "Votes : <span class='count'>0</span> / " + game.expectedVoters.length;
    grid.appendChild(counter);
    const bar = document.createElement("div");
    bar.className = "vote-tally-bar";
    bar.innerHTML = "<div class='vote-tally-fill' id='host-vote-fill' style='width:0%'></div>";
    grid.appendChild(bar);

    const sub = document.getElementById("vote-grid").parentElement.querySelector(".text-muted");
    if (sub) {
      setText(
        sub,
        isRevote
          ? "Égalité ! Re-vote entre les joueurs ex æquo."
          : "Désignez l'imposteur à éliminer. Votre vote est définitif."
      );
    }

    showScreen("vote", "zoom");

    /* Hide the back-to-discussion button during online vote */
    document.getElementById("btn-back-discussion").style.display = "none";

    /* Timeout: auto-tally after VOTE_TIMEOUT_MS */
    game.voteTimer = setTimeout(() => {
      toast("Temps \u00e9coul\u00e9 ! D\u00e9pouillement\u2026");
      tallyVotes();
    }, VOTE_TIMEOUT_MS);
  }

  /* Host casts their own vote */
  function registerHostVote(target) {
    if (game.votes[myName] !== undefined) return;
    game.votes[myName] = target;
    updateVoteProgress();
    checkAllVotesIn();
  }

  /* Update the counter on host screen */
  function updateVoteProgress() {
    const n = Object.keys(game.votes).length;
    const total = game.expectedVoters.length;
    const counter = document.getElementById("host-vote-counter");
    if (counter) counter.innerHTML = "Votes : <span class='count'>" + n + "</span> / " + total;
    const fill = document.getElementById("host-vote-fill");
    if (fill) fill.style.width = (n / total * 100) + "%";
  }

  /* Check if all living players have voted */
  function checkAllVotesIn() {
    if (Object.keys(game.votes).length >= game.expectedVoters.length) {
      clearTimeout(game.voteTimer);
      /* Small delay so host sees "all in" before result */
      setTimeout(tallyVotes, 600);
    }
  }

  /* Tally votes and determine elimination */
  function tallyVotes() {
    clearTimeout(game.voteTimer);
    const counts = {};
    const candidates = game.voteCandidates || game.joueursEnVie;
    candidates.forEach(n => { counts[n] = 0; });

    Object.values(game.votes).forEach(target => {
      if (target && counts[target] !== undefined) counts[target]++;
    });

    /* Find max */
    let maxVotes = 0;
    Object.values(counts).forEach(v => { if (v > maxVotes) maxVotes = v; });
    const tied = Object.keys(counts).filter(n => counts[n] === maxVotes);

    if (tied.length === 0 || maxVotes === 0) {
      /* Everyone abstained or edge case — go to next discussion */
      toast("Aucun vote valide. Tour suivant.");
      broadcastToClients({
        type: "phase", icon: "?",
        title: "Aucun \u00e9limin\u00e9",
        sub: "Pas de majorit\u00e9. Le d\u00e9bat continue."
      });
      document.getElementById("btn-back-discussion").style.display = "";
      startDiscussion();
      return;
    }

    if (tied.length > 1 && !game.wasRevote) {
      /* First-time tie: re-vote among tied players */
      game.wasRevote = true;
      toast("\u00c9galit\u00e9 ! Re-vote entre " + tied.join(", "));
      broadcastToClients({
        type: "phase", icon: "RE",
        title: "\u00c9galit\u00e9 !",
        sub: "Re-vote entre : " + tied.join(", ")
      });
      setTimeout(() => showVote(tied), 2000);
      return;
    }

    /* If still tied after re-vote: random among tied */
    let eliminated;
    if (tied.length > 1) {
      eliminated = tied[Math.floor(Math.random() * tied.length)];
    } else {
      eliminated = tied[0];
    }

    game.wasRevote = false;
    document.getElementById("btn-back-discussion").style.display = "";

    /* Broadcast elimination result to clients */
    broadcastToClients({
      type: "vote-result",
      eliminated,
      votes: Object.fromEntries(
        Object.entries(game.votes).filter(([,v]) => v !== null)
      )
    });

    handleElimination(eliminated);
  }

  /* ══════════════════════════════
     ELIMINATION
  ══════════════════════════════ */
  function handleElimination(target) {
    const newAlive = game.joueursEnVie.filter(p => p !== target);
    if (game.roles[target] === "mr_white") {
      game.phase = "mrwhite";
      game.joueursEnVie = newAlive;
      game.mrWhiteNom = target;
      mrWhiteAliveSnapshot = [...newAlive];

      if (netMode === "host") {
        if (target === myName) {
          // Host is Mr. White — show guess screen locally
          broadcastPhaseTo(newAlive, "\uD83D\uDC7B", "Mr. White d\u00e9masqu\u00e9 !", target + " tente de deviner le mot\u2026");
          showMrWhiteGuess(target);
        } else {
          sendToClient(target, { type: "mrwhite-guess" });
          broadcastPhaseTo(newAlive, "\uD83D\uDC7B", "Mr. White d\u00e9masqu\u00e9 !", target + " tente de deviner le mot\u2026");
          showScreen("result", "zoom");
          setText(document.getElementById("result-name"), target);
          setText(document.getElementById("result-role"), "Mr. White");
          setText(document.getElementById("result-word"), "???");
          document.getElementById("btn-next-turn").style.display = "none";
        }
      } else {
        showMrWhiteGuess(target);
      }
    } else {
      checkWin(newAlive, target);
    }
  }

  function broadcastPhaseTo(namesList, icon, title, sub) {
    namesList.forEach(name => {
      if (name !== game.mrWhiteNom) {
        sendToClient(name, { type: "phase", icon, title, sub });
      }
    });
  }

  function checkWin(alive, lastEliminated) {
    const imposteurs = alive.filter(
      p => game.roles[p] === "imposteur" || game.roles[p] === "agent_double"
    ).length;
    const citoyens = alive.length - imposteurs;
    game.joueursEnVie = alive;

    if (imposteurs === 0)            showVictory("citoyens", lastEliminated);
    else if (imposteurs >= citoyens) showVictory("imposteurs", lastEliminated);
    else                             showResult(lastEliminated);
  }

  /* ══════════════════════════════
     RESULT
  ══════════════════════════════ */
  function showResult(eliminated) {
    debugLog("phase", "result", { eliminated });
    game.phase = "result";
    game.lastEliminated = eliminated;
    setText(document.getElementById("result-name"), eliminated);
    setText(document.getElementById("result-role"), ROLE_LABELS[game.roles[eliminated]] || game.roles[eliminated]);
    setText(document.getElementById("result-word"), HIDDEN_WORD_LABEL);
    document.getElementById("btn-next-turn").style.display = "";
    showScreen("result", "zoom");

    if (netMode === "host") {
      broadcastToClients({
        type: "phase", icon: "X",
        title: eliminated + " \u00e9limin\u00e9 !",
        sub: "R\u00f4le : " + (ROLE_LABELS[game.roles[eliminated]] || game.roles[eliminated])
      });
    }
  }
  document.getElementById("btn-next-turn").addEventListener("click", startDiscussion);

  /* ══════════════════════════════
     MR WHITE GUESS (salon)
  ══════════════════════════════ */
  function showMrWhiteGuess(name) {
    setText(document.getElementById("mrwhite-name"), name);
    document.getElementById("mrwhite-input").value = "";
    showScreen("mrwhite", "zoom");
  }

  const validateMrWhite = () => {
    const raw = document.getElementById("mrwhite-input").value.trim().slice(0, 40);
    if (!raw) return toast("Entre un mot !");
    if (raw.toLowerCase() === game.motCitoyen.toLowerCase()) {
      showVictory("mr_white", game.mrWhiteNom);
    } else {
      checkWin(mrWhiteAliveSnapshot, game.mrWhiteNom);
    }
  };

  document.getElementById("btn-mrwhite-validate").addEventListener("click", validateMrWhite);
  document.getElementById("mrwhite-input").addEventListener("keydown", e => {
    if (e.key === "Enter") validateMrWhite();
  });

  /* ══════════════════════════════
     VICTORY
  ══════════════════════════════ */
  function showVictory(winner) {
    debugLog("phase", "victory", { winner });
    game.phase = "victory";
    game.winner = winner;
    const T = {
      citoyens:   { title: "Victoire Citoyenne !",  sub: "Le groupe a surv\u00e9cu \u00e0 l'infiltration." },
      imposteurs: { title: "L'Imposteur Gagne !",   sub: "L'infiltration a \u00e9t\u00e9 un succ\u00e8s total." },
      mr_white:   { title: "Mr. White l'emporte !", sub: "L'infiltration a \u00e9chou\u00e9 mais Mr. White a tout compris." }
    };
    const t = T[winner] || { title: "???", sub: "" };

    setText(document.getElementById("victory-title"),    t.title);
    setText(document.getElementById("victory-subtitle"), t.sub);
    setText(document.getElementById("v-word-citoyen"),   game.motCitoyen);
    setText(document.getElementById("v-word-imposteur"), game.motImposteur);

    const recap = document.getElementById("recap-roles");
    recap.innerHTML = "";
    players.forEach(name => {
      const rk = game.roles[name] || "--";
      const row = document.createElement("div"); row.className = "recap-row";
      const ns  = document.createElement("span");
      appendNameWithBadges(ns, name, myName);
      const tag = document.createElement("span"); tag.className = "role-tag tag-" + rk;
      setText(tag, ROLE_LABELS[rk] || rk);
      row.appendChild(ns); row.appendChild(tag);
      recap.appendChild(row);
    });

    const replayBtn = document.getElementById("btn-replay");
    replayBtn.style.display = "";
    setText(replayBtn, netMode === "host" ? "Relancer dans ce lobby" : "Rejouer une partie");

    showScreen("victory", "zoom");
    const confettiKey = [
      "host",
      winner || "",
      game.motCitoyen || "",
      game.motImposteur || ""
    ].join("|");
    launchConfettiOnce(confettiKey);

    if (netMode === "host") {
      broadcastToClients({
        type: "victory",
        title: t.title,
        sub: t.sub,
        motCitoyen: game.motCitoyen,
        motImposteur: game.motImposteur
      });
      broadcastToClients({
        type: "phase",
        icon: "FIN",
        title: VICTORY_RECAP_TOKEN,
        sub: JSON.stringify({
          roles: game.roles,
          hostName: myName
        })
      });
    }
  }

  document.getElementById("btn-replay").addEventListener("click", () => {
    if (netMode === "host" && roomRef) {
      returnOnlineMatchToLobby(myName);
      return;
    }

    if (netMode === "client" && roomRef) {
      if (clientConn) clientConn.send({ type: "rematch-request" });
      toast("Demande de relance envoyée à l'hôte.");
      return;
    }

    game = {};
    lastConfettiKey = "";
    clearGameCache();
    showScreen("menu");
  });

  /* ══════════════════════════════
     CACHE MANAGEMENT
  ══════════════════════════════ */
  function clearGameCache(options = {}) {
    const preservePlayerIdentity = options.preservePlayerIdentity !== false;
    let playerKeySnapshot = "";
    if (preservePlayerIdentity) {
      try { playerKeySnapshot = localStorage.getItem(PLAYER_KEY_STORAGE) || ""; } catch (_) {}
    }

    /* Clear all Cache Storage entries (PWA / fetch cache) */
    if ("caches" in window) {
      caches.keys().then(names => names.forEach(n => caches.delete(n)));
    }
    /* Unregister any service workers */
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs =>
        regs.forEach(r => r.unregister())
      );
    }
    /* Clear only this app local/session keys */
    try {
      Object.keys(localStorage)
        .filter((k) => /^uc_/i.test(k))
        .forEach((k) => localStorage.removeItem(k));
      if (preservePlayerIdentity && playerKeySnapshot) {
        localStorage.setItem(PLAYER_KEY_STORAGE, playerKeySnapshot);
      }
    } catch (_) {}
    try {
      Object.keys(sessionStorage)
        .filter((k) => /^uc_/i.test(k))
        .forEach((k) => sessionStorage.removeItem(k));
    } catch (_) {}
  }

  document.getElementById("btn-clear-cache").addEventListener("click", () => {
    clearGameCache();
    toast("Cache vid\u00e9 ! Rechargement\u2026");
    setTimeout(() => location.reload(), 800);
  });

  /* Show build date as version */
  const vTag = document.getElementById("version-tag");
  if (vTag) {
    const d = new Date();
    setText(vTag, "v" + d.getFullYear() + "." + (d.getMonth()+1) + "." + d.getDate());
  }

  /* ══════════════════════════════
     PEEK (re-view word)
  ══════════════════════════════ */
  const peekOverlay = document.getElementById("peek-overlay");
  const peekStepSelect = document.getElementById("peek-step-select");
  const peekStepWord = document.getElementById("peek-step-word");
  peekStepWord.style.display = "none";

  function closePeek() { peekOverlay.classList.remove("show"); }
  document.getElementById("peek-close").addEventListener("click", closePeek);
  document.getElementById("peek-ok").addEventListener("click", closePeek);

  document.getElementById("btn-peek").addEventListener("click", () => {
    if (netMode === "client" || netMode === "host") {
      /* Online modes: only show your own word */
      peekStepSelect.style.display = "none";
      peekStepWord.style.display = "";
      setText(document.getElementById("peek-name"), myName);
      const roleArea = document.getElementById("peek-role-area");
      roleArea.innerHTML = "";
      if (clientRoleName) {
        const badge = document.createElement("div");
        badge.className = "role-badge";
        setText(badge, clientRoleName);
        roleArea.appendChild(badge);
      }
      const ownWord = netMode === "client" ? clientWord : (game.mots && game.mots[myName]) || "";
      setText(document.getElementById("peek-word-text"), ownWord);
    } else {
      /* Salon: pick player first */
      peekStepWord.style.display = "none";
      peekStepSelect.style.display = "";
      const grid = document.getElementById("peek-players");
      grid.innerHTML = "";
      (game.joueursEnVie || []).forEach(name => {
        const btn = document.createElement("button");
        btn.className = "btn btn-secondary full";
        btn.style.marginBottom = ".5rem";
        setText(btn, name);
        btn.addEventListener("click", () => {
          peekStepSelect.style.display = "none";
          peekStepWord.style.display = "";
          setText(document.getElementById("peek-name"), name);
          const roleArea = document.getElementById("peek-role-area");
          roleArea.innerHTML = "";
          const role = game.roles[name];
          if (SPECIAL_ROLES.has(role)) {
            const badge = document.createElement("div");
            badge.className = "role-badge";
            setText(badge, getSpecialRoleRevealLabel(role));
            roleArea.appendChild(badge);
          }
          setText(document.getElementById("peek-word-text"), game.mots[name]);
        });
        grid.appendChild(btn);
      });
    }
    peekOverlay.classList.add("show");
  });

  /* ══════════════════════════════
     INPUT FOCUS AUTO-SCROLL
  ══════════════════════════════ */
  document.querySelectorAll('input[type="text"], textarea').forEach((el) => {
    el.addEventListener("focus", () => {
      const isTouchUi = window.matchMedia("(hover: none)").matches || ("ontouchstart" in window);
      if (!isTouchUi) return;
      setTimeout(() => {
        try {
          el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        } catch (_) {}
      }, 180);
    });
  });

  window.addEventListener("online", updateNetworkBanner);
  window.addEventListener("offline", updateNetworkBanner);
  window.addEventListener("resize", syncMenuRulesDisclosure);
  initMenuRulesDisclosure();
  syncMenuRulesDisclosure();
  updateNetworkBanner();

})();