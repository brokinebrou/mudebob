const express = require('express');
const { all, get } = require('../db');
const { situationsTous, recouvrementExceptionnelle } = require('../services/cotisations');
const { aujourdHui, MOIS } = require('../utils/format');

const router = express.Router();

router.get('/', (req, res) => {
  const today = aujourdHui();
  const mois = today.slice(0, 7);
  const annee = today.slice(0, 4);

  const situations = situationsTous();
  const actifs = situations.filter((a) => a.statut === 'actif');
  const totalImpayes = situations.reduce((s, a) => s + a.resteTotal, 0);
  const nbAJour = actifs.filter((a) => a.resteTotal === 0).length;

  const encMois = get("SELECT COALESCE(SUM(montant),0) AS t FROM versements WHERE annule=0 AND substr(date_versement,1,7)=?", mois).t;
  const encAnnee = get("SELECT COALESCE(SUM(montant),0) AS t FROM versements WHERE annule=0 AND substr(date_versement,1,4)=?", annee).t;

  // Encaissements des 12 derniers mois
  const labels = [], normales = [], exceptionnelles = [];
  const d = new Date(Number(annee), Number(mois.slice(5)) - 1, 1);
  const parMois = new Map(all(
    `SELECT substr(date_versement,1,7) AS m, type, SUM(montant) AS t FROM versements
     WHERE annule=0 AND date_versement >= ? GROUP BY m, type`,
    `${new Date(d.getFullYear(), d.getMonth() - 11, 1).toISOString().slice(0, 7)}-01`
  ).map((r) => [r.m + r.type, r.t]));
  for (let i = 11; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const k = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
    labels.push(MOIS[x.getMonth()].slice(0, 4) + '. ' + String(x.getFullYear()).slice(2));
    normales.push(parMois.get(k + 'normale') || 0);
    exceptionnelles.push(parMois.get(k + 'exceptionnelle') || 0);
  }

  const repartition = all(
    `SELECT c.libelle, COUNT(a.id) AS n FROM categories c LEFT JOIN adherents a ON a.categorie_id=c.id AND a.statut='actif'
     GROUP BY c.id ORDER BY n DESC`
  );

  const derniers = all(
    `SELECT v.*, a.nom, a.prenoms, a.matricule, c.libelle AS exc_libelle FROM versements v
     JOIN adherents a ON a.id=v.adherent_id LEFT JOIN cotisations_exceptionnelles c ON c.id=v.cotisation_exc_id
     ORDER BY v.id DESC LIMIT 8`
  );

  const retards = [...actifs].filter((a) => a.resteTotal > 0).sort((a, b) => b.resteTotal - a.resteTotal).slice(0, 8);

  const exceptionnellesEnCours = all('SELECT id, libelle, date_echeance FROM cotisations_exceptionnelles WHERE cloturee=0 ORDER BY date_appel DESC LIMIT 4')
    .map((c) => ({ ...c, ...recouvrementExceptionnelle(c.id) }));

  const derniersPv = all('SELECT id, titre, date_reunion, type_reunion FROM pv_reunions ORDER BY date_reunion DESC LIMIT 4');

  res.render('dashboard', {
    title: 'Tableau de bord',
    stats: { actifs: actifs.length, total: situations.length, encMois, encAnnee, totalImpayes, nbAJour },
    chart: { labels, normales, exceptionnelles, repartition },
    derniers, retards, exceptionnellesEnCours, derniersPv,
  });
});

module.exports = router;
