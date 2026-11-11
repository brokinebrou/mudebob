const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.MUNTEBO_DATA || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads', 'pv');
const PHOTO_DIR = path.join(DATA_DIR, 'uploads', 'photos');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'muntebo.db');
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// Migrations : ajout des colonnes manquantes sur une base existante (sans perte de données)
function ajouterColonnes(table, colonnes) {
  const existantes = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [nom, type] of Object.entries(colonnes)) {
    if (!existantes.has(nom)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${nom} ${type}`);
  }
}
ajouterColonnes('adherents', {
  lieu_naissance: 'TEXT',
  famille: 'TEXT',
  nom_pere: 'TEXT',
  nom_mere: 'TEXT',
  photo: 'TEXT',
});

// Petits utilitaires
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const PARAMS_DEFAUT = {
  nom_association: 'MUDEBO',
  slogan: 'Ensemble, pour une cité prospère',
  periodicite: 'mensuelle', // mensuelle | annuelle
  annee_demarrage: String(new Date().getFullYear()),
  prefixe_recu: 'REC',
  prefixe_matricule: 'MU',
  adresse: '',
  telephone: '',
  email: '',
  tresorier: '',
};

function getParams() {
  const p = { ...PARAMS_DEFAUT };
  for (const r of all('SELECT cle, valeur FROM parametres')) p[r.cle] = r.valeur;
  return p;
}

function setParam(cle, valeur) {
  run('INSERT INTO parametres(cle, valeur) VALUES(?,?) ON CONFLICT(cle) DO UPDATE SET valeur=excluded.valeur', cle, valeur);
}

function seed() {
  const n = get('SELECT COUNT(*) AS n FROM utilisateurs').n;
  if (n === 0) {
    run(
      `INSERT INTO utilisateurs(identifiant, nom_complet, mot_de_passe_hash, role, doit_changer_mdp)
       VALUES ('admin', 'Administrateur', ?, 'admin', 1)`,
      bcrypt.hashSync('muntebo2026', 10)
    );
    console.log('Compte administrateur créé : admin / muntebo2026 (à changer à la première connexion)');
  }
  if (get('SELECT COUNT(*) AS n FROM categories').n === 0) {
    run("INSERT INTO categories(libelle, montant, description) VALUES ('Membre actif', 5000, 'Cotisation standard')");
    run("INSERT INTO categories(libelle, montant, description) VALUES ('Membre bienfaiteur', 15000, 'Soutien renforcé')");
    run("INSERT INTO categories(libelle, montant, description) VALUES ('Étudiant', 2000, 'Tarif réduit')");
  }
  for (const [k, v] of Object.entries(PARAMS_DEFAUT)) {
    run('INSERT OR IGNORE INTO parametres(cle, valeur) VALUES(?,?)', k, v);
  }
}
seed();

function journaliser(user, action, objet, objetId, details) {
  run(
    'INSERT INTO journal(utilisateur_id, utilisateur, action, objet, objet_id, details) VALUES (?,?,?,?,?,?)',
    user ? user.id : null,
    user ? user.identifiant : null,
    action,
    objet || null,
    objetId || null,
    details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null
  );
}

module.exports = { db, all, get, run, transaction, getParams, setParam, journaliser, UPLOAD_DIR, PHOTO_DIR, DATA_DIR };
