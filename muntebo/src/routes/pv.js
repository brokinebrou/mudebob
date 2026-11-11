const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { all, get, run, journaliser, UPLOAD_DIR } = require('../db');
const { requireRole, verifierCsrf } = require('../middleware/auth');
const { TYPES_REUNION } = require('../utils/format');

const router = express.Router();
const admin = requireRole('admin');

const EXTENSIONS = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!EXTENSIONS[ext]) {
      req.erreurFichier = 'Format non accepté. Formats autorisés : PDF, Word (DOC, DOCX), ODT, JPG, PNG.';
      return cb(null, false);
    }
    cb(null, true);
  },
});

// Vérifie la signature binaire du fichier (évite un exécutable renommé en .pdf)
function signatureValide(chemin, ext) {
  const buf = Buffer.alloc(8);
  const fd = fs.openSync(chemin, 'r');
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  const hex = buf.toString('hex');
  if (ext === '.pdf') return buf.toString('ascii', 0, 4) === '%PDF';
  if (ext === '.png') return hex.startsWith('89504e47');
  if (ext === '.jpg' || ext === '.jpeg') return hex.startsWith('ffd8ff');
  if (ext === '.docx' || ext === '.odt') return hex.startsWith('504b0304');
  if (ext === '.doc') return hex.startsWith('d0cf11e0');
  return false;
}

function peutVoir(user, pv) {
  return user.role === 'admin' || (user.role === 'adherent' && pv.visible_adherents);
}

router.get('/', (req, res) => {
  const { annee = '', type = '', q = '' } = req.query;
  const where = [], p = [];
  if (req.user.role !== 'admin') where.push('visible_adherents = 1');
  if (annee) { where.push('substr(date_reunion,1,4) = ?'); p.push(annee); }
  if (type) { where.push('type_reunion = ?'); p.push(type); }
  if (q) { where.push('(titre LIKE ? OR resume LIKE ? OR lieu LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const liste = all(
    `SELECT pv.*, u.identifiant AS depose_par_id FROM pv_reunions pv LEFT JOIN utilisateurs u ON u.id = pv.depose_par
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date_reunion DESC`, ...p
  );
  const annees = all(`SELECT DISTINCT substr(date_reunion,1,4) AS a FROM pv_reunions ${req.user.role !== 'admin' ? 'WHERE visible_adherents = 1' : ''} ORDER BY a DESC`).map((r) => r.a);
  res.render('pv/liste', { title: 'Procès-verbaux des réunions', liste, annees, TYPES_REUNION, filtres: { annee, type, q } });
});

router.get('/nouveau', admin, (req, res) => {
  res.render('pv/form', { title: 'Déposer un PV', pv: { visible_adherents: 1 }, TYPES_REUNION, erreurs: [] });
});

router.post('/', admin, upload.single('fichier'), verifierCsrf, (req, res) => {
  const b = req.body;
  const pv = {
    titre: String(b.titre || '').trim(),
    type_reunion: TYPES_REUNION.includes(b.type_reunion) ? b.type_reunion : null,
    date_reunion: b.date_reunion,
    lieu: String(b.lieu || '').trim(),
    resume: String(b.resume || '').trim(),
    visible_adherents: b.visible_adherents ? 1 : 0,
  };
  const erreurs = [];
  if (!pv.titre) erreurs.push('Le titre est obligatoire.');
  if (!pv.type_reunion) erreurs.push('Choisissez le type de réunion.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pv.date_reunion || '')) erreurs.push('La date de la réunion est invalide.');
  if (req.erreurFichier) erreurs.push(req.erreurFichier);
  else if (!req.file) erreurs.push('Joignez le fichier du PV.');
  else if (!signatureValide(req.file.path, path.extname(req.file.originalname).toLowerCase())) erreurs.push("Le contenu du fichier ne correspond pas à son extension.");
  if (erreurs.length) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).render('pv/form', { title: 'Déposer un PV', pv, TYPES_REUNION, erreurs });
  }
  const ext = path.extname(req.file.originalname).toLowerCase();
  const r = run(
    `INSERT INTO pv_reunions(titre, type_reunion, date_reunion, lieu, resume, fichier, nom_original, mime, taille, visible_adherents, depose_par)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    pv.titre, pv.type_reunion, pv.date_reunion, pv.lieu, pv.resume, req.file.filename, req.file.originalname, EXTENSIONS[ext], req.file.size, pv.visible_adherents, req.user.id
  );
  journaliser(req.user, 'Dépôt PV', 'pv', Number(r.lastInsertRowid), pv.titre);
  req.flash('success', 'Le PV a été déposé.');
  res.redirect(`/pv/${r.lastInsertRowid}`);
});

router.get('/:id(\\d+)', (req, res) => {
  const pv = get('SELECT pv.*, u.identifiant AS depose_par_id FROM pv_reunions pv LEFT JOIN utilisateurs u ON u.id = pv.depose_par WHERE pv.id = ?', req.params.id);
  if (!pv || !peutVoir(req.user, pv)) return res.status(404).render('erreur', { title: 'Introuvable', code: 404, message: 'PV introuvable.' });
  res.render('pv/detail', { title: pv.titre, pv });
});

router.get('/:id(\\d+)/fichier', (req, res) => {
  const pv = get('SELECT * FROM pv_reunions WHERE id = ?', req.params.id);
  if (!pv || !peutVoir(req.user, pv)) return res.status(404).end();
  const chemin = path.join(UPLOAD_DIR, path.basename(pv.fichier));
  if (!fs.existsSync(chemin)) return res.status(404).render('erreur', { title: 'Fichier manquant', code: 404, message: 'Le fichier de ce PV est introuvable sur le serveur.' });
  const inline = req.query.apercu && (pv.mime === 'application/pdf' || pv.mime.startsWith('image/'));
  res.setHeader('Content-Type', pv.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(pv.nom_original)}`);
  fs.createReadStream(chemin).pipe(res);
});

router.post('/:id(\\d+)/visibilite', admin, (req, res) => {
  run('UPDATE pv_reunions SET visible_adherents = CASE visible_adherents WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', req.params.id);
  journaliser(req.user, 'Changement visibilité PV', 'pv', Number(req.params.id));
  res.redirect(`/pv/${req.params.id}`);
});

router.post('/:id(\\d+)/supprimer', admin, (req, res) => {
  const pv = get('SELECT * FROM pv_reunions WHERE id = ?', req.params.id);
  if (pv) {
    run('DELETE FROM pv_reunions WHERE id = ?', pv.id);
    fs.unlink(path.join(UPLOAD_DIR, path.basename(pv.fichier)), () => {});
    journaliser(req.user, 'Suppression PV', 'pv', pv.id, pv.titre);
    req.flash('success', 'PV supprimé.');
  }
  res.redirect('/pv');
});

module.exports = router;
