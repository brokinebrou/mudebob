# MUDEBO — Gestion de la mutuelle

*Mutuelle pour le Développement de Boniankro — « Ensemble, pour une cité prospère »*

Application web de gestion de la mutuelle : adhérents, cotisations normales (montant par catégorie) et exceptionnelles, versements avec reçus PDF, procès-verbaux de réunions, tableau de bord et exports Excel. Montants en FCFA.

## Installation

Prérequis : **Node.js 22.13 ou plus récent** (rien d'autre à installer : la base SQLite est intégrée à Node).

```powershell
cd muntebo
npm install
npm start
```

Sous Windows, vous pouvez aussi double-cliquer sur **`demarrer.bat`**.

Ouvrez ensuite **http://localhost:3000**. Le serveur affiche au démarrage l'adresse à utiliser depuis les autres postes du réseau (ex. `http://192.168.1.20:3000`). Si l'accès est bloqué, autorisez Node.js dans le pare-feu Windows (réseau privé).

### Premier accès

| Compte | Identifiant | Mot de passe |
|---|---|---|
| Administrateur | `admin` | `muntebo2026` (à changer dès la première connexion) |

### Données de démonstration (facultatif)

```powershell
npm run demo
```

Cette commande charge 10 adhérents fictifs, des versements, une cotisation exceptionnelle et un PV. Elle ne fait rien si des adhérents existent déjà. Compte adhérent de test : `demo.adherent` / `adherent2026`.
Pour repartir de zéro, arrêtez le serveur et supprimez le dossier `data/`.

## Mise en route conseillée

1. **Paramètres** : nom, coordonnées, nom du trésorier (imprimé sur les reçus), **périodicité** (mensuelle ou annuelle) et **année de démarrage** du suivi. La périodicité est verrouillée dès le premier encaissement.
2. **Catégories et montants** : par exemple Membre actif, Bienfaiteur, Étudiant, chacune avec son montant par période.
3. **Adhérents** : saisie, puis création de leur accès depuis leur fiche (un mot de passe provisoire s'affiche une seule fois).
4. **Versements** : recherchez l'adhérent ; les périodes impayées sont proposées d'abord et le montant restant est prérempli.

## Fonctionnement des cotisations

- **Normales** : chaque adhérent doit le montant de sa catégorie pour chaque période (mois ou année), à partir de sa date d'adhésion (et pas avant l'année de démarrage), jusqu'à la période en cours. Les dues s'arrêtent à la date de suspension ou de radiation.
- Changer la catégorie d'un adhérent prend effet **à la période suivante** ; l'historique est conservé.
- Modifier le montant d'une catégorie s'applique à toutes ses périodes. Pour un nouveau tarif qui ne touche pas au passé, créez une nouvelle catégorie.
- **Exceptionnelles** : un appel (motif, montant, échéance) adressé à tous les actifs ou à une sélection ; suivi du taux de recouvrement.
- Un versement n'est **jamais effacé** : il peut être annulé avec un motif. Il sort alors des totaux, et l'annulation reste dans le journal.

## Rôles

- **Administrateur** (bureau) : accès complet.
- **Adhérent** : consulte sa situation, télécharge ses reçus et lit les PV marqués « visible par les adhérents ». Lecture seule.

## Sauvegarde

Toutes les données sont dans le dossier **`data/`** : la base `muntebo.db` et les fichiers des PV dans `uploads/pv/`. Copiez ce dossier régulièrement (de préférence serveur arrêté) sur un disque externe ou un espace sécurisé.

## Variables d'environnement (facultatives)

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port d'écoute | `3000` |
| `MUNTEBO_DATA` | Dossier des données (base + PV) | `data/` |
| `SESSION_SECRET` | Clé des cookies de session | générée et conservée dans `data/.session-secret` |

## Tests

```powershell
npm test
```

Ils démarrent l'application sur une base temporaire et vérifient la connexion, les droits d'accès, les adhérents, les versements, les reçus, les cotisations exceptionnelles, les PV et les exports.

## Structure

```
server.js              Démarrage du serveur web
src/db.js, schema.sql  Base de données
src/routes/            Pages (adhérents, versements, PV…)
src/services/          Calcul des cotisations, reçus PDF, exports Excel
views/                 Gabarits HTML (EJS)
public/                Feuille de style, scripts
data/                  Base et fichiers déposés (à sauvegarder)
```
