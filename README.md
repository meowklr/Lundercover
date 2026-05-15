# LUNDERCOVER

Jeu d'imposteur en ligne entre amis. Chaque joueur reçoit un mot secret — les citoyens ont le même, les imposteurs un mot proche mais différent. Discutez, bluffez, votez.

## Modes

| Mode | Fonctionnement |
|---|---|
| **Salon** | Un seul appareil circule entre les joueurs (local) |
| **Créer une partie** | Héberge une partie en ligne, partage un code à 4 lettres |
| **Rejoindre** | Entre le code d'une partie existante |

## Rôles

| Rôle | Description |
|---|---|
| **Citoyen** | Reçoit le mot citoyen, doit démasquer les imposteurs |
| **Imposteur** | Reçoit un mot différent, doit se faire passer pour citoyen |
| **Espion** | Connaît les deux mots, joue avec les citoyens |
| **Mr. White** | N'a aucun mot, doit deviner le mot citoyen s'il est éliminé |
| **Agent Double** | A le mot citoyen mais gagne avec les imposteurs |

## Déploiement

```bash
# 1. Copier la config Firebase
cp firebase-config.example.js firebase-config.js
# 2. Remplir les valeurs Firebase
# 3. Déployer sur Netlify (ou tout hébergement statique)
```

Le `netlify.toml` configure les headers CSP pour Firebase.

## Structure

```
index.html        — Interface (SPA)
style.css         — Styles (light/dark mode)
script.js         — Orchestrateur UI + logique
engine.js         — Moteur de jeu (pur, sans DOM)
network.js        — Gestionnaire Firebase RTDB
chat.js           — Chat de discussion en ligne
words.js          — Paires de mots (facile/difficile)
sw.js             — Service Worker PWA
```

## Tech

- Firebase Realtime Database (multi-joueur)
- Firebase Auth anonyme
- PWA (manifest, service worker)
- Dark mode (préférence système ou manuel)
