const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { all, get, run, journaliser } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const admins = all("SELECT * FROM utilisateurs WHERE role = 'admin' ORDER BY identifiant");
  const adherents = all(
    `SELECT u.*, a.matricule, a.nom, a.prenoms FROM utilisateurs u JOIN adherents a ON a.id = u.adherent_id
     WHERE u.role = 'adherent' ORDER BY a.nom`
  );
  res.render('utilisateurs', { title: 'Utilisateurs', admins, adherents, mdpTemp: req.session.mdpTempAdmin || null });
  delete req.session.mdpTempAdmin;
});

router.post('/', (req, res) => {
  const identifiant = String(req.body.identifiant || '').trim().toLowerCase();
  const nom = String(req.body.nom_complet || '').trim();
  const mdp = String(req.body.mot_de_passe || '');
  if (!/^[a-z0-9._-]{3,30}$/.test(identifiant)) { req.flash('danger', "L'identifiant doit contenir 3 à 30 caractères (lettres, chiffres, . _ -)."); return res.redirect('/utilisateurs'); }
  if (mdp.length < 8) { req.flash('danger', 'Le mot de passe provisoire doit contenir au moins 8 caractères.'); return res.redirect('/utilisateurs'); }
  if (get('SELECT 1 FROM utilisateurs WHERE identifiant = ?', identifiant)) { req.flash('danger', 'Cet identifiant existe déjà.'); return res.redirect('/utilisateurs'); }
  const r = run("INSERT INTO utilisateurs(identifiant, nom_complet, mot_de_passe_hash, role, doit_changer_mdp) VALUES (?,?,?,'admin',1)", identifiant, nom, bcrypt.hashSync(mdp, 10));
  journaliser(req.user, 'Création administrateur', 'utilisateur', Number(r.lastInsertRowid), identifiant);
  req.flash('success', `Compte « ${identifiant} » créé. Il devra changer son mot de passe à la première connexion.`);
  res.redirect('/utilisateurs');
});

router.post('/:id(\\d+)/actif', (req, res) => {
  const u = get('SELECT * FROM utilisateurs WHERE id = ?', req.params.id);
  if (!u) return res.redirect('/utilisateurs');
  if (u.id === req.user.id) { req.flash('danger', 'Vous ne pouvez pas désactiver votre propre compte.'); return res.redirect('/utilisateurs'); }
  if (u.role === 'admin' && u.actif && get("SELECT COUNT(*) AS n FROM utilisateurs WHERE role='admin' AND actif=1").n <= 1) {
    req.flash('danger', 'Il doit rester au moins un administrateur actif.');
    return res.redirect('/utilisateurs');
  }
  run('UPDATE utilisateurs SET actif = ? WHERE id = ?', u.actif ? 0 : 1, u.id);
  journaliser(req.user, u.actif ? 'Désactivation compte' : 'Activation compte', 'utilisateur', u.id, u.identifiant);
  req.flash('success', `Compte « ${u.identifiant} » ${u.actif ? 'désactivé' : 'activé'}.`);
  res.redirect('/utilisateurs');
});

router.post('/:id(\\d+)/reinitialiser', (req, res) => {
  const u = get('SELECT * FROM utilisateurs WHERE id = ?', req.params.id);
  if (!u) return res.redirect('/utilisateurs');
  const mdp = 'Mun' + crypto.randomBytes(4).toString('hex') + crypto.randomInt(10, 100);
  run('UPDATE utilisateurs SET mot_de_passe_hash = ?, doit_changer_mdp = 1, echecs_connexion = 0, bloque_jusqua = NULL WHERE id = ?', bcrypt.hashSync(mdp, 10), u.id);
  journaliser(req.user, 'Réinitialisation mot de passe', 'utilisateur', u.id, u.identifiant);
  req.session.mdpTempAdmin = { identifiant: u.identifiant, mdp };
  res.redirect('/utilisateurs');
});

module.exports = router;
