/* ══════════════════════════════════════════════════════
   LUNDERCOVER — Network Manager (Firebase RTDB abstraction)
   ══════════════════════════════════════════════════════ */

/**
 * Manages all Firebase Realtime Database operations.
 * No game logic, no DOM manipulation — just network I/O.
 *
 * @callback NetworkCallbacks
 *   onConnectionChange(connected: boolean)
 *   onPlayersChange(players: {uid, name, isHost}[])
 *   onPlayerJoined(uid, name)
 *   onMessageReceived(fromUid, data)
 */

export class NetworkManager {
  constructor() {
    this.db = null;
    this.auth = null;
    this.myUid = "";
    this.roomRef = null;
    this.isHostRoom = false;
    this.roomCode = "";
    this.connected = false;
    this._infoConnectedRef = null;
    this._listeners = [];
    this._presenceTimer = null;
    this._callbacks = {};
    this._playerKey = this._makePlayerKey();
  }

  /* ─── CALLBACKS ────────────────────────────────── */

  on(event, cb) {
    if (!this._callbacks[event]) this._callbacks[event] = [];
    this._callbacks[event].push(cb);
  }

  off(event, cb) {
    if (!this._callbacks[event]) return;
    if (cb) {
      this._callbacks[event] = this._callbacks[event].filter(fn => fn !== cb);
    } else {
      delete this._callbacks[event];
    }
  }

  _emit(event, ...args) {
    const cbs = this._callbacks[event];
    if (cbs) cbs.forEach(cb => { try { cb(...args); } catch (_) {} });
  }

  /* ─── PLAYER IDENTITY ──────────────────────────── */

  _makePlayerKey() {
    try {
      const existing = localStorage.getItem("uc_player_key_v1");
      if (existing && existing.length >= 12) return existing;
    } catch (_) {}
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        const key = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
        localStorage.setItem("uc_player_key_v1", key);
        return key;
      }
    } catch (_) {}
    const fallback = "pk_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("uc_player_key_v1", fallback);
    return fallback;
  }

  getPlayerKey() { return this._playerKey; }

  /* ─── FIREBASE INIT ────────────────────────────── */

  async init() {
    if (this.db && this.auth && this.myUid) return;
    if (!window.firebase) throw new Error("Firebase SDK missing");
    if (!window.FIREBASE_CONFIG) throw new Error("Firebase config missing");
    if (!window.firebase.apps.length) {
      try { window.firebase.initializeApp(window.FIREBASE_CONFIG); }
      catch (e) { throw new Error(NetworkManager.formatError(e)); }
    }
    this.db = window.firebase.database();
    this.auth = window.firebase.auth();
    try {
      if (!this.auth.currentUser) await this.auth.signInAnonymously();
    } catch (e) {
      throw new Error(NetworkManager.formatError(e));
    }
    this.myUid = this.auth.currentUser.uid;

    // Connection monitor
    if (!this._infoConnectedRef) {
      this._infoConnectedRef = this.db.ref(".info/connected");
      this._infoConnectedRef.on("value", snap => {
        this.connected = !!snap.val();
        this._emit("connectionChange", this.connected);
      });
    }
  }

  /* ─── ROOM CREATION ────────────────────────────── */

  async createRoom() {
    await this.init();
    this.isHostRoom = true;

    // Try up to 8 random codes
    for (let i = 0; i < 8; i++) {
      const code = this._makeCode();
      const ref = this.db.ref("rooms/" + code);
      const tx = await ref.child("meta").transaction(curr => {
        if (curr) return;
        return { hostUid: this.myUid, status: "lobby", createdAt: Date.now() };
      });
      if (tx.committed) {
        this.roomCode = code;
        this.roomRef = ref;
        break;
      }
    }
    if (!this.roomRef) throw new Error("Could not create room");

    // Write host player entry
    const meRef = this.roomRef.child("players").child(this.myUid);
    await meRef.set({
      name: this._hostName || "Hôte",
      isHost: true,
      connected: true,
      playerKey: this._playerKey,
      joinedAt: Date.now()
    });
    meRef.onDisconnect().update({ connected: false });

    // Close room on host disconnect
    this.roomRef.child("meta").child("status").onDisconnect().set("closed");

    // Listen for player changes
    this._listen("players", snap => {
      const list = [];
      snap.forEach(ch => {
        const v = ch.val() || {};
        if (v.name && v.connected !== false) {
          list.push({ uid: ch.key, name: v.name, isHost: !!v.isHost });
        }
      });
      this._emit("playersChange", list);
    });

    // Listen for client actions
    this._listen("actions", snap => {
      const data = snap.val();
      if (data) {
        this._emit("messageReceived", data.fromUid, data);
        snap.ref.remove().catch(() => {});
      }
    });

    this._startPresence();
    return this.roomCode;
  }

  setHostName(name) { this._hostName = name; }

  /* ─── ROOM JOINING ─────────────────────────────── */

  async joinRoom(code, myName) {
    await this.init();
    this.isHostRoom = false;
    this.roomCode = code.toUpperCase();
    this.roomRef = this.db.ref("rooms/" + this.roomCode);

    // Read meta
    const metaSnap = await this.roomRef.child("meta").once("value");
    const meta = metaSnap.val();
    if (!meta || !meta.hostUid) throw new Error("Partie introuvable.");
    if (meta.status === "closed") throw new Error("Salon ferm\u00e9.");

    // Check name conflicts
    const playersSnap = await this.roomRef.child("players").once("value");
    const existing = [];
    playersSnap.forEach(ch => {
      const v = ch.val() || {};
      if (v.name) existing.push({ uid: ch.key, name: v.name, connected: v.connected !== false, playerKey: String(v.playerKey || "") });
    });

    const sameNameConnected = existing.some(r => r.uid !== this.myUid && r.name === myName && r.connected);
    if (meta.status === "lobby" && sameNameConnected) {
      throw new Error("Ce pseudo est d\u00e9j\u00e0 pris.");
    }

    // Register self
    const meRef = this.roomRef.child("players").child(this.myUid);
    await meRef.set({
      name: myName,
      isHost: false,
      connected: true,
      playerKey: this._playerKey,
      reconnecting: meta.status !== "lobby",
      joinedAt: Date.now()
    });
    meRef.onDisconnect().update({ connected: false });

    // Listen for room closure
    this._listen("meta", snap => {
      const m = snap.val();
      if (!m || m.status === "closed") {
        this._emit("roomClosed");
      }
    });

    // Listen for player changes
    this._listen("players", snap => {
      const list = [];
      snap.forEach(ch => {
        const v = ch.val() || {};
        if (v.name && v.connected !== false) {
          list.push({ uid: ch.key, name: v.name, isHost: !!v.isHost });
        }
      });
      this._emit("playersChange", list);
    });

    // Listen for host messages
    const inboxRef = this.roomRef.child("mailboxes").child(this.myUid);
    this._listen(inboxRef, "child_added", snap => {
      const data = snap.val();
      if (data) {
        this._emit("messageReceived", null, data);
        snap.ref.remove().catch(() => {});
      }
    });

    this._startPresence();
    return { code: this.roomCode, meta };
  }

  /* ─── MESSAGING ────────────────────────────────── */

  sendToHost(msg) {
    if (!this.roomRef || this.isHostRoom) return;
    this.roomRef.child("actions").push({
      ...msg,
      fromUid: this.myUid,
      ts: Date.now()
    }).catch(() => {});
  }

  sendToClient(uid, msg) {
    if (!this.roomRef || !uid) return;
    this.roomRef.child("mailboxes").child(uid).push({
      ...msg, ts: Date.now()
    }).catch(() => {});
  }

  broadcastToClients(msg) {
    // Called by host to send to all connected clients
    if (!this.roomRef || !this.isHostRoom) return;
    const playersRef = this.roomRef.child("players");
    playersRef.once("value").then(snap => {
      snap.forEach(ch => {
        if (ch.key === this.myUid) return;
        const v = ch.val() || {};
        if (v.name && v.connected !== false) {
          this.sendToClient(ch.key, msg);
        }
      });
    }).catch(() => {});
  }

  findClientUid(playerName) {
    return new Promise((resolve) => {
      if (!this.roomRef) return resolve(null);
      this.roomRef.child("players").once("value").then(snap => {
        let found = null;
        snap.forEach(ch => {
          const v = ch.val() || {};
          if (v.name === playerName && v.connected !== false) found = ch.key;
        });
        resolve(found);
      }).catch(() => resolve(null));
    });
  }

  async sendToClientByName(playerName, msg) {
    const uid = await this.findClientUid(playerName);
    if (uid) this.sendToClient(uid, msg);
  }

  /* ─── ROOM STATE ───────────────────────────────── */

  async updateMeta(update) {
    if (!this.roomRef || !this.isHostRoom) return;
    await this.roomRef.child("meta").update(update).catch(() => {});
  }

  async getDeckState() {
    if (!this.roomRef) return {};
    const snap = await this.roomRef.child("pairDeckState").once("value");
    return snap.val() || {};
  }

  setDeckState(state) {
    if (!this.roomRef || !this.isHostRoom) return;
    this.roomRef.child("pairDeckState").set(state).catch(() => {});
  }

  /* ─── CHAT ──────────────────────────────────────── */

  async sendChatMessage(text) {
    if (!this.roomRef) return;
    this.roomRef.child("chat").push({
      from: this.isHostRoom ? this._hostName : this._lastJoinName,
      text: String(text).trim().slice(0, 200),
      ts: Date.now()
    }).catch(() => {});
  }

  listenChat(callback) {
    if (!this.roomRef) return;
    this._listen(this.roomRef.child("chat").limitToLast(50), "child_added", snap => {
      const data = snap.val();
      if (data) callback(data.from, data.text, data.ts);
    });
  }

  /* ─── CLEANUP ───────────────────────────────────── */

  async leaveRoom() {
    this._stopPresence();
    if (this.roomRef && this.myUid) {
      try {
        if (this.isHostRoom) {
          // Delete chat messages to avoid accumulating garbage
          this.roomRef.child("chat").remove().catch(() => {});
          // Delete mailboxes and actions
          this.roomRef.child("mailboxes").remove().catch(() => {});
          this.roomRef.child("actions").remove().catch(() => {});
          // Mark as closed, then delete entire room after 10s to let clients disconnect cleanly
          await this.roomRef.child("meta").update({ status: "closed" }).catch(() => {});
          setTimeout(() => {
            try { this.roomRef && this.roomRef.remove().catch(() => {}); } catch (_) {}
          }, 10000);
        } else {
          // Client leaves — just mark disconnected
          await this.roomRef.child("players").child(this.myUid)
            .update({ connected: false }).catch(() => {});
        }
      } catch (_) {}
    }
    this._removeListeners();
    this.roomRef = null;
    this.isHostRoom = false;
    this.roomCode = "";
  }

  disconnect() {
    this.leaveRoom();
    if (this._infoConnectedRef) {
      this._infoConnectedRef.off("value");
      this._infoConnectedRef = null;
    }
  }

  /* ─── INTERNAL ──────────────────────────────────── */

  _startPresence() {
    this._stopPresence();
    if (!this.roomRef) return;
    const meRef = this.roomRef.child("players").child(this.myUid);
    this._presenceTimer = setInterval(() => {
      meRef.update({ connected: true }).catch(() => {});
    }, 15000);
  }

  _stopPresence() {
    if (this._presenceTimer) {
      clearInterval(this._presenceTimer);
      this._presenceTimer = null;
    }
  }

  _listen(refOrPath, arg2, arg3) {
    // refOrPath can be a path string (relative to roomRef) or a Firebase ref
    // arg2 can be an event string or undefined
    // arg3 is the callback
    let ref, event, cb;
    if (typeof arg2 === "function") {
      ref = typeof refOrPath === "string" ? this.roomRef.child(refOrPath) : refOrPath;
      event = "value";
      cb = arg2;
    } else {
      ref = typeof refOrPath === "string" ? this.roomRef.child(refOrPath) : refOrPath;
      event = arg2 || "value";
      cb = arg3;
    }
    ref.on(event, cb);
    this._listeners.push({ ref, event, cb });
  }

  _removeListeners() {
    this._listeners.forEach(({ ref, event, cb }) => {
      try { ref.off(event, cb); } catch (_) {}
    });
    this._listeners = [];
  }

  _makeCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    let code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  setLastJoinName(name) { this._lastJoinName = name; }

  /* ─── ERROR FORMATTING ──────────────────────────── */

  static formatError(err) {
    if (!err) return "Erreur inconnue.";
    const code = String(err.code || "");
    const message = String(err.message || "");

    if (code.includes("permission-denied") || message.includes("permission_denied"))
      return "Acc\u00e8s refus\u00e9 par les r\u00e8gles Firebase. V\u00e9rifie les permissions de la base de donn\u00e9es.";
    if (code.includes("network-request-failed") || message.includes("network"))
      return "Probl\u00e8me r\u00e9seau. V\u00e9rifie ta connexion Internet ou d\u00e9sactive ton VPN.";
    if (code.includes("too-many-requests"))
      return "Trop de requ\u00eates. Patientez quelques secondes.";
    if (code.includes("operation-not-allowed"))
      return "L'authentification anonyme est d\u00e9sactiv\u00e9e dans Firebase. Active-la dans la console Firebase > Authentication > Sign-in method.";
    if (code.includes("invalid-api-key"))
      return "Cl\u00e9 API Firebase invalide. V\u00e9rifie ton fichier firebase-config.js.";
    if (code.includes("app-deleted") || code.includes("no-app"))
      return "Configuration Firebase invalide ou non charg\u00e9e.";
    if (code.includes("timeout") || code.includes("TIMEOUT"))
      return "D\u00e9lai d\u00e9pass\u00e9. V\u00e9rifie ta connexion et r\u00e9essaie.";
    if (code.includes("unavailable") || code.includes("UNAVAILABLE"))
      return "Firebase est temporairement indisponible. R\u00e9essaie dans quelques instants.";
    if (message) return message.slice(0, 160);
    return "Erreur inconnue.";
  }
}
