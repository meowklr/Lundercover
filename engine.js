/* ══════════════════════════════════════════════════════
   LUNDERCOVER — Game Engine (pure logic, no DOM, no I/O)
   ══════════════════════════════════════════════════════ */

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
const NAME_REGEX = /^[\p{L}\p{N} '\-]+$/u;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function canonicalPairKey(pair) {
  const a = String(pair[0] || "").trim().toLowerCase();
  const b = String(pair[1] || "").trim().toLowerCase();
  return a < b ? a + "|" + b : b + "|" + a;
}

/**
 * Pure game engine. No DOM, no network, no side effects.
 * All methods return data; callers decide how to render/persist.
 */
export class GameEngine {
  constructor() {
    this.players = [];
    this.config = {
      nbImposteurs: 1,
      difficulte: "facile",
      rolesActifs: { espion: false, mr_white: false, agent_double: false },
      voteTimeoutMs: 60000,
      customWords: []  // user-provided [{citoyen, imposteur}]
    };
    this.state = this._initialState();
    this._deckState = {
      facile: { deck: [], lastKey: "" },
      difficile: { deck: [], lastKey: "" }
    };
  }

  /* ─── FACTORY ─────────────────────────────────── */

  _initialState() {
    return {
      phase: null,        // "reveal" | "discussion" | "vote" | "result" | "mrwhite" | "victory"
      roles: {},          // name → "citoyen" | "imposteur" | "espion" | "mr_white" | "agent_double"
      mots: {},           // name → word string
      motCitoyen: "",
      motImposteur: "",
      joueursEnVie: [],
      talkingOrder: [],
      turn: 0,
      votes: {},
      voteCandidates: null,
      expectedVoters: null,
      voteInterval: null,
      voteTimer: null,
      wasRevote: false,
      mrWhiteNom: null,
      mrWhiteAliveSnapshot: [],
      lastEliminated: "",
      winner: null,       // "citoyens" | "imposteurs" | "mr_white" | null
      revealedIndex: 0
    };
  }

  /* ─── PLAYER MANAGEMENT ───────────────────────── */

  addPlayer(name) {
    const raw = String(name).trim().slice(0, 20);
    if (!raw) return { ok: false, error: "Nom vide." };
    if (!NAME_REGEX.test(raw)) return { ok: false, error: "Nom invalide (lettres/chiffres uniquement)." };
    if (this.players.includes(raw)) return { ok: false, error: "Ce nom existe d\u00e9j\u00e0." };
    if (this.players.length >= MAX_PLAYERS) return { ok: false, error: "Maximum " + MAX_PLAYERS + " joueurs." };
    this.players.push(raw);
    return { ok: true };
  }

  removePlayer(name) {
    this.players = this.players.filter(p => p !== name);
  }

  setPlayers(names) {
    this.players = [...names];
  }

  static validateName(name) {
    return NAME_REGEX.test(String(name).trim());
  }

  static cleanName(name) {
    return String(name).trim().slice(0, 20);
  }

  /* ─── CONFIGURATION ────────────────────────────── */

  setDifficulty(diff) {
    if (diff === "facile" || diff === "difficile") {
      this.config.difficulte = diff;
    }
  }

  setImposteurCount(n) {
    const max = this._maxImposteursForSetup();
    if (n >= 1 && n <= Math.min(4, max)) {
      this.config.nbImposteurs = n;
    }
  }

  toggleRole(roleKey) {
    if (Object.hasOwn(this.config.rolesActifs, roleKey)) {
      this.config.rolesActifs[roleKey] = !this.config.rolesActifs[roleKey];
    }
  }

  setVoteTimeout(ms) {
    this.config.voteTimeoutMs = Math.max(10000, Math.min(120000, Number(ms) || 60000));
  }

  setCustomWords(words) {
    this.config.customWords = Array.isArray(words) ? words.slice(0, 200) : [];
  }

  getCustomWordPairs() {
    return this.config.customWords.filter(
      w => w && typeof w.citoyen === "string" && typeof w.imposteur === "string"
    ).map(w => [String(w.citoyen), String(w.imposteur)]);
  }

  _maxImposteursForSetup() {
    if (this.players.length < MIN_PLAYERS) return 4;
    const A = this.config.rolesActifs.agent_double ? 1 : 0;
    const otherSpecials = (this.config.rolesActifs.espion ? 1 : 0) + (this.config.rolesActifs.mr_white ? 1 : 0);
    // Need: imposteurs + agent_double < citoyens
    // → imposteurs + A < players - imposteurs - otherSpecials - A
    // → 2*imposteurs < players - otherSpecials - 2*A
    const max = Math.floor((this.players.length - otherSpecials - 2 * A) / 2);
    return Math.max(1, Math.min(4, max));
  }

  /* ─── ROLE DISTRIBUTION ────────────────────────── */

  getDistribution() {
    const nbPlayers = Math.max(0, this.players.length);
    const nbImposteurs = this.config.nbImposteurs;
    const nbEspion = this.config.rolesActifs.espion ? 1 : 0;
    const nbMrWhite = this.config.rolesActifs.mr_white ? 1 : 0;
    const nbAgentDouble = this.config.rolesActifs.agent_double ? 1 : 0;
    const nbSpeciaux = nbEspion + nbMrWhite + nbAgentDouble;
    const nbCitoyens = Math.max(0, nbPlayers - nbImposteurs - nbSpeciaux);
    const nonCitoyens = nbImposteurs + nbSpeciaux;
    const isValid = nbPlayers >= MIN_PLAYERS && nonCitoyens < nbPlayers;
    return {
      nbPlayers, nbCitoyens, nbImposteurs,
      nbEspion, nbMrWhite, nbAgentDouble,
      isValid, difficulte: this.config.difficulte
    };
  }

  canStart() {
    const dist = this.getDistribution();
    if (!dist.isValid) return { ok: false, error: "Il faut au moins " + MIN_PLAYERS + " joueurs." };
    const totalNonCitoyens = this.config.nbImposteurs + Object.values(this.config.rolesActifs).filter(Boolean).length;
    if (totalNonCitoyens >= this.players.length) {
      return { ok: false, error: "Trop de r\u00f4les sp\u00e9ciaux pour ce nombre de joueurs." };
    }
    const impostorTeam = dist.nbImposteurs + dist.nbAgentDouble;
    if (impostorTeam >= dist.nbCitoyens) {
      return { ok: false, error: "Les imposteurs doivent \u00eatre moins nombreux que les citoyens." };
    }
    return { ok: true };
  }

  /* ─── WORD PAIR SELECTION ──────────────────────── */

  _getPool() {
    const customs = this.getCustomWordPairs();
    if (customs.length >= 4) return customs;
    if (customs.length > 0) {
      const standard = globalThis.PAIRES?.[this.config.difficulte] || [];
      return customs.concat(standard);
    }
    return globalThis.PAIRES?.[this.config.difficulte] || [];
  }

  pickWordPair() {
    const pool = this._getPool();
    if (pool.length === 0) return null;

    const difficulty = this.config.difficulte;
    const ds = this._deckState[difficulty] || (this._deckState[difficulty] = { deck: [], lastKey: "" });

    if (ds.deck.length === 0) {
      ds.deck = shuffle(pool).map(pair => ({ pair, key: canonicalPairKey(pair) }));
      if (ds.deck.length > 1 && ds.lastKey && ds.deck[0].key === ds.lastKey) {
        const idx = ds.deck.findIndex(item => item.key !== ds.lastKey);
        if (idx > 0) [ds.deck[0], ds.deck[idx]] = [ds.deck[idx], ds.deck[0]];
      }
    }

    const next = ds.deck.shift();
    if (!next) return null;
    ds.lastKey = next.key;
    return next.pair;
  }

  getDeckState() { return this._deckState; }
  setDeckState(state) { if (state) this._deckState = state; }

  /* ─── START GAME ───────────────────────────────── */

  /** Returns { roles, mots, motCitoyen, motImposteur, joueursEnVie }
   *  or null if no word pair available. */
  startGame() {
    const check = this.canStart();
    if (!check.ok) return { error: check.error };

    const pair = this.pickWordPair();
    if (!pair) return { error: "Aucune paire de mots disponible." };

    // Randomly flip A/B
    const [motA, motB] = Math.random() > 0.5 ? [pair[0], pair[1]] : [pair[1], pair[0]];

    this.state = this._initialState();
    this.state.phase = "reveal";
    this.state.motCitoyen = motA;
    this.state.motImposteur = motB;

    const shuffled = shuffle(this.players);
    const roles = {}, mots = {};
    let ptr = 0;

    for (let i = 0; i < this.config.nbImposteurs; i++) {
      const p = shuffled[ptr++]; roles[p] = "imposteur"; mots[p] = motB;
    }
    if (this.config.rolesActifs.espion) {
      const p = shuffled[ptr++]; roles[p] = "espion"; mots[p] = motA + " / " + motB;
    }
    if (this.config.rolesActifs.mr_white) {
      const p = shuffled[ptr++]; roles[p] = "mr_white"; mots[p] = "???";
    }
    if (this.config.rolesActifs.agent_double) {
      const p = shuffled[ptr++]; roles[p] = "agent_double"; mots[p] = motA;
    }
    while (ptr < shuffled.length) {
      const p = shuffled[ptr++]; roles[p] = "citoyen"; mots[p] = motA;
    }

    this.state.roles = roles;
    this.state.mots = mots;
    this.state.joueursEnVie = [...this.players];

    return {
      roles: { ...roles },
      mots: { ...mots },
      motCitoyen: motA,
      motImposteur: motB,
      joueursEnVie: [...this.players]
    };
  }

  /* ─── REVEAL ───────────────────────────────────── */

  getRevealPlayer(index) {
    return this.players[index] || null;
  }

  getRevealProgress() {
    return {
      current: this.state.revealedIndex + 1,
      total: this.players.length
    };
  }

  advanceReveal() {
    if (this.state.revealedIndex < this.players.length - 1) {
      this.state.revealedIndex++;
      return { done: false, name: this.players[this.state.revealedIndex] };
    }
    return { done: true };
  }

  /* ─── DISCUSSION ───────────────────────────────── */

  startDiscussion() {
    this.state.phase = "discussion";
    this.state.turn++;
    this.state.talkingOrder = shuffle(this.state.joueursEnVie);
    return {
      turn: this.state.turn,
      order: [...this.state.talkingOrder],
      joueursEnVie: [...this.state.joueursEnVie]
    };
  }

  /* ─── VOTE ─────────────────────────────────────── */

  startVote(candidates) {
    this.state.phase = "vote";
    const votable = candidates || this.state.joueursEnVie;
    this.state.votes = {};
    this.state.expectedVoters = [...this.state.joueursEnVie];
    this.state.voteCandidates = votable;
    this.state.wasRevote = !!(candidates && candidates.length < this.state.joueursEnVie.length);
    return {
      candidates: [...votable],
      isRevote: !!candidates,
      voteTimeoutMs: this.config.voteTimeoutMs
    };
  }

  castVote(voter, target) {
    if (!this.state.joueursEnVie.includes(voter)) return { ok: false, error: "Voter not alive" };
    if (!this.state.voteCandidates || !this.state.voteCandidates.includes(target)) return { ok: false, error: "Invalid target" };
    if (voter === target) return { ok: false, error: "Cannot vote for self" };
    if (Object.hasOwn(this.state.votes, voter)) return { ok: false, error: "Already voted" };
    this.state.votes[voter] = target;
    return { ok: true };
  }

  getVoteProgress() {
    return {
      cast: Object.keys(this.state.votes).length,
      total: this.state.expectedVoters.length
    };
  }

  allVotesIn() {
    return Object.keys(this.state.votes).length >= this.state.expectedVoters.length;
  }

  /** Returns { eliminated, tied, noVotes, votes: { [voter]: target } } */
  tallyVotes() {
    const counts = {};
    const candidates = this.state.voteCandidates || this.state.joueursEnVie;
    candidates.forEach(n => { counts[n] = 0; });

    Object.values(this.state.votes).forEach(target => {
      if (target && counts[target] !== undefined) counts[target]++;
    });

    let maxVotes = 0;
    Object.values(counts).forEach(v => { if (v > maxVotes) maxVotes = v; });
    const tied = Object.keys(counts).filter(n => counts[n] === maxVotes);
    const voteSnapshot = { ...this.state.votes };

    if (tied.length === 0 || maxVotes === 0) {
      return { noVotes: true, votes: voteSnapshot };
    }

    if (tied.length > 1 && !this.state.wasRevote) {
      this.state.wasRevote = true;
      return { tied: [...tied], votes: voteSnapshot };
    }

    // Determine eliminated (random if still tied after re-vote)
    let eliminated;
    if (tied.length > 1) {
      eliminated = tied[Math.floor(Math.random() * tied.length)];
    } else {
      eliminated = tied[0];
    }

    this.state.wasRevote = false;
    return { eliminated, votes: voteSnapshot, counts };
  }

  /* ─── ELIMINATION ──────────────────────────────── */

  handleElimination(target) {
    const newAlive = this.state.joueursEnVie.filter(p => p !== target);
    const isMrWhite = this.state.roles[target] === "mr_white";

    if (isMrWhite) {
      this.state.phase = "mrwhite";
      this.state.joueursEnVie = newAlive;
      this.state.mrWhiteNom = target;
      this.state.mrWhiteAliveSnapshot = [...newAlive];
      return { mrWhite: true, name: target, alive: [...newAlive] };
    }

    return this._finalizeElimination(newAlive, target);
  }

  _finalizeElimination(alive, lastEliminated) {
    // Count real impostors (not agent_double) for citizen victory
    const realImpostors = alive.filter(
      p => this.state.roles[p] === "imposteur"
    ).length;

    // Count impostor team (imposteurs + agent_double) for impostor victory
    const impostorTeam = alive.filter(
      p => this.state.roles[p] === "imposteur" || this.state.roles[p] === "agent_double"
    ).length;

    const citoyens = alive.length - impostorTeam;
    this.state.joueursEnVie = alive;
    this.state.lastEliminated = lastEliminated;

    if (realImpostors === 0) {
      this.state.phase = "victory";
      this.state.winner = "citoyens";
      return { victory: "citoyens", eliminated: lastEliminated, alive: [...alive] };
    }

    if (impostorTeam >= citoyens) {
      this.state.phase = "victory";
      this.state.winner = "imposteurs";
      return { victory: "imposteurs", eliminated: lastEliminated, alive: [...alive] };
    }

    this.state.phase = "result";
    return { result: true, eliminated: lastEliminated, alive: [...alive] };
  }

  /* ─── MR WHITE GUESS ───────────────────────────── */

  checkMrWhiteGuess(guess) {
    const raw = String(guess || "").trim().slice(0, 40);
    if (!raw) return { ok: false, error: "Guess empty" };
    const correct = raw.toLowerCase() === this.state.motCitoyen.toLowerCase();
    if (correct) {
      this.state.phase = "victory";
      this.state.winner = "mr_white";
      return { correct: true, victory: "mr_white" };
    }
    return this._finalizeElimination(this.state.mrWhiteAliveSnapshot, this.state.mrWhiteNom);
  }

  /* ─── STATE EXPORT ─────────────────────────────── */

  getState() {
    return {
      phase: this.state.phase,
      roles: { ...this.state.roles },
      mots: { ...this.state.mots },
      motCitoyen: this.state.motCitoyen,
      motImposteur: this.state.motImposteur,
      joueursEnVie: [...this.state.joueursEnVie],
      turn: this.state.turn,
      winner: this.state.winner,
      lastEliminated: this.state.lastEliminated,
      mrWhiteNom: this.state.mrWhiteNom,
      distribution: this.getDistribution()
    };
  }

  getVictoryInfo() {
    const T = {
      citoyens:   { title: "Victoire Citoyenne !",  sub: "Le groupe a surv\u00e9cu \u00e0 l'infiltration." },
      imposteurs: { title: "L'Imposteur Gagne !",   sub: "L'infiltration a \u00e9t\u00e9 un succ\u00e8s total." },
      mr_white:   { title: "Mr. White l'emporte !", sub: "L'infiltration a \u00e9chou\u00e9 mais Mr. White a tout compris." }
    };
    return T[this.state.winner] || { title: "Fin !", sub: "" };
  }

  /* ─── RESET ────────────────────────────────────── */

  reset({ keepPlayers = false, keepConfig = false } = {}) {
    const savedPlayers = keepPlayers ? [...this.players] : [];
    const savedConfig = keepConfig ? { ...this.config } : undefined;
    this.players = savedPlayers;
    if (!keepConfig) {
      this.config = {
        nbImposteurs: 1,
        difficulte: "facile",
        rolesActifs: { espion: false, mr_white: false, agent_double: false },
        voteTimeoutMs: 60000,
        customWords: []
      };
    } else {
      this.config = savedConfig;
    }
    this.state = this._initialState();
  }

  /* ─── STATIC UTILS ─────────────────────────────── */

  static get ROLE_LABELS() { return ROLE_LABELS; }
  static get ROLES_INFO() { return ROLES_INFO; }
  static get SPECIAL_ROLES() { return SPECIAL_ROLES; }
  static getSpecialRoleRevealLabel(role) {
    return SPECIAL_ROLES.has(role)
      ? ("ROLE SPECIAL : " + ROLES_INFO[role].nom.toUpperCase())
      : "";
  }
}
