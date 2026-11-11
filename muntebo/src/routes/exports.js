const express = require('express');
const { all, get } = require('../db');
const { situationsTous, recouvrementExceptionnelle } = require('../services/cotisations');
const { envoyerClasseur } = require('../services/excel');
const { filtresListe, SQL_LISTE } = require('./versements');
const { STATUTS, libellePeriode, aujourdHui } = require('../utils/format');

const router = express.Router();
const horodatage = () => aujourdHui();

router.get('/', (req, res) => {
  res.render('exports', {
    title: 'Exports Excel',
    exceptionnelles: all('SELECT id, libelle FROM cotisations_exceptionnelles ORDER BY date_appel DESC'),
  });
});

router.get('/adherents.xlsx', async (req, res, next) => {
  try {
    const liste = situationsTous('ORDER BY a.nom, a.prenoms');
    await envoyerClasseur(res, `adherents-${horodatage()}`, 'Liste des adhérents', [
      { header: 'Matricule', key: 'matricule', width: 12 },
      { header: 'Nom', key: 'nom', width: 18 },
      { header: 'Prénoms', key: 'prenoms', width: 22 },
      { header: 'Sexe', key: 'sexe', width: 6 },
      { header: 'Date de naissance', key: 'date_naissance', width: 14, date: true },
      { header: 'Lieu de naissance', key: 'lieu_naissance', width: 18 },
      { header: 'Famille', key: 'famille', width: 18 },
      { header: 'Père', key: 'nom_pere', width: 24 },
      { header: 'Mère', key: 'nom_mere', width: 24 },
      { header: 'Téléphone', key: 'telephone', width: 16 },
      { header: 'E-mail', key: 'email', width: 24 },
      { header: 'Profession', key: 'profession', width: 18 },
      { header: 'Adresse', key: 'adresse', width: 24 },
      { header: 'Catégorie', key: 'categorie', width: 18 },
      { header: "Date d'adhésion", key: 'date_adhesion', width: 14, date: true },
      { header: 'Statut', key: (a) => STATUTS[a.statut], width: 10 },
      { header: 'Reste dû (normales)', key: 'resteNormal', width: 18, fcfa: true },
      { header: 'Reste dû (exceptionnelles)', key: 'resteExc', width: 20, fcfa: true },
    ], liste);
  } catch (e) { next(e); }
});

router.get('/versements.xlsx', async (req, res, next) => {
  try {
    const q = { ...req.query };
    const { where, p } = filtresListe(q);
    const liste = all(`${SQL_LISTE} ${where} ORDER BY v.date_versement, v.id`, ...p);
    const total = liste.filter((v) => !v.annule).reduce((s, v) => s + v.montant, 0);
    await envoyerClasseur(res, `versements-${horodatage()}`, 'Versements', [
      { header: 'N° reçu', key: 'numero_recu', width: 18 },
      { header: 'Date', key: 'date_versement', width: 12, date: true },
      { header: 'Matricule', key: 'matricule', width: 12 },
      { header: 'Adhérent', key: (v) => `${v.nom} ${v.prenoms}`, width: 28 },
      { header: 'Type', key: (v) => (v.type === 'normale' ? 'Normale' : 'Exceptionnelle'), width: 14 },
      { header: 'Objet', key: (v) => (v.type === 'normale' ? libellePeriode(v.periode) : v.exc_libelle), width: 26 },
      { header: 'Mode', key: 'mode', width: 14 },
      { header: 'Référence', key: 'reference', width: 16 },
      { header: 'Montant', key: (v) => (v.annule ? 0 : v.montant), width: 16, fcfa: true },
      { header: 'État', key: (v) => (v.annule ? 'Annulé : ' + (v.motif_annulation || '') : 'Valide'), width: 20 },
      { header: 'Saisi par', key: 'saisi_par_id', width: 12 },
    ], liste, { Mode: 'TOTAL', Montant: total });
  } catch (e) { next(e); }
});

router.get('/impayes.xlsx', async (req, res, next) => {
  try {
    const liste = situationsTous("WHERE a.statut != 'radie' ORDER BY a.nom").filter((a) => a.resteTotal > 0)
      .sort((x, y) => y.resteTotal - x.resteTotal);
    await envoyerClasseur(res, `impayes-${horodatage()}`, 'État des impayés', [
      { header: 'Matricule', key: 'matricule', width: 12 },
      { header: 'Nom et prénoms', key: (a) => `${a.nom} ${a.prenoms}`, width: 30 },
      { header: 'Téléphone', key: 'telephone', width: 16 },
      { header: 'Catégorie', key: 'categorie', width: 18 },
      { header: 'Périodes en retard', key: (a) => a.situation.periodesImpayees, width: 16 },
      { header: 'Reste normales', key: 'resteNormal', width: 18, fcfa: true },
      { header: 'Reste exceptionnelles', key: 'resteExc', width: 20, fcfa: true },
      { header: 'Total dû', key: 'resteTotal', width: 18, fcfa: true },
    ], liste, {
      'Catégorie': 'TOTAL',
      'Reste normales': liste.reduce((s, a) => s + a.resteNormal, 0),
      'Reste exceptionnelles': liste.reduce((s, a) => s + a.resteExc, 0),
      'Total dû': liste.reduce((s, a) => s + a.resteTotal, 0),
    });
  } catch (e) { next(e); }
});

router.get('/exceptionnelle/:id(\\d+).xlsx', async (req, res, next) => {
  try {
    const c = get('SELECT * FROM cotisations_exceptionnelles WHERE id = ?', req.params.id);
    if (!c) return res.status(404).end();
    const rec = recouvrementExceptionnelle(c.id);
    await envoyerClasseur(res, `recouvrement-${c.id}-${horodatage()}`, `Recouvrement ${c.libelle}`, [
      { header: 'Matricule', key: 'matricule', width: 12 },
      { header: 'Nom et prénoms', key: (l) => `${l.nom} ${l.prenoms}`, width: 30 },
      { header: 'Téléphone', key: 'telephone', width: 16 },
      { header: 'Montant dû', key: 'du', width: 16, fcfa: true },
      { header: 'Versé', key: 'paye', width: 16, fcfa: true },
      { header: 'Reste', key: 'reste', width: 16, fcfa: true },
      { header: 'Situation', key: (l) => (l.reste === 0 ? 'Payé' : l.paye > 0 ? 'Partiel' : 'Non payé'), width: 12 },
    ], rec.lignes, { 'Téléphone': `TOTAL (${rec.taux} %)`, 'Montant dû': rec.du, 'Versé': rec.paye, 'Reste': rec.reste });
  } catch (e) { next(e); }
});

module.exports = router;
