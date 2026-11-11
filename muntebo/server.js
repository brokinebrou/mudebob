const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const layouts = require('express-ejs-layouts');
const helmet = require('helmet');

const fs = require('fs');
const { getParams, DATA_DIR } = require('./src/db');

// Clé de signature des cookies, générée une fois et conservée dans data/
function secretSession() {
  const fichier = path.join(DATA_DIR, '.session-secret');
  if (!fs.existsSync(fichier)) fs.writeFileSync(fichier, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(fichier, 'utf8').trim();
}
const SqliteStore = require('./src/sessionStore');
const f = require('./src/utils/format');
const { chargerUtilisateur, requireLogin, requireRole, csrf, flash } = require('./src/middleware/auth');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
app.use(layouts);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'"],
      frameSrc: ["'self'"],
      objectSrc: ["'self'"],
      upgradeInsecureRequests: null, // application locale en HTTP
    },
  },
  crossOriginEmbedderPolicy: false,
  strictTransportSecurity: false,
}));

// Fichiers statiques (tout est servi localement : fonctionne sans Internet)
const nm = path.join(__dirname, 'node_modules');
app.use('/public', express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
app.use('/vendor/bootstrap', express.static(path.join(nm, 'bootstrap', 'dist'), { maxAge: '7d' }));
app.use('/vendor/bootstrap-icons', express.static(path.join(nm, 'bootstrap-icons', 'font'), { maxAge: '7d' }));
app.use('/vendor/chart.js', express.static(path.join(nm, 'chart.js', 'dist'), { maxAge: '7d' }));

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

app.use(session({
  name: 'muntebo.sid',
  secret: process.env.SESSION_SECRET || secretSession(),
  store: new SqliteStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000 },
}));

app.use(flash);
app.use(chargerUtilisateur);
app.use((req, res, next) => {
  res.locals.f = f;
  res.locals.params = getParams();
  res.locals.chemin = req.originalUrl.split('?')[0];
  res.locals.title = '';
  res.locals.query = req.query;
  next();
});
app.use(csrf);

// Routes publiques
app.use('/', require('./src/routes/auth'));

// Routes protégées
app.use(requireLogin);
app.get('/', (req, res) => res.redirect(req.user.role === 'admin' ? '/tableau-de-bord' : '/portail'));
app.use('/portail', requireRole('adherent'), require('./src/routes/portail'));
app.use('/pv', require('./src/routes/pv')); // contrôle d'accès fin à l'intérieur

const admin = requireRole('admin');
app.use('/tableau-de-bord', admin, require('./src/routes/dashboard'));
app.use('/adherents', admin, require('./src/routes/adherents'));
app.use('/versements', admin, require('./src/routes/versements'));
app.use('/exceptionnelles', admin, require('./src/routes/exceptionnelles'));
app.use('/categories', admin, require('./src/routes/categories'));
app.use('/parametres', admin, require('./src/routes/parametres'));
app.use('/utilisateurs', admin, require('./src/routes/utilisateurs'));
app.use('/exports', admin, require('./src/routes/exports'));
app.use('/journal', admin, require('./src/routes/journal'));

app.use((req, res) => res.status(404).render('erreur', { title: 'Page introuvable', code: 404, message: "La page demandée n'existe pas." }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (20 Mo maximum).' : err.publicMessage || 'Une erreur inattendue est survenue.';
  res.status(err.status || 500).render('erreur', { title: 'Erreur', code: err.status || 500, message });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    console.log(`\n  ${getParams().nom_association} est démarré.`);
    console.log(`  Sur ce poste :        http://localhost:${PORT}`);
    ips.forEach((ip) => console.log(`  Depuis le réseau :    http://${ip}:${PORT}`));
    console.log('');
    require('./src/services/sauvegardeAuto').demarrerSauvegardes();
  });
}

module.exports = app;
