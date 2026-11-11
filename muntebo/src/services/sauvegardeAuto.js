/* Sauvegarde automatique quotidienne de la base : data/sauvegardes/auto-AAAA-MM-JJ.db
   (au démarrage du serveur puis toutes les heures si la sauvegarde du jour manque).
   Les 30 sauvegardes automatiques les plus récentes sont conservées. */
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('../db');

const DOSSIER = path.join(DATA_DIR, 'sauvegardes');
const GARDER = 30;

function sauvegardeDuJour() {
  try {
    fs.mkdirSync(DOSSIER, { recursive: true });
    const d = new Date();
    const jour = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const fichier = path.join(DOSSIER, `auto-${jour}.db`);
    if (fs.existsSync(fichier)) return null;
    db.exec(`VACUUM INTO '${fichier.replace(/'/g, "''")}'`);
    const anciennes = fs.readdirSync(DOSSIER).filter((f) => /^auto-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(GARDER);
    for (const f of anciennes) fs.rmSync(path.join(DOSSIER, f), { force: true });
    return fichier;
  } catch (e) {
    console.error('Sauvegarde automatique impossible :', e.message);
    return null;
  }
}

function demarrerSauvegardes() {
  sauvegardeDuJour();
  setInterval(sauvegardeDuJour, 60 * 60 * 1000).unref();
}

module.exports = { demarrerSauvegardes, sauvegardeDuJour };
