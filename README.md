# LUNDERCOVER

Jeu d'imposteur en ligne ou en local pour 3 à 12 joueurs. Chaque participant reçoit un mot secret. Les citoyens partagent le même mot, tandis que les imposteurs reçoivent un mot proche mais différent. Les joueurs donnent chacun un indice, discutent, puis votent pour éliminer les suspects.

## Fonctionnement et modes de jeu

Trois modes sont disponibles depuis le menu principal :

- Salon : un seul appareil circule entre les joueurs pour jouer en local.
- Créer une partie : un joueur héberge une partie en ligne et partage un code à 4 lettres.
- Rejoindre : les autres joueurs entrent le code du salon pour se connecter.

Cinq rôles peuvent être activés selon la configuration de la partie :

| Rôle | Fonctionnement |
|---|---|
| Citoyen | Reçoit le mot citoyen et doit identifier les imposteurs |
| Imposteur | Reçoit un mot différent et doit se faire passer pour un citoyen |
| Espion | Connaît les deux mots et joue avec les citoyens |
| Mr. White | Ne reçoit aucun mot et doit deviner le mot citoyen s'il est éliminé |
| Agent Double | Reçoit le mot citoyen mais gagne avec les imposteurs |

Le jeu inclut deux niveaux de difficulté pour les paires de mots (facile et difficile), la possibilité d'ajouter jusqu'à 200 paires personnalisées, un minuteur de vote configurable et un thème clair ou sombre.

## Stack technique

L'application est construite sans framework ni outil de build, uniquement en HTML, CSS et JavaScript (modules ES côté navigateur).

Le multijoueur repose sur Firebase Realtime Database et Firebase Auth anonyme (SDK compat v10.13.2 chargé depuis gstatic). Le projet intègre un manifeste et un service worker pour fonctionner comme PWA, ainsi qu'un fichier `netlify.toml` configurant la politique de sécurité de contenu (CSP) pour Firebase et Google Fonts.

## Prérequis

- Un navigateur récent compatible avec les modules ES.
- Un serveur HTTP local pour tester en développement (l'ouverture directe via `file://` bloque les imports de modules ES), par exemple Python 3 ou Node.js.
- Un compte Firebase avec Realtime Database et l'authentification anonyme activées si vous souhaitez utiliser votre propre base de données.

## Installation et lancement

1. Cloner le dépôt :

```bash
git clone https://github.com/meowklr/lundercover.git
cd lundercover
```

2. Configurer Firebase (optionnel si vous utilisez votre propre projet) :

Copier `firebase-config.example.js` vers `firebase-config.js` et renseigner les valeurs de votre application web Firebase depuis la console Firebase.

3. Lancer un serveur HTTP local à la racine du projet :

```bash
python -m http.server 8000
```

Ou avec Node.js :

```bash
npx serve .
```

Ouvrir ensuite `http://localhost:8000` dans le navigateur.

Pour le déploiement, le dossier peut être publié tel quel sur n'importe quel hébergeur statique (Netlify, GitHub Pages, Vercel). Sur Netlify, `netlify.toml` applique automatiquement les en-têtes CSP nécessaires.

## Structure des fichiers

```text
index.html                  Interface de l'application (SPA)
style.css                   Feuille de styles (thème clair et sombre)
script.js                   Orchestration de l'interface, du moteur et du réseau
engine.js                   Moteur de jeu pur (sans dépendance au DOM ni au réseau)
network.js                  Gestion des échanges avec Firebase Realtime Database
words.js                    Listes de paires de mots (facile et difficile)
firebase-config.js          Configuration Firebase utilisée par le client
firebase-config.example.js  Modèle de configuration Firebase sans identifiants
manifest.json               Manifeste PWA
sw.js                       Service worker pour la mise en cache des ressources
netlify.toml                En-têtes HTTP et CSP pour le déploiement Netlify
icon-192.png                Icône PWA 192x192
icon-512.png                Icône PWA 512x512
og-image.png                Image de prévisualisation Open Graph
```

## À propos

Projet personnel gratuit et non commercial, codé avec l'assistance d'une IA. Ce projet s'inspire des mécaniques des jeux d'imposteur de type Undercover, sans affiliation avec l'éditeur du jeu officiel.

