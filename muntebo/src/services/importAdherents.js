/* Import d'adhérents depuis un fichier Excel (.xlsx) ou CSV.
   1) lecture du fichier -> tableau de lignes brutes
   2) reconnaissance des colonnes par leur titre (souple : accents, abréviations)
   3) nettoyage / contrôle de chaque ligne -> { donnees, avertissements, erreurs } */
const ExcelJS = require('exceljs');
const { all, get } = require('../db');
const { dateAdhesionDepuisMatricule } = require('./matricules');
const { aujourdHui } = require('../utils/format');

// ---- Colonnes reconnues ------------------------------------------------------
const SYNONYMES = {
  matricule: ['mat', 'matricule', 'n matricule', 'numero', 'num', 'no', 'n', 'code', 'id', 'identifiant'],
  nom: ['nom', 'nom de famille'],
  prenoms: ['prenoms', 'prenom'],
  sexe: ['sexe', 'genre'],
  date_naissance: ['ne le', 'nee le', 'ne e le', 'nele', 'neele', 'date nais', 'date de naissance', 'naissance', 'date naissance', 'ddn'],
  lieu_naissance: ['lieu', 'lieu de naissance', 'lieu naissance', 'ne a'],
  profession: ['profession', 'metier', 'fonction', 'emploi'],
  telephone: ['tel', 'telephone', 'contact', 'contacts', 'portable', 'cel', 'cellulaire', 'numero de telephone'],
  adresse: ['residence', 'adresse', 'lieu de residence', 'domicile', 'quartier', 'ville'],
  famille: ['famille', 'grande famille', 'lignee'],
  nom_pere: ['pere', 'nom du pere', 'nom et prenoms du pere', 'nom pere'],
  nom_mere: ['mere', 'nom de la mere', 'nom et prenoms de la mere', 'nom mere'],
  email: ['email', 'e mail', 'mail', 'courriel'],
  date_adhesion: ['date d adhesion', 'date adhesion', 'adhesion', 'adhere le', 'date d inscription', 'inscription'],
  categorie: ['categorie', 'type de membre', 'type'],
  observations: ['observations', 'observation', 'remarques', 'commentaire', 'commentaires'],
};
const LIBELLES = {
  matricule: 'Matricule', nom: 'Nom', prenoms: 'Prénoms', sexe: 'Sexe', date_naissance: 'Date de naissance',
  lieu_naissance: 'Lieu de naissance', profession: 'Profession', telephone: 'Téléphone', adresse: 'Résidence',
  famille: 'Famille', nom_pere: 'Père', nom_mere: 'Mère', email: 'E-mail', date_adhesion: "Date d'adhésion",
  categorie: 'Catégorie', observations: 'Observations',
};

const sansAccents = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const cle = (s) => sansAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function champDe(titre) {
  const k = cle(titre);
  if (!k) return null;
  // Titres de type base de données : NOM_MEMBRE, CODE_ADHERENT… -> « nom », « code »
  const court = k.replace(/\b(membres?|adherents?)\b/g, ' ').replace(/\s+/g, ' ').trim();
  for (const essai of [k, court]) {
    if (!essai) continue;
    for (const [champ, syn] of Object.entries(SYNONYMES)) if (syn.includes(essai)) return champ;
  }
  return null;
}

// ---- Lecture des fichiers ----------------------------------------------------
function texteCellule(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return texteCellule(v.text);
    if (v.result != null) return texteCellule(v.result);
    if (v.error) return '';
    return '';
  }
  return v;
}

async function lireExcel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) return [];
  const lignes = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = [];
    for (let c = 1; c <= ws.columnCount; c++) vals.push(texteCellule(row.getCell(c).value));
    lignes.push(vals);
  });
  return lignes;
}

function decoderTexte(buffer) {
  // UTF-8 si valide (avec ou sans BOM), sinon Windows-1252 (CSV enregistré par Excel)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

function lireCsv(buffer) {
  const texte = decoderTexte(buffer).replace(/\r\n?/g, '\n');
  const premiere = texte.split('\n', 1)[0];
  const compte = (c) => premiere.split(c).length - 1;
  const sep = [';', ',', '\t'].sort((a, b) => compte(b) - compte(a))[0];
  const lignes = [];
  let ligne = [], champ = '', guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const ch = texte[i];
    if (guillemets) {
      if (ch === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
      else if (ch === '"') guillemets = false;
      else champ += ch;
    } else if (ch === '"' && champ === '') guillemets = true;
    else if (ch === sep) { ligne.push(champ); champ = ''; }
    else if (ch === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; }
    else champ += ch;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes.filter((l) => l.some((c) => String(c).trim() !== ''));
}

// ---- Nettoyage des valeurs ---------------------------------------------------
const propre = (v) => String(v instanceof Date ? '' : v ?? '').replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();

function dateValide(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function lireDate(v) {
  if (v == null || v === '') return { valeur: null };
  if (v instanceof Date && !isNaN(v)) return { valeur: v.toISOString().slice(0, 10) };
  if (typeof v === 'number' && v > 1000 && v < 80000) { // numéro de série Excel
    return { valeur: new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10) };
  }
  const s = propre(v);
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    let y = Number(m[3]);
    if (m[3].length === 2) y += y > Number(aujourdHui().slice(2, 4)) ? 1900 : 2000;
    if (!dateValide(y, Number(m[2]), Number(m[1]))) return { erreur: `date « ${s} » invalide` };
    return { valeur: `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` };
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m && dateValide(Number(m[1]), Number(m[2]), Number(m[3]))) return { valeur: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` };
  return { erreur: `date « ${s} » non reconnue` };
}

function lireTelephone(v) {
  const s = propre(typeof v === 'number' ? String(v) : v);
  if (!s) return { valeur: '' };
  let chiffres = s.replace(/[^\d+]/g, '');
  if (/^0+$/.test(chiffres.replace('+', ''))) return { valeur: '', avert: 'téléphone « 00 00 00 00 00 » ignoré' };
  if (/^\d{9}$/.test(chiffres)) chiffres = '0' + chiffres; // zéro initial perdu par Excel
  if (/^\d{10}$/.test(chiffres)) return { valeur: chiffres.replace(/(\d{2})(?=\d)/g, '$1 ').trim() };
  if (/^\+?\d{8,15}$/.test(chiffres)) return { valeur: chiffres };
  return { valeur: '', avert: `téléphone « ${s} » non reconnu, ignoré` };
}

function lireSexe(v) {
  const k = cle(v);
  if (!k) return null;
  if (/^(m|h|masculin|homme|male)/.test(k)) return 'M';
  if (/^(f|feminin|femme|female)/.test(k)) return 'F';
  return undefined;
}

// ---- Analyse complète --------------------------------------------------------
async function analyserFichier(buffer, extension, options) {
  const brutes = extension === '.xlsx' ? await lireExcel(buffer) : lireCsv(buffer);
  if (!brutes.length) return { erreurGlobale: 'Le fichier est vide.' };

  // Ligne d'en-tête : la première (parmi les 15 premières) qui contient au moins nom + prénoms
  let indexEntete = -1, colonnes = [];
  for (let i = 0; i < Math.min(15, brutes.length); i++) {
    const champs = brutes[i].map((t) => champDe(texteCellule(t)));
    if (champs.includes('nom') && champs.includes('prenoms')) { indexEntete = i; colonnes = champs; break; }
  }
  if (indexEntete < 0) {
    return { erreurGlobale: 'Colonnes « Nom » et « Prénoms » introuvables. Vérifiez que la première ligne du fichier contient les titres des colonnes.' };
  }
  const titres = brutes[indexEntete].map((t) => propre(texteCellule(t)));
  const reconnues = [], ignorees = [];
  colonnes.forEach((c, i) => {
    if (!titres[i]) return;
    if (c && !reconnues.find((r) => r.champ === c)) reconnues.push({ titre: titres[i], champ: c, libelle: LIBELLES[c] });
    else { ignorees.push(titres[i]); colonnes[i] = null; }
  });

  const categories = all('SELECT id, libelle FROM categories');
  const catParDefaut = categories.find((c) => c.id === Number(options.categorie_id));
  const existants = new Map(all('SELECT id, matricule FROM adherents').map((a) => [a.matricule.toUpperCase(), a.id]));
  const vus = new Set();
  const lignes = [];

  brutes.slice(indexEntete + 1).forEach((cellules, k) => {
    const brut = {};
    colonnes.forEach((c, i) => { if (c) brut[c] = texteCellule(cellules[i]); });
    if (Object.values(brut).every((v) => propre(v) === '')) return;

    const avert = [], err = [];
    const d = {
      matricule: propre(brut.matricule).toUpperCase(),
      nom: propre(brut.nom).toUpperCase(),
      prenoms: propre(brut.prenoms),
      profession: propre(brut.profession),
      adresse: propre(brut.adresse),
      famille: propre(brut.famille),
      nom_pere: propre(brut.nom_pere),
      nom_mere: propre(brut.nom_mere),
      email: propre(brut.email).toLowerCase(),
      observations: propre(brut.observations),
      lieu_naissance: propre(brut.lieu_naissance),
    };
    if (!d.nom) err.push('nom manquant');
    if (!d.prenoms) err.push('prénoms manquants');

    const sexe = lireSexe(brut.sexe);
    if (sexe === undefined) avert.push(`sexe « ${propre(brut.sexe)} » non reconnu`);
    d.sexe = sexe || null;

    const dn = lireDate(brut.date_naissance);
    if (dn.erreur) avert.push('naissance : ' + dn.erreur);
    d.date_naissance = dn.valeur || null;
    if (d.date_naissance && d.date_naissance > aujourdHui()) { avert.push('date de naissance dans le futur, ignorée'); d.date_naissance = null; }

    if (d.lieu_naissance && /^[\d\s+.-]{6,}$/.test(d.lieu_naissance)) {
      avert.push(`lieu de naissance « ${d.lieu_naissance} » ressemble à un téléphone, ignoré`);
      d.lieu_naissance = '';
    }

    const tel = lireTelephone(brut.telephone);
    if (tel.avert) avert.push(tel.avert);
    d.telephone = tel.valeur;

    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) { avert.push(`e-mail « ${d.email} » invalide, ignoré`); d.email = ''; }

    // Date d'adhésion : colonne, sinon déduite du matricule (MU-MM-AA-…), sinon valeur par défaut
    const da = lireDate(brut.date_adhesion);
    d.date_adhesion = da.valeur || dateAdhesionDepuisMatricule(d.matricule) || options.date_adhesion || aujourdHui();
    if (da.erreur) avert.push('adhésion : ' + da.erreur);

    // Catégorie : colonne si elle correspond à une catégorie existante, sinon catégorie par défaut
    const libCat = propre(brut.categorie);
    const cat = libCat && categories.find((c) => cle(c.libelle) === cle(libCat));
    if (libCat && !cat) avert.push(`catégorie « ${libCat} » inconnue → ${catParDefaut ? catParDefaut.libelle : '?'}`);
    d.categorie_id = (cat || catParDefaut || {}).id;
    d.categorie = (cat || catParDefaut || {}).libelle;

    let action = 'creer';
    if (d.matricule) {
      if (vus.has(d.matricule)) err.push(`matricule ${d.matricule} en double dans le fichier`);
      vus.add(d.matricule);
      if (!options.remplacer && existants.has(d.matricule)) action = 'maj';
    }
    lignes.push({ numeroLigne: indexEntete + k + 2, donnees: d, action: err.length ? 'ignorer' : action, avertissements: avert, erreurs: err });
  });

  return {
    lignes,
    reconnues,
    ignorees,
    resume: {
      total: lignes.length,
      creer: lignes.filter((l) => l.action === 'creer').length,
      maj: lignes.filter((l) => l.action === 'maj').length,
      ignorer: lignes.filter((l) => l.action === 'ignorer').length,
      avertis: lignes.filter((l) => l.avertissements.length && l.action !== 'ignorer').length,
    },
  };
}

// ---- Enregistrement ------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const { db, run, transaction, journaliser, DATA_DIR, PHOTO_DIR } = require('../db');
const { dernierNumero, formaterMatricule } = require('./matricules');

function sauvegarderBase(motif) {
  const dossier = path.join(DATA_DIR, 'sauvegardes');
  fs.mkdirSync(dossier, { recursive: true });
  const horodatage = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const fichier = path.join(dossier, `${motif}-${horodatage}.db`);
  db.exec(`VACUUM INTO '${fichier.replace(/'/g, "''")}'`);
  return fichier;
}

/** Supprime tous les adhérents et ce qui en dépend (versements, comptes, photos…). */
function viderAdherents() {
  const photos = all('SELECT photo FROM adherents WHERE photo IS NOT NULL').map((r) => r.photo);
  run('DELETE FROM versements');
  run('DELETE FROM cotisation_exc_adherents');
  run('DELETE FROM cotisations_exceptionnelles');
  run('DELETE FROM adherent_categorie_historique');
  run("DELETE FROM utilisateurs WHERE role = 'adherent'");
  run('DELETE FROM adherents');
  return photos;
}

function executerImport(lignes, options, user) {
  const aTraiter = lignes.filter((l) => l.action !== 'ignorer');
  let sauvegarde = null, photosASupprimer = [];
  if (options.remplacer) sauvegarde = sauvegarderBase('avant-import');

  const bilan = transaction(() => {
    let crees = 0, misAJour = 0;
    if (options.remplacer) photosASupprimer = viderAdherents();
    // Numéro d'ordre : après le plus grand numéro existant ou présent dans le fichier
    let numero = Math.max(dernierNumero(), ...aTraiter.map((l) => Number((l.donnees.matricule.match(/(\d+)$/) || [0, 0])[1])));
    for (const { donnees: d } of aTraiter) {
      const existant = d.matricule && get('SELECT * FROM adherents WHERE matricule = ?', d.matricule);
      if (existant) {
        // Mise à jour : seules les valeurs renseignées dans le fichier remplacent les anciennes
        const champs = ['nom', 'prenoms', 'sexe', 'date_naissance', 'lieu_naissance', 'profession', 'telephone', 'adresse',
          'famille', 'nom_pere', 'nom_mere', 'email', 'observations'];
        const maj = champs.filter((c) => d[c]);
        if (maj.length) run(`UPDATE adherents SET ${maj.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...maj.map((c) => d[c]), existant.id);
        misAJour++;
        continue;
      }
      const matricule = d.matricule || formaterMatricule(++numero, d.date_adhesion);
      const r = run(
        `INSERT INTO adherents(matricule, nom, prenoms, sexe, date_naissance, lieu_naissance, famille, nom_pere, nom_mere,
           telephone, email, adresse, profession, categorie_id, date_adhesion, observations)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        matricule, d.nom, d.prenoms, d.sexe, d.date_naissance, d.lieu_naissance, d.famille, d.nom_pere, d.nom_mere,
        d.telephone, d.email, d.adresse, d.profession, d.categorie_id, d.date_adhesion, d.observations
      );
      run('INSERT INTO adherent_categorie_historique(adherent_id, categorie_id, periode_debut) VALUES (?,?,?)', Number(r.lastInsertRowid), d.categorie_id, '0000');
      crees++;
    }
    journaliser(user, options.remplacer ? 'Import adhérents (remplacement)' : 'Import adhérents', 'adherent', null,
      `${options.nomFichier} : ${crees} créé(s), ${misAJour} mis à jour, ${lignes.length - aTraiter.length} ignoré(s)` +
      (sauvegarde ? ` — sauvegarde ${path.basename(sauvegarde)}` : ''));
    return { crees, misAJour, ignores: lignes.length - aTraiter.length };
  });
  for (const p of photosASupprimer) fs.unlink(path.join(PHOTO_DIR, path.basename(p)), () => {});
  return { ...bilan, sauvegarde };
}

function compterExistants() {
  return {
    adherents: get('SELECT COUNT(*) AS n FROM adherents').n,
    versements: get('SELECT COUNT(*) AS n FROM versements').n,
    comptes: get("SELECT COUNT(*) AS n FROM utilisateurs WHERE role = 'adherent'").n,
  };
}

module.exports = { analyserFichier, executerImport, compterExistants, sauvegarderBase, LIBELLES };
