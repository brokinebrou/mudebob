const express = require('express');
const { all, get, run, transaction, journaliser, getParams } = require('../db');
const { contexte, situationNormale, resteDuPeriode, periodeDe, periodeSuivante } = require('../services/cotisations');
const { genererRecu, chargerVersement } = require('../services/recu');
const { aujourdHui, MODES, libellePeriode } = require('../utils/format');

const router = express.Router();

function numeroRecu(dateVersement) {
  const p = getParams().prefixe_recu || 'REC';
  const annee = String(dateVersement).slice(0, 4);
  const prefixe = `${p}-${annee}-`;
  const r = get('SELECT MAX(CAST(substr(numero_recu, ?) AS INTEGER)) AS n FROM versements WHERE numero_recu LIKE ?', prefixe.length + 1, prefixe + '%');
  return prefixe + String((r.n || 0) + 1).padStart(5, '0');
}

function filtresListe(q) {
  const where = [], p = [];
  if (q.du) { where.push('v.date_versement >= ?'); p.push(q.du); }
  if (q.au) { where.push('v.date_versement <= ?'); p.push(q.au); }
  if (q.type) { where.push('v.type = ?'); p.push(q.type); }
  if (q.mode) { where.push('v.mode = ?'); p.push(q.mode); }
  if (q.etat === 'annules') where.push('v.annule = 1');
  else if (q.etat !== 'tous') where.push('v.annule = 0');
  if (q.q) {
    const l = `%${q.q}%`;
    where.push("(a.nom LIKE ? OR a.prenoms LIKE ? OR a.matricule LIKE ? OR v.numero_recu LIKE ? OR (a.nom || ' ' || a.prenoms) LIKE ?)");
    p.push(l, l, l, l, l);
  }
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', p };
}

const SQL_LISTE = `SELECT v.*, a.matricule, a.nom, a.prenoms, c.libelle AS exc_libelle, u.identifiant AS saisi_par_id
  FROM versements v JOIN adherents a ON a.id = v.adherent_id
  LEFT JOIN cotisations_exceptionnelles c ON c.id = v.cotisation_exc_id
  LEFT JOIN utilisateurs u ON u.id = v.saisi_par`;

router.get('/', (req, res) => {
  const q = { du: '', au: '', type: '', mode: '', etat: '', q: '', ...req.query };
  const { where, p } = filtresListe(q);
  const liste = all(`${SQL_LISTE} ${where} ORDER BY v.date_versement DESC, v.id DESC LIMIT 1000`, ...p);
  const total = liste.filter((v) => !v.annule).reduce((s, v) => s + v.montant, 0);
  res.render('versements/liste', { title: 'Versements', liste, total, filtres: q, MODES });
});

// ---- Saisie ----------------------------------------------------------------
function donneesFormulaire(v, erreurs = []) {
  const params = getParams();
  const ctx = contexte();
  let adherent = null, situation = null, exceptionnelles = [];
  if (v.adherent_id) {
    adherent = get('SELECT a.*, c.libelle AS categorie, c.montant AS categorie_montant FROM adherents a JOIN categories c ON c.id=a.categorie_id WHERE a.id = ?', v.adherent_id);
    if (adherent) {
      situation = situationNormale(adherent, ctx);
      exceptionnelles = all(
        `SELECT c.id, c.libelle, ca.montant_du AS du,
                COALESCE((SELECT SUM(montant) FROM versements WHERE cotisation_exc_id=c.id AND adherent_id=ca.adherent_id AND annule=0),0) AS paye
         FROM cotisation_exc_adherents ca JOIN cotisations_exceptionnelles c ON c.id=ca.cotisation_id
         WHERE ca.adherent_id = ? AND c.cloturee = 0 ORDER BY c.date_appel DESC`, adherent.id
      ).map((e) => ({ ...e, reste: Math.max(e.du - e.paye, 0) }));
    }
  }
  // Périodes proposées : impayées d'abord, puis la courante et quelques périodes à venir
  const periodes = [];
  if (situation) {
    situation.lignes.filter((l) => l.reste > 0).forEach((l) => periodes.push({ periode: l.periode, reste: l.reste, libelle: `${libellePeriode(l.periode)} — reste ${l.reste.toLocaleString('fr-FR')} FCFA` }));
    let p = ctx.courante;
    for (let i = 0; i < (params.periodicite === 'annuelle' ? 3 : 12); i++) {
      const ligne = situation.lignes.find((l) => l.periode === p);
      if (!periodes.find((x) => x.periode === p) && !(ligne && ligne.etat === 'a_jour' && ligne.du > 0) && !(ligne && ligne.etat === 'avance')) {
        const reste = adherent ? resteDuPeriode(adherent, p, ctx) : 0;
        periodes.push({ periode: p, reste, libelle: `${libellePeriode(p)}${p > ctx.courante ? ' (avance)' : ''}` });
      }
      p = periodeSuivante(p);
    }
  }
  return { title: 'Nouveau versement', v, adherent, situation, exceptionnelles, periodes, MODES, erreurs, periodicite: params.periodicite };
}

router.get('/nouveau', (req, res) => {
  const v = { adherent_id: Number(req.query.adherent) || null, type: req.query.type || 'normale', date_versement: aujourdHui(), mode: 'Espèces', cotisation_exc_id: Number(req.query.exc) || null };
  res.render('versements/form', donneesFormulaire(v));
});

router.post('/', (req, res) => {
  const b = req.body;
  const v = {
    adherent_id: Number(b.adherent_id) || null,
    type: b.type === 'exceptionnelle' ? 'exceptionnelle' : 'normale',
    periode: b.periode || null,
    cotisation_exc_id: Number(b.cotisation_exc_id) || null,
    montant: Math.round(Number(String(b.montant || '').replace(/\s/g, ''))),
    date_versement: b.date_versement || aujourdHui(),
    mode: MODES.includes(b.mode) ? b.mode : null,
    reference: String(b.reference || '').trim(),
    observations: String(b.observations || '').trim(),
  };
  const erreurs = [];
  const adherent = v.adherent_id && get('SELECT * FROM adherents WHERE id = ?', v.adherent_id);
  if (!adherent) erreurs.push('Sélectionnez un adhérent.');
  if (!(v.montant > 0)) erreurs.push('Le montant doit être supérieur à zéro.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date_versement)) erreurs.push('La date est invalide.');
  if (v.date_versement > aujourdHui()) erreurs.push('La date du versement ne peut pas être dans le futur.');
  if (!v.mode) erreurs.push('Choisissez le mode de paiement.');
  if (v.type === 'normale') {
    const per = getParams().periodicite;
    const re = per === 'annuelle' ? /^\d{4}$/ : /^\d{4}-\d{2}$/;
    if (!v.periode || !re.test(v.periode)) erreurs.push('Choisissez la période concernée.');
    else if (adherent && v.periode < periodeDe(adherent.date_adhesion, per)) erreurs.push("La période est antérieure à l'adhésion.");
    v.cotisation_exc_id = null;
  } else {
    const lien = v.cotisation_exc_id && get('SELECT 1 FROM cotisation_exc_adherents WHERE cotisation_id = ? AND adherent_id = ?', v.cotisation_exc_id, v.adherent_id);
    if (!lien) erreurs.push('Choisissez une cotisation exceptionnelle concernant cet adhérent.');
    v.periode = null;
  }
  if (erreurs.length) return res.status(400).render('versements/form', donneesFormulaire(v, erreurs));

  const id = transaction(() => {
    const numero = numeroRecu(v.date_versement);
    const r = run(
      `INSERT INTO versements(numero_recu, adherent_id, type, periode, cotisation_exc_id, montant, date_versement, mode, reference, observations, saisi_par)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      numero, v.adherent_id, v.type, v.periode, v.cotisation_exc_id, v.montant, v.date_versement, v.mode, v.reference, v.observations, req.user.id
    );
    journaliser(req.user, 'Enregistrement versement', 'versement', Number(r.lastInsertRowid), `${numero} — ${v.montant} FCFA`);
    return Number(r.lastInsertRowid);
  });
  req.flash('success', 'Versement enregistré.');
  res.redirect(`/versements/${id}`);
});

// ---- Détail, reçu, annulation ---------------------------------------------
router.get('/:id(\\d+)', (req, res) => {
  const v = chargerVersement(req.params.id);
  if (!v) return res.status(404).render('erreur', { title: 'Introuvable', code: 404, message: 'Versement introuvable.' });
  const annulePar = v.annule_par ? get('SELECT identifiant FROM utilisateurs WHERE id = ?', v.annule_par) : null;
  res.render('versements/detail', { title: 'Versement ' + v.numero_recu, v, annulePar });
});

router.get('/:id(\\d+)/recu.pdf', (req, res) => {
  const v = chargerVersement(req.params.id);
  if (!v) return res.status(404).end();
  genererRecu(v, res);
});

router.post('/:id(\\d+)/annuler', (req, res) => {
  const v = get('SELECT * FROM versements WHERE id = ?', req.params.id);
  const motif = String(req.body.motif || '').trim();
  if (!v || v.annule) return res.redirect('/versements');
  if (motif.length < 3) {
    req.flash('danger', "Indiquez le motif de l'annulation.");
    return res.redirect(`/versements/${v.id}`);
  }
  run("UPDATE versements SET annule = 1, motif_annulation = ?, annule_par = ?, annule_le = datetime('now','localtime') WHERE id = ?", motif, req.user.id, v.id);
  journaliser(req.user, 'Annulation versement', 'versement', v.id, `${v.numero_recu} — ${v.montant} FCFA — motif : ${motif}`);
  req.flash('warning', `Le versement ${v.numero_recu} a été annulé.`);
  res.redirect(`/versements/${v.id}`);
});

module.exports = router;
module.exports.filtresListe = filtresListe;
module.exports.SQL_LISTE = SQL_LISTE;
