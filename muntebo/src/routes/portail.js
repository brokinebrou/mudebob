const express = require('express');
const { all, get } = require('../db');
const { situationNormale, situationExceptionnelle } = require('../services/cotisations');
const { genererRecu, chargerVersement } = require('../services/recu');
const { envoyerPhoto } = require('../services/photos');
const { genererCarte } = require('../services/carte');

const router = express.Router();

// Espace adhérent : uniquement ses propres données, en lecture seule
router.get('/', (req, res) => {
  const a = get(
    'SELECT a.*, c.libelle AS categorie, c.montant AS categorie_montant FROM adherents a JOIN categories c ON c.id = a.categorie_id WHERE a.id = ?',
    req.user.adherent_id
  );
  if (!a) return res.status(404).render('erreur', { title: 'Profil introuvable', code: 404, message: "Votre fiche d'adhérent est introuvable. Contactez le bureau." });
  const situation = situationNormale(a);
  const exceptionnelles = situationExceptionnelle(a.id);
  const versements = all(
    `SELECT v.*, c.libelle AS exc_libelle FROM versements v LEFT JOIN cotisations_exceptionnelles c ON c.id = v.cotisation_exc_id
     WHERE v.adherent_id = ? AND v.annule = 0 ORDER BY v.date_versement DESC, v.id DESC`, a.id
  );
  const pv = all('SELECT id, titre, type_reunion, date_reunion FROM pv_reunions WHERE visible_adherents = 1 ORDER BY date_reunion DESC LIMIT 5');
  res.render('portail', { title: 'Mon espace', a, situation, exceptionnelles, versements, pv });
});

// Photo de l'adhérent connecté (jamais celle d'un autre)
router.get('/photo', (req, res) => {
  const a = get('SELECT photo FROM adherents WHERE id = ?', req.user.adherent_id);
  envoyerPhoto(res, a && a.photo);
});

// Sa propre carte de membre uniquement
router.get('/carte.pdf', (req, res) => {
  const a = get('SELECT * FROM adherents WHERE id = ?', req.user.adherent_id);
  if (!a) return res.status(404).render('erreur', { title: 'Introuvable', code: 404, message: 'Fiche adhérent introuvable.' });
  genererCarte(a, res);
});

router.get('/recu/:id(\\d+).pdf', (req, res) => {
  const v = chargerVersement(req.params.id);
  if (!v || v.adherent_id !== req.user.adherent_id || v.annule) {
    return res.status(403).render('erreur', { title: 'Accès refusé', code: 403, message: 'Ce reçu ne vous appartient pas.' });
  }
  genererRecu(v, res);
});

module.exports = router;
