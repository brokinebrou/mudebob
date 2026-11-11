PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS parametres (
  cle TEXT PRIMARY KEY,
  valeur TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  libelle TEXT NOT NULL UNIQUE,
  montant INTEGER NOT NULL CHECK (montant >= 0),
  description TEXT,
  cree_le TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS adherents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matricule TEXT NOT NULL UNIQUE,
  nom TEXT NOT NULL,
  prenoms TEXT NOT NULL,
  sexe TEXT CHECK (sexe IN ('M','F')),
  date_naissance TEXT,
  lieu_naissance TEXT,
  famille TEXT,
  nom_pere TEXT,
  nom_mere TEXT,
  photo TEXT,
  telephone TEXT,
  email TEXT,
  adresse TEXT,
  profession TEXT,
  categorie_id INTEGER NOT NULL REFERENCES categories(id),
  date_adhesion TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'actif' CHECK (statut IN ('actif','suspendu','radie')),
  date_sortie TEXT,
  observations TEXT,
  cree_le TEXT DEFAULT (datetime('now','localtime'))
);

-- Historique des catégories : la catégorie s'applique à partir de la période "periode_debut" (AAAA-MM ou AAAA)
CREATE TABLE IF NOT EXISTS adherent_categorie_historique (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adherent_id INTEGER NOT NULL REFERENCES adherents(id) ON DELETE CASCADE,
  categorie_id INTEGER NOT NULL REFERENCES categories(id),
  periode_debut TEXT NOT NULL,
  cree_le TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS utilisateurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifiant TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nom_complet TEXT,
  mot_de_passe_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','adherent')),
  adherent_id INTEGER REFERENCES adherents(id) ON DELETE CASCADE,
  actif INTEGER NOT NULL DEFAULT 1,
  doit_changer_mdp INTEGER NOT NULL DEFAULT 1,
  echecs_connexion INTEGER NOT NULL DEFAULT 0,
  bloque_jusqua TEXT,
  dernier_login TEXT,
  cree_le TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS cotisations_exceptionnelles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  libelle TEXT NOT NULL,
  motif TEXT,
  montant_par_adherent INTEGER NOT NULL CHECK (montant_par_adherent > 0),
  date_appel TEXT NOT NULL,
  date_echeance TEXT,
  cloturee INTEGER NOT NULL DEFAULT 0,
  cree_par INTEGER REFERENCES utilisateurs(id),
  cree_le TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS cotisation_exc_adherents (
  cotisation_id INTEGER NOT NULL REFERENCES cotisations_exceptionnelles(id) ON DELETE CASCADE,
  adherent_id INTEGER NOT NULL REFERENCES adherents(id) ON DELETE CASCADE,
  montant_du INTEGER NOT NULL,
  PRIMARY KEY (cotisation_id, adherent_id)
);

CREATE TABLE IF NOT EXISTS versements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_recu TEXT NOT NULL UNIQUE,
  adherent_id INTEGER NOT NULL REFERENCES adherents(id),
  type TEXT NOT NULL CHECK (type IN ('normale','exceptionnelle')),
  periode TEXT,
  cotisation_exc_id INTEGER REFERENCES cotisations_exceptionnelles(id),
  montant INTEGER NOT NULL CHECK (montant > 0),
  date_versement TEXT NOT NULL,
  mode TEXT NOT NULL,
  reference TEXT,
  observations TEXT,
  saisi_par INTEGER REFERENCES utilisateurs(id),
  annule INTEGER NOT NULL DEFAULT 0,
  motif_annulation TEXT,
  annule_par INTEGER REFERENCES utilisateurs(id),
  annule_le TEXT,
  cree_le TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_versements_adherent ON versements(adherent_id);
CREATE INDEX IF NOT EXISTS idx_versements_date ON versements(date_versement);

CREATE TABLE IF NOT EXISTS pv_reunions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titre TEXT NOT NULL,
  type_reunion TEXT NOT NULL,
  date_reunion TEXT NOT NULL,
  lieu TEXT,
  resume TEXT,
  fichier TEXT NOT NULL,
  nom_original TEXT NOT NULL,
  mime TEXT,
  taille INTEGER,
  visible_adherents INTEGER NOT NULL DEFAULT 0,
  depose_par INTEGER REFERENCES utilisateurs(id),
  depose_le TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  utilisateur_id INTEGER,
  utilisateur TEXT,
  action TEXT NOT NULL,
  objet TEXT,
  objet_id INTEGER,
  details TEXT,
  le TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expire INTEGER NOT NULL
);
