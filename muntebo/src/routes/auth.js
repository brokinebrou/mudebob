const express = require('express');
const bcrypt = require('bcryptjs');
const { get, run, journaliser } = require('../db');

const router = express.Router();
const MAX_ECHECS = 5;
const BLOCAGE_MIN = 15;

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { layout: false, title: 'Connexion', erreur: null, identifiant: '' });
});

router.post('/login', (req, res) => {
  const identifiant = String(req.body.identifiant || '').trim();
  const mdp = String(req.body.mot_de_passe || '');
  const rendu = (erreur) => res.status(401).render('login', { layout: false, title: 'Connexion', erreur, identifiant });

  const u = get('SELECT * FROM utilisateurs WHERE identifiant = ?', identifiant);
  if (u && u.bloque_jusqua && new Date(u.bloque_jusqua) > new Date()) {
    const min = Math.ceil((new Date(u.bloque_jusqua) - new Date()) / 60000);
    return rendu(`Trop de tentatives. Compte bloqué pendant encore ${min} minute(s).`);
  }
  if (!u || !bcrypt.compareSync(mdp, u.mot_de_passe_hash)) {
    if (u) {
      const echecs = u.echecs_connexion + 1;
      const bloque = echecs >= MAX_ECHECS ? new Date(Date.now() + BLOCAGE_MIN * 60000).toISOString() : null;
      run('UPDATE utilisateurs SET echecs_connexion = ?, bloque_jusqua = ? WHERE id = ?', bloque ? 0 : echecs, bloque, u.id);
      if (bloque) {
        journaliser(u, 'Blocage du compte après échecs de connexion', 'utilisateur', u.id);
        return rendu(`Trop de tentatives. Compte bloqué pendant ${BLOCAGE_MIN} minutes.`);
      }
    }
    return rendu('Identifiant ou mot de passe incorrect.');
  }
  if (!u.actif) return rendu('Ce compte est désactivé. Contactez le bureau de l’association.');

  run("UPDATE utilisateurs SET echecs_connexion = 0, bloque_jusqua = NULL, dernier_login = datetime('now','localtime') WHERE id = ?", u.id);
  const retour = req.session.retour;
  req.session.regenerate((err) => {
    if (err) throw err;
    req.session.userId = u.id;
    journaliser(u, 'Connexion', 'utilisateur', u.id);
    if (u.doit_changer_mdp) return res.redirect('/mot-de-passe');
    const cible = retour && retour.startsWith('/') && !retour.startsWith('//') ? retour : '/';
    res.redirect(cible);
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('muntebo.sid');
    res.redirect('/login');
  });
});

function requireUser(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

router.get('/mot-de-passe', requireUser, (req, res) => {
  res.render('mot-de-passe', { title: 'Changer mon mot de passe', erreur: null });
});

router.post('/mot-de-passe', requireUser, (req, res) => {
  const { actuel, nouveau, confirmation } = req.body;
  const u = get('SELECT * FROM utilisateurs WHERE id = ?', req.user.id);
  const erreur = (m) => res.status(400).render('mot-de-passe', { title: 'Changer mon mot de passe', erreur: m });
  if (!bcrypt.compareSync(String(actuel || ''), u.mot_de_passe_hash)) return erreur('Le mot de passe actuel est incorrect.');
  if (!nouveau || nouveau.length < 8) return erreur('Le nouveau mot de passe doit contenir au moins 8 caractères.');
  if (!/[A-Za-z]/.test(nouveau) || !/\d/.test(nouveau)) return erreur('Le nouveau mot de passe doit contenir des lettres et des chiffres.');
  if (nouveau !== confirmation) return erreur('La confirmation ne correspond pas au nouveau mot de passe.');
  if (bcrypt.compareSync(nouveau, u.mot_de_passe_hash)) return erreur('Le nouveau mot de passe doit être différent de l’actuel.');
  run('UPDATE utilisateurs SET mot_de_passe_hash = ?, doit_changer_mdp = 0 WHERE id = ?', bcrypt.hashSync(nouveau, 10), u.id);
  journaliser(req.user, 'Changement de mot de passe', 'utilisateur', u.id);
  req.flash('success', 'Votre mot de passe a été modifié.');
  res.redirect('/');
});

module.exports = router;
