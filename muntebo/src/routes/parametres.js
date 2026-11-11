const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { setParam, getParams, journaliser, get, DATA_DIR } = require('../db');
const { verifierCsrf } = require('../middleware/auth');
const { cheminSignature, SIGNATURE_EXT } = require('../services/carte');

const router = express.Router();
const CHAMPS = ['nom_association', 'slogan', 'adresse', 'telephone', 'email', 'tresorier', 'periodicite', 'annee_demarrage', 'prefixe_recu', 'prefixe_matricule'];

router.get('/', (req, res) => {
  const aDesVersements = get("SELECT COUNT(*) AS n FROM versements WHERE type='normale'").n > 0;
  res.render('parametres', { title: 'Paramètres', p: getParams(), aDesVersements, erreurs: [], signature: !!cheminSignature() });
});

router.post('/', (req, res) => {
  const b = req.body;
  const p = {};
  for (const k of CHAMPS) p[k] = String(b[k] || '').trim();
  const erreurs = [];
  const aDesVersements = get("SELECT COUNT(*) AS n FROM versements WHERE type='normale'").n > 0;
  if (!p.nom_association) erreurs.push("Le nom de l'association est obligatoire.");
  if (!['mensuelle', 'annuelle'].includes(p.periodicite)) erreurs.push('Périodicité invalide.');
  if (aDesVersements && p.periodicite !== getParams().periodicite) erreurs.push('La périodicité ne peut plus être modifiée car des cotisations normales ont déjà été encaissées.');
  if (!/^\d{4}$/.test(p.annee_demarrage)) erreurs.push('Année de démarrage invalide.');
  if (!/^[A-Z0-9]{1,6}$/i.test(p.prefixe_recu) || !/^[A-Z0-9]{1,6}$/i.test(p.prefixe_matricule)) erreurs.push('Les préfixes doivent contenir 1 à 6 lettres ou chiffres.');
  if (erreurs.length) return res.status(400).render('parametres', { title: 'Paramètres', p: { ...getParams(), ...p }, aDesVersements, erreurs, signature: !!cheminSignature() });
  p.prefixe_recu = p.prefixe_recu.toUpperCase();
  p.prefixe_matricule = p.prefixe_matricule.toUpperCase();
  for (const k of CHAMPS) setParam(k, p[k]);
  journaliser(req.user, 'Modification des paramètres', 'parametres', null);
  req.flash('success', 'Paramètres enregistrés.');
  res.redirect('/parametres');
});

// ---- Signature du président (imprimée sur les cartes de membre) ----------------
const signatureUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

router.get('/signature', (req, res) => {
  const p = cheminSignature();
  if (!p) return res.status(404).end();
  res.setHeader('Content-Type', p.endsWith('.png') ? 'image/png' : 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(p).pipe(res);
});

router.post('/signature', signatureUpload.single('signature'), verifierCsrf, (req, res) => {
  const buf = req.file && req.file.buffer;
  const ext = !buf ? null : buf.toString('hex', 0, 4) === '89504e47' ? '.png' : buf.toString('hex', 0, 3) === 'ffd8ff' ? '.jpg' : null;
  if (!ext) {
    req.flash('danger', 'Choisissez une image de signature au format PNG ou JPG (2 Mo maximum).');
    return res.redirect('/parametres');
  }
  for (const e of SIGNATURE_EXT) fs.rmSync(path.join(DATA_DIR, 'signature' + e), { force: true });
  fs.writeFileSync(path.join(DATA_DIR, 'signature' + ext), buf);
  journaliser(req.user, 'Signature du président mise à jour', 'parametres', null);
  req.flash('success', 'Signature enregistrée : elle sera imprimée sur les cartes de membre.');
  res.redirect('/parametres');
});

router.post('/signature/supprimer', (req, res) => {
  for (const e of SIGNATURE_EXT) fs.rmSync(path.join(DATA_DIR, 'signature' + e), { force: true });
  journaliser(req.user, 'Signature du président retirée', 'parametres', null);
  req.flash('success', 'Signature retirée des cartes de membre.');
  res.redirect('/parametres');
});

module.exports = router;
