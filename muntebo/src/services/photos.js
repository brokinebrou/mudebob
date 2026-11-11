const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { PHOTO_DIR } = require('../db');

const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

// Réception de la photo d'identité (5 Mo max, JPG / PNG / WEBP)
const uploadPhoto = multer({
  storage: multer.diskStorage({
    destination: PHOTO_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!TYPES[path.extname(file.originalname).toLowerCase()]) {
      req.erreurPhoto = 'Format de photo non accepté (JPG, PNG ou WEBP).';
      return cb(null, false);
    }
    cb(null, true);
  },
});

// Vérifie que le contenu est bien une image (et pas un autre fichier renommé)
function photoValide(fichier) {
  const buf = Buffer.alloc(12);
  const fd = fs.openSync(fichier.path, 'r');
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  const hex = buf.toString('hex');
  return hex.startsWith('ffd8ff') || hex.startsWith('89504e47') || (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP');
}

function supprimerPhoto(nom) {
  if (nom) fs.unlink(path.join(PHOTO_DIR, path.basename(nom)), () => {});
}

function envoyerPhoto(res, nom) {
  const chemin = nom && path.join(PHOTO_DIR, path.basename(nom));
  if (!chemin || !fs.existsSync(chemin)) return res.status(404).end();
  res.setHeader('Content-Type', TYPES[path.extname(chemin).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(chemin).pipe(res);
}

module.exports = { uploadPhoto, photoValide, supprimerPhoto, envoyerPhoto };
