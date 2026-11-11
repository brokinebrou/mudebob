const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { all, get, run, transaction, journaliser, getParams } = require('../db');
const { situationNormale, situationExceptionnelle, situationsTous, periodeCourante, periodeSuivante } = require('../services/cotisations');
const { aujourdHui } = require('../utils/format');
const { verifierCsrf } = require('../middleware/auth');
const { uploadPhoto, photoValide, supprimerPhoto, envoyerPhoto } = require('../services/photos');
const { genererMatricule } = require('../services/matricules');
const { genererCarte, genererPlanche } = require('../services/carte');

const router = express.Router();

// Formulaire avec photo (multipart) : réception du fichier puis contrôle CSRF
const avecPhoto = [uploadPhoto.single('photo'), verifierCsrf];

// Contrôle de la photo envoyée ; renvoie le nom du fichier retenu ou null
function verifierPhoto(req, erreurs) {
  if (req.erreurPhoto) erreurs.push(req.erreurPhoto);
  if (!req.file) return null;
  if (!photoValide(req.file)) erreurs.push("Le fichier photo n'est pas une image valide.");
  if (erreurs.length) { supprimerPhoto(req.file.filename); return null; }
  return req.file.filename;
}


function lireFormulaire(body) {
  const a = {
    nom: String(body.nom || '').trim().toUpperCase(),
    prenoms: String(body.prenoms || '').trim(),
    sexe: ['M', 'F'].includes(body.sexe) ? body.sexe : null,
    date_naissance: body.date_naissance || null,
    lieu_naissance: String(body.lieu_naissance || '').trim(),
    famille: String(body.famille || '').trim(),
    nom_pere: String(body.nom_pere || '').trim(),
    nom_mere: String(body.nom_mere || '').trim(),
    telephone: String(body.telephone || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    adresse: String(body.adresse || '').trim(),
    profession: String(body.profession || '').trim(),
    categorie_id: Number(body.categorie_id),
    date_adhesion: body.date_adhesion || aujourdHui(),
    observations: String(body.observations || '').trim(),
  };
  const erreurs = [];
  if (!a.nom) erreurs.push('Le nom est obligatoire.');
  if (!a.prenoms) erreurs.push('Les prénoms sont obligatoires.');
  if (!get('SELECT id FROM categories WHERE id = ?', a.categorie_id)) erreurs.push('Choisissez une catégorie.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date_adhesion)) erreurs.push("La date d'adhésion est invalide.");
  if (a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) erreurs.push("L'adresse e-mail est invalide.");
  if (a.telephone && !/^[+\d\s().-]{6,20}$/.test(a.telephone)) erreurs.push('Le numéro de téléphone est invalide.');
  if (a.date_naissance && !/^\d{4}-\d{2}-\d{2}$/.test(a.date_naissance)) erreurs.push('La date de naissance est invalide.');
  if (a.date_naissance && a.date_naissance > aujourdHui()) erreurs.push('La date de naissance ne peut pas être dans le futur.');
  return { a, erreurs };
}

function chargerAdherent(id) {
  return get(
    `SELECT a.*, c.libelle AS categorie, c.montant AS categorie_montant FROM adherents a
     JOIN categories c ON c.id = a.categorie_id WHERE a.id = ?`,
    id
  );
}

// ---- Liste ---------------------------------------------------------------
function listeFiltree(query) {
  const { q = '', categorie = '', statut = '', situation = '' } = query;
  const where = [], p = [];
  if (q) {
    where.push("(a.nom LIKE ? OR a.prenoms LIKE ? OR a.matricule LIKE ? OR a.telephone LIKE ? OR (a.nom || ' ' || a.prenoms) LIKE ?)");
    const like = `%${q}%`;
    p.push(like, like, like, like, like);
  }
  if (categorie) { where.push('a.categorie_id = ?'); p.push(Number(categorie)); }
  if (statut) { where.push('a.statut = ?'); p.push(statut); }
  let liste = situationsTous(`${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.nom, a.prenoms`, ...p);
  if (situation === 'a_jour') liste = liste.filter((a) => a.resteTotal === 0);
  if (situation === 'retard') liste = liste.filter((a) => a.resteTotal > 0);
  return { liste, filtres: { q, categorie, statut, situation } };
}

router.get('/', (req, res) => {
  const { liste, filtres } = listeFiltree(req.query);
  res.render('adherents/liste', {
    title: 'Adhérents',
    liste,
    categories: all('SELECT * FROM categories ORDER BY libelle'),
    filtres,
  });
});

// ---- Cartes de membre --------------------------------------------------------
// Planche A4 (10 cartes par page) pour les adhérents de la liste filtrée
router.get('/cartes.pdf', (req, res) => {
  const { liste } = listeFiltree(req.query);
  if (!liste.length) { req.flash('warning', 'Aucun adhérent ne correspond à ces critères.'); return res.redirect('/adherents'); }
  if (liste.length > 1000) { req.flash('warning', 'Trop de cartes (1000 maximum par impression) : affinez les filtres.'); return res.redirect('/adherents'); }
  const ids = liste.map((a) => a.id);
  const complets = all(`SELECT * FROM adherents WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY nom, prenoms`, ...ids);
  journaliser(req.user, `Impression de ${complets.length} carte(s) de membre`, 'adherent', null);
  genererPlanche(complets, res);
});

router.get('/:id/carte.pdf', (req, res) => {
  const a = get('SELECT * FROM adherents WHERE id = ?', req.params.id);
  if (!a) return res.status(404).render('erreur', { title: 'Introuvable', code: 404, message: 'Adhérent introuvable.' });
  journaliser(req.user, `Impression de la carte de membre ${a.matricule}`, 'adherent', a.id);
  genererCarte(a, res);
});

// ---- Import depuis Excel / CSV ----------------------------------------------
const multer = require('multer');
const path = require('path');
const { analyserFichier, executerImport, compterExistants } = require('../services/importAdherents');
const uploadImport = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.xlsx', '.csv', '.txt'].includes(ext)) {
      req.erreurFichier = ext === '.xls'
        ? "Format .xls (ancien Excel) non pris en charge : dans Excel, faites « Enregistrer sous » et choisissez « Classeur Excel (*.xlsx) » ou « CSV (séparateur : point-virgule) »."
        : 'Format non accepté : choisissez un fichier Excel (.xlsx) ou CSV (.csv).';
      return cb(null, false);
    }
    cb(null, true);
  },
});

function pageImport(req, res, extra = {}) {
  res.render('adherents/import', {
    title: 'Importer des adhérents',
    categories: all('SELECT * FROM categories ORDER BY libelle'),
    existants: compterExistants(),
    options: { categorie_id: '', date_adhesion: aujourdHui(), remplacer: false },
    analyse: null,
    erreur: null,
    ...extra,
  });
}

router.get('/importer', (req, res) => {
  delete req.session.import;
  pageImport(req, res);
});

router.post('/importer', uploadImport.single('fichier'), verifierCsrf, async (req, res, next) => {
  try {
    const options = {
      categorie_id: Number(req.body.categorie_id) || null,
      date_adhesion: /^\d{4}-\d{2}-\d{2}$/.test(req.body.date_adhesion || '') ? req.body.date_adhesion : aujourdHui(),
      remplacer: req.body.remplacer === '1',
      nomFichier: req.file ? req.file.originalname : '',
    };
    const erreur = (m) => pageImport(req, res, { options, erreur: m });
    if (req.erreurFichier) return erreur(req.erreurFichier);
    if (!req.file) return erreur('Choisissez le fichier à importer.');
    if (!get('SELECT id FROM categories WHERE id = ?', options.categorie_id)) return erreur('Choisissez la catégorie à attribuer par défaut.');
    let analyse;
    try {
      analyse = await analyserFichier(req.file.buffer, path.extname(req.file.originalname).toLowerCase() === '.xlsx' ? '.xlsx' : '.csv', options);
    } catch (e) {
      return erreur("Impossible de lire ce fichier. Vérifiez qu'il s'agit bien d'un classeur Excel (.xlsx) ou d'un fichier CSV.");
    }
    if (analyse.erreurGlobale) return erreur(analyse.erreurGlobale);
    req.session.import = { lignes: analyse.lignes, options };
    pageImport(req, res, { options, analyse });
  } catch (e) { next(e); }
});

router.post('/importer/confirmer', (req, res) => {
  const imp = req.session.import;
  if (!imp) {
    req.flash('warning', "L'aperçu a expiré : sélectionnez à nouveau le fichier.");
    return res.redirect('/adherents/importer');
  }
  if (imp.options.remplacer && req.body.confirmation !== 'REMPLACER') {
    req.flash('danger', 'Pour remplacer les adhérents existants, tapez REMPLACER dans la case de confirmation.');
    return res.redirect('/adherents/importer');
  }
  const bilan = executerImport(imp.lignes, imp.options, req.user);
  delete req.session.import;
  req.flash('success', `Import terminé : ${bilan.crees} adhérent(s) créé(s), ${bilan.misAJour} mis à jour, ${bilan.ignores} ligne(s) ignorée(s).` +
    (bilan.sauvegarde ? ` Sauvegarde de l'ancienne base : data/sauvegardes/${path.basename(bilan.sauvegarde)}` : ''));
  res.redirect('/adherents');
});

// Fichier modèle à remplir
router.get('/importer/modele.xlsx', async (req, res, next) => {
  try {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Adhérents');
    ws.columns = [
      { header: 'Mat.', width: 18 }, { header: 'Nom', width: 18 }, { header: 'Prénoms', width: 24 }, { header: 'Sexe', width: 10 },
      { header: 'Né le', width: 12 }, { header: 'Lieu', width: 16 }, { header: 'Profession', width: 20 }, { header: 'Tel', width: 16 },
      { header: 'Résidence', width: 16 }, { header: 'Famille', width: 18 }, { header: 'Père', width: 22 }, { header: 'Mère', width: 22 },
      { header: "Date d'adhésion", width: 14 }, { header: 'Catégorie', width: 16 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E6B23' } };
    ws.addRow(['MU-09-25-00001', 'KOUASSI', 'YAO JEAN', 'Masculin', '15/03/1980', 'BONIANKRO', 'COMPTABLE', '07 07 00 00 00',
      'YOPOUGON', 'YOBOUE', 'KOUASSI KONAN', 'AYA AKISSI', '01/09/2025', 'Membre actif']);
    ws.getColumn(8).numFmt = '@';
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="modele-import-adherents.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
});

// ---- Création ------------------------------------------------------------
router.get('/nouveau', (req, res) => {
  res.render('adherents/form', {
    title: 'Nouvel adhérent',
    a: { date_adhesion: aujourdHui(), statut: 'actif' },
    categories: all('SELECT * FROM categories ORDER BY libelle'),
    erreurs: [],
  });
});

router.post('/', avecPhoto, (req, res) => {
  const { a, erreurs } = lireFormulaire(req.body);
  const photo = verifierPhoto(req, erreurs);
  if (erreurs.length) {
    if (photo) supprimerPhoto(photo);
    return res.status(400).render('adherents/form', { title: 'Nouvel adhérent', a, categories: all('SELECT * FROM categories ORDER BY libelle'), erreurs });
  }
  const id = transaction(() => {
    const matricule = genererMatricule(a.date_adhesion);
    const r = run(
      `INSERT INTO adherents(matricule, nom, prenoms, sexe, date_naissance, lieu_naissance, famille, nom_pere, nom_mere, photo,
         telephone, email, adresse, profession, categorie_id, date_adhesion, observations)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      matricule, a.nom, a.prenoms, a.sexe, a.date_naissance, a.lieu_naissance, a.famille, a.nom_pere, a.nom_mere, photo,
      a.telephone, a.email, a.adresse, a.profession, a.categorie_id, a.date_adhesion, a.observations
    );
    const newId = Number(r.lastInsertRowid);
    run('INSERT INTO adherent_categorie_historique(adherent_id, categorie_id, periode_debut) VALUES (?,?,?)', newId, a.categorie_id, '0000');
    journaliser(req.user, 'Création adhérent', 'adherent', newId, `${matricule} ${a.nom} ${a.prenoms}`);
    return newId;
  });
  req.flash('success', 'Adhérent enregistré avec succès.');
  res.redirect(`/adherents/${id}`);
});

// ---- Fiche ----------------------------------------------------------------
router.get('/:id(\\d+)', (req, res) => {
  const a = chargerAdherent(req.params.id);
  if (!a) return res.status(404).render('erreur', { title: 'Introuvable', code: 404, message: 'Adhérent introuvable.' });
  const situation = situationNormale(a);
  const exceptionnelles = situationExceptionnelle(a.id);
  const versements = all(
    `SELECT v.*, c.libelle AS exc_libelle FROM versements v LEFT JOIN cotisations_exceptionnelles c ON c.id = v.cotisation_exc_id
     WHERE v.adherent_id = ? ORDER BY v.date_versement DESC, v.id DESC`,
    a.id
  );
  const compte = get('SELECT id, identifiant, actif, dernier_login FROM utilisateurs WHERE adherent_id = ?', a.id);
  const historiqueCat = all(
    `SELECT h.periode_debut, c.libelle FROM adherent_categorie_historique h JOIN categories c ON c.id = h.categorie_id
     WHERE h.adherent_id = ? ORDER BY h.periode_debut, h.id`,
    a.id
  );
  res.render('adherents/fiche', {
    title: `${a.nom} ${a.prenoms}`,
    a, situation, exceptionnelles, versements, compte, historiqueCat,
    motDePasseTemporaire: req.session.mdpTemp && req.session.mdpTemp.id === a.id ? req.session.mdpTemp : null,
  });
  delete req.session.mdpTemp;
});

// ---- Modification ---------------------------------------------------------
router.get('/:id(\\d+)/modifier', (req, res) => {
  const a = chargerAdherent(req.params.id);
  if (!a) return res.redirect('/adherents');
  res.render('adherents/form', { title: 'Modifier un adhérent', a, categories: all('SELECT * FROM categories ORDER BY libelle'), erreurs: [] });
});

router.post('/:id(\\d+)', avecPhoto, (req, res) => {
  const ancien = chargerAdherent(req.params.id);
  if (!ancien) { if (req.file) supprimerPhoto(req.file.filename); return res.redirect('/adherents'); }
  const { a, erreurs } = lireFormulaire(req.body);
  const nouvellePhoto = verifierPhoto(req, erreurs);
  a.id = ancien.id;
  a.matricule = ancien.matricule;
  a.photo = ancien.photo;
  if (erreurs.length) {
    if (nouvellePhoto) supprimerPhoto(nouvellePhoto);
    return res.status(400).render('adherents/form', { title: 'Modifier un adhérent', a, categories: all('SELECT * FROM categories ORDER BY libelle'), erreurs });
  }
  // Nouvelle photo : remplace l'ancienne. Case « retirer la photo » : supprime l'ancienne.
  let photo = ancien.photo;
  if (nouvellePhoto) photo = nouvellePhoto;
  else if (req.body.retirer_photo) photo = null;
  transaction(() => {
    run(
      `UPDATE adherents SET nom=?, prenoms=?, sexe=?, date_naissance=?, lieu_naissance=?, famille=?, nom_pere=?, nom_mere=?, photo=?,
       telephone=?, email=?, adresse=?, profession=?, categorie_id=?, date_adhesion=?, observations=? WHERE id=?`,
      a.nom, a.prenoms, a.sexe, a.date_naissance, a.lieu_naissance, a.famille, a.nom_pere, a.nom_mere, photo,
      a.telephone, a.email, a.adresse, a.profession, a.categorie_id, a.date_adhesion, a.observations, ancien.id
    );
    if (a.categorie_id !== ancien.categorie_id) {
      // Le changement de catégorie s'applique à partir de la période suivante
      const nb = get('SELECT COUNT(*) AS n FROM adherent_categorie_historique WHERE adherent_id = ?', ancien.id).n;
      if (!nb) run('INSERT INTO adherent_categorie_historique(adherent_id, categorie_id, periode_debut) VALUES (?,?,?)', ancien.id, ancien.categorie_id, '0000');
      const debut = periodeSuivante(periodeCourante());
      run('DELETE FROM adherent_categorie_historique WHERE adherent_id = ? AND periode_debut = ?', ancien.id, debut);
      run('INSERT INTO adherent_categorie_historique(adherent_id, categorie_id, periode_debut) VALUES (?,?,?)', ancien.id, a.categorie_id, debut);
    }
    journaliser(req.user, 'Modification adhérent', 'adherent', ancien.id, `${ancien.matricule}`);
  });
  if (ancien.photo && ancien.photo !== photo) supprimerPhoto(ancien.photo);
  req.flash('success', 'Modifications enregistrées.' + (a.categorie_id !== ancien.categorie_id ? ' La nouvelle catégorie s’applique à partir de la prochaine période.' : ''));
  res.redirect(`/adherents/${ancien.id}`);
});

// ---- Photo d'identité (servie uniquement aux administrateurs) -------------
router.get('/:id(\\d+)/photo', (req, res) => {
  const a = get('SELECT photo FROM adherents WHERE id = ?', req.params.id);
  envoyerPhoto(res, a && a.photo);
});

// ---- Statut ---------------------------------------------------------------
router.post('/:id(\\d+)/statut', (req, res) => {
  const a = chargerAdherent(req.params.id);
  const statut = req.body.statut;
  if (!a || !['actif', 'suspendu', 'radie'].includes(statut)) return res.redirect('/adherents');
  const dateSortie = statut === 'actif' ? null : req.body.date_sortie || aujourdHui();
  run('UPDATE adherents SET statut = ?, date_sortie = ? WHERE id = ?', statut, dateSortie, a.id);
  if (statut === 'radie') run('UPDATE utilisateurs SET actif = 0 WHERE adherent_id = ?', a.id);
  journaliser(req.user, 'Changement de statut', 'adherent', a.id, `${a.matricule} : ${a.statut} → ${statut}`);
  req.flash('success', 'Statut mis à jour.');
  res.redirect(`/adherents/${a.id}`);
});

// ---- Compte de connexion de l'adhérent -------------------------------------
function motDePasseTemporaire() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s.slice(0, 6) + crypto.randomInt(10) + crypto.randomInt(10);
}

router.post('/:id(\\d+)/compte', (req, res) => {
  const a = chargerAdherent(req.params.id);
  if (!a) return res.redirect('/adherents');
  const compte = get('SELECT * FROM utilisateurs WHERE adherent_id = ?', a.id);
  const mdp = motDePasseTemporaire();
  const hash = bcrypt.hashSync(mdp, 10);
  let identifiant;
  if (compte) {
    identifiant = compte.identifiant;
    run('UPDATE utilisateurs SET mot_de_passe_hash = ?, doit_changer_mdp = 1, actif = 1, echecs_connexion = 0, bloque_jusqua = NULL WHERE id = ?', hash, compte.id);
    journaliser(req.user, 'Réinitialisation mot de passe adhérent', 'utilisateur', compte.id, identifiant);
  } else {
    identifiant = a.matricule.toLowerCase();
    run(
      `INSERT INTO utilisateurs(identifiant, nom_complet, mot_de_passe_hash, role, adherent_id, doit_changer_mdp) VALUES (?,?,?,'adherent',?,1)`,
      identifiant, `${a.prenoms} ${a.nom}`, hash, a.id
    );
    journaliser(req.user, 'Création compte adhérent', 'adherent', a.id, identifiant);
  }
  req.session.mdpTemp = { id: a.id, identifiant, mdp };
  res.redirect(`/adherents/${a.id}#compte`);
});

router.post('/:id(\\d+)/compte/desactiver', (req, res) => {
  run('UPDATE utilisateurs SET actif = CASE actif WHEN 1 THEN 0 ELSE 1 END WHERE adherent_id = ?', Number(req.params.id));
  journaliser(req.user, 'Activation/désactivation compte adhérent', 'adherent', Number(req.params.id));
  req.flash('success', 'Accès de l’adhérent mis à jour.');
  res.redirect(`/adherents/${req.params.id}#compte`);
});

// ---- Recherche JSON (sélection dans le formulaire de versement) -----------
router.get('/recherche.json', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  res.json(all(
    `SELECT a.id, a.matricule, a.nom, a.prenoms, c.libelle AS categorie, a.statut FROM adherents a JOIN categories c ON c.id = a.categorie_id
     WHERE a.statut != 'radie' AND (a.nom LIKE ? OR a.prenoms LIKE ? OR a.matricule LIKE ? OR (a.nom || ' ' || a.prenoms) LIKE ?)
     ORDER BY a.nom LIMIT 15`,
    q, q, q, q
  ));
});

module.exports = router;
