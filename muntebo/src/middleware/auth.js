const crypto = require('crypto');
const { get } = require('../db');

// Charge l'utilisateur courant à partir de la session
function chargerUtilisateur(req, res, next) {
  res.locals.user = null;
  if (req.session.userId) {
    const u = get(
      'SELECT id, identifiant, nom_complet, role, adherent_id, actif, doit_changer_mdp FROM utilisateurs WHERE id = ?',
      req.session.userId
    );
    if (u && u.actif) {
      req.user = u;
      res.locals.user = u;
    } else {
      delete req.session.userId;
    }
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    if (req.method === 'GET') req.session.retour = req.originalUrl;
    return res.redirect('/login');
  }
  if (req.user.doit_changer_mdp && !req.path.startsWith('/mot-de-passe') && req.originalUrl !== '/logout') {
    return res.redirect('/mot-de-passe');
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (req.user.role !== role) {
      return res.status(403).render('erreur', { title: 'Accès refusé', code: 403, message: "Vous n'avez pas les droits nécessaires pour accéder à cette page." });
    }
    next();
  };
}

// Jeton CSRF par session, vérifié sur toutes les requêtes non-GET
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Pour les formulaires multipart, la vérification est faite après multer (voir verifierCsrf)
  if ((req.headers['content-type'] || '').startsWith('multipart/form-data')) return next();
  return verifierCsrf(req, res, next);
}

function verifierCsrf(req, res, next) {
  const jeton = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
  const attendu = req.session.csrf || '';
  if (!jeton || jeton.length !== attendu.length || !crypto.timingSafeEqual(Buffer.from(jeton), Buffer.from(attendu))) {
    return res.status(403).render('erreur', { title: 'Session expirée', code: 403, message: 'Le formulaire a expiré. Veuillez recharger la page et réessayer.' });
  }
  next();
}

// Messages flash
function flash(req, res, next) {
  res.locals.flash = req.session.flash || [];
  delete req.session.flash;
  req.flash = (type, message) => {
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, message });
  };
  next();
}

module.exports = { chargerUtilisateur, requireLogin, requireRole, csrf, verifierCsrf, flash };
