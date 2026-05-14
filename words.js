/* ══════════════════════════════
   PAIRES DE MOTS — Imposteur
   ══════════════════════════════
   Principe : les deux mots partagent des descriptions
   communes, mais ne sont PAS le duo reflexe evident.
   L'imposteur ne doit pas pouvoir deviner l'autre mot
   juste en voyant le sien.
   ══════════════════════════════ */
const PAIRES = {
  facile: [
    ["Chat","Lapin"],["Pomme","Pastèque"],["Soleil","Ampoule"],["Voiture","Traîneau"],
    ["Guitare","Harpe"],["Football","Handball"],["Pizza","Crêpe"],["Montagne","Gratte-ciel"],
    ["Océan","Piscine"],["Avion","Cerf-volant"],["Chocolat","Miel"],["Paris","Tokyo"],
    ["Café","Cacao"],["Tigre","Guépard"],["Ski","Patin à glace"],["Beurre","Huile d'olive"],
    ["Canapé","Hamac"],["Crayon","Pinceau"],["Fraise","Tomate cerise"],["Banane","Mangue"],
    ["Lait","Jus d'orange"],["Pain","Galette"],["Gant","Moufle"],["Glace","Yaourt"],
    ["Chapeau","Turban"],["Cuillère","Louche"],["Cerise","Raisin"],
    ["Vélo","Skateboard"],["Rose","Orchidée"],["Citron","Pamplemousse"],
    ["Souris","Écureuil"],["Mouton","Alpaga"],["Canard","Cygne"],
    ["Couteau","Hache"],["Lac","Étang"],["Sapin","Palmier"],
    ["Sandwich","Burrito"],["Croissant","Beignet"],["Moto","Quad"],
    ["Aigle","Hibou"],["Tennis","Squash"],["Sable","Farine"],
    ["Roi","Président"],["Pluie","Brouillard"],["Verre","Gourde"],
    ["Coussin","Couverture"],["Saucisson","Chorizo"],["Lanterne","Lampadaire"],
    ["Bague","Montre"],["Puzzle","Rubik's Cube"],["Tramway","Téléphérique"]
  ],
  difficile: [
    ["Aspirateur","Moustique"],["Dentiste","Coiffeur"],["Igloo","Thermos"],["Parapluie","Parasol"],
    ["Ascenseur","Marée"],["Phare","Panneau routier"],["Volcan","Cocotte-minute"],["Miroir","Photo"],
    ["Cactus","Oursin"],["Sablier","Bougie"],["Ancre","Aimant"],
    ["Pont","Échelle"],["Couronne","Casque"],["Grotte","Grenier"],
    ["Masque","Lunettes de soleil"],["Pendule","Balançoire"],["Labyrinthe","Forêt"],
    ["Momie","Pansement"],["Pion","Figurant"],["Nid","Tente"],
    ["Encre","Peinture"],["Fourmilière","Immeuble"],["Brouillard","Vitre embuée"],
    ["Écho","Perroquet"],["Cicatrice","Ride"],["Compas","Girouette"],
    ["Larme","Sueur"],["Éclipse","Tunnel"],["Jungle","Aquarium"],
    ["Chaîne","Menottes"],["Récif","Barricade"],["Dictionnaire","Google"],
    ["Fantôme","Courant d'air"],["Vertige","Trampoline"],["Comète","Fusée"],
    ["Automate","Mannequin"],["Épouvantail","Gardien"],["Oasis","Pause café"],
    ["Empreinte","Signature"],["Serrure","Mot de passe"],["Mémoire","Disque dur"],
    ["Boomerang","Élastique"],["Bibliothèque","Cerveau"],["Marée","Escalator"],
    ["Fossile","Photographie"],["Orchestre","Embouteillage"],["Dune","Ride"],
    ["Chrysalide","Œuf"],["Portail","Douane"],["Sonar","Chauve-souris"]
  ]
};
