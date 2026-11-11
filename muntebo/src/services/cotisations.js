const { all, get, getParams } = require('../db');
const { aujourdHui } = require('../utils/format');

// ---- Périodes -------------------------------------------------------------
// mensuelle : "AAAA-MM" ; annuelle : "AAAA"

function periodeDe(dateIso, periodicite) {
  const d = String(dateIso || aujourdHui()).slice(0, 10);
  return periodicite === 'annuelle' ? d.slice(0, 4) : d.slice(0, 7);
}

function periodeSuivante(p) {
  if (p.length === 4) return String(Number(p) + 1);
  let [y, m] = p.split('-').map(Number);
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function listePeriodes(debut, fin) {
  const res = [];
  if (!debut || !fin || debut > fin) return res;
  let p = debut;
  while (p <= fin && res.length < 1200) { res.push(p); p = periodeSuivante(p); }
  return res;
}

function periodeCourante(params = getParams()) {
  return periodeDe(aujourdHui(), params.periodicite);
}

function premierePeriodeAssociation(params) {
  return params.periodicite === 'annuelle' ? String(params.annee_demarrage) : `${params.annee_demarrage}-01`;
}

// ---- Contexte de calcul (préchargé une fois pour tout le monde) -----------

function contexte() {
  const params = getParams();
  const categories = new Map(all('SELECT * FROM categories').map((c) => [c.id, c]));
  const historiques = new Map();
  for (const h of all('SELECT adherent_id, categorie_id, periode_debut FROM adherent_categorie_historique ORDER BY periode_debut, id')) {
    if (!historiques.has(h.adherent_id)) historiques.set(h.adherent_id, []);
    historiques.get(h.adherent_id).push(h);
  }
  const paiements = new Map(); // adherent_id -> Map(periode -> montant)
  for (const v of all(`SELECT adherent_id, periode, SUM(montant) AS total FROM versements
                       WHERE annule = 0 AND type = 'normale' GROUP BY adherent_id, periode`)) {
    if (!paiements.has(v.adherent_id)) paiements.set(v.adherent_id, new Map());
    paiements.get(v.adherent_id).set(v.periode, v.total);
  }
  return { params, categories, historiques, paiements, courante: periodeCourante(params) };
}

function categorieA(adh, periode, ctx) {
  const hist = ctx.historiques.get(adh.id) || [];
  let catId = null;
  for (const h of hist) if (h.periode_debut <= periode) catId = h.categorie_id;
  if (catId == null) catId = hist.length ? hist[0].categorie_id : adh.categorie_id;
  return ctx.categories.get(catId) || ctx.categories.get(adh.categorie_id);
}

function bornesAdherent(adh, ctx) {
  const per = ctx.params.periodicite;
  const debutAsso = premierePeriodeAssociation(ctx.params);
  const debutAdh = periodeDe(adh.date_adhesion, per);
  const debut = debutAdh > debutAsso ? debutAdh : debutAsso;
  let fin = ctx.courante;
  if (adh.statut !== 'actif' && adh.date_sortie) {
    const sortie = periodeDe(adh.date_sortie, per);
    if (sortie < fin) fin = sortie;
  }
  return { debut, fin };
}

/**
 * Situation des cotisations normales d'un adhérent, période par période.
 * Les périodes payées d'avance (au-delà de la période courante) sont incluses.
 */
function situationNormale(adh, ctx = contexte()) {
  const { debut, fin } = bornesAdherent(adh, ctx);
  const payes = ctx.paiements.get(adh.id) || new Map();
  const periodes = new Set(listePeriodes(debut, fin));
  for (const p of payes.keys()) if (p) periodes.add(p);

  const lignes = [...periodes].sort().map((p) => {
    const exigible = p >= debut && p <= fin;
    const cat = categorieA(adh, p, ctx);
    const du = exigible && cat ? cat.montant : 0;
    const paye = payes.get(p) || 0;
    const reste = Math.max(du - paye, 0);
    let etat;
    if (!exigible) etat = 'avance';
    else if (du === 0 || paye >= du) etat = 'a_jour';
    else if (paye > 0) etat = 'partiel';
    else etat = 'impaye';
    return { periode: p, categorie: cat ? cat.libelle : '', du, paye, reste, etat };
  });

  const totalDu = lignes.reduce((s, l) => s + l.du, 0);
  const totalPaye = lignes.reduce((s, l) => s + l.paye, 0);
  const reste = lignes.reduce((s, l) => s + l.reste, 0);
  const periodesImpayees = lignes.filter((l) => l.etat === 'impaye' || l.etat === 'partiel').length;
  return { lignes, totalDu, totalPaye, reste, periodesImpayees, aJour: reste === 0 };
}

function situationExceptionnelle(adherentId) {
  return all(
    `SELECT c.id, c.libelle, c.motif, c.date_appel, c.date_echeance, c.cloturee, ca.montant_du AS du,
            COALESCE((SELECT SUM(v.montant) FROM versements v
                      WHERE v.cotisation_exc_id = c.id AND v.adherent_id = ca.adherent_id AND v.annule = 0), 0) AS paye
     FROM cotisation_exc_adherents ca JOIN cotisations_exceptionnelles c ON c.id = ca.cotisation_id
     WHERE ca.adherent_id = ? ORDER BY c.date_appel DESC`,
    adherentId
  ).map((r) => ({ ...r, reste: Math.max(r.du - r.paye, 0) }));
}

function resteDuPeriode(adh, periode, ctx = contexte()) {
  const s = situationNormale(adh, ctx);
  const l = s.lignes.find((x) => x.periode === periode);
  if (l) return l.reste;
  const cat = categorieA(adh, periode, ctx);
  return cat ? cat.montant : 0;
}

/** Situation de tous les adhérents (pour listes, tableau de bord et exports). */
function situationsTous(filtreSql = '', ...p) {
  const ctx = contexte();
  const adherents = all(
    `SELECT a.*, c.libelle AS categorie FROM adherents a JOIN categories c ON c.id = a.categorie_id ${filtreSql}`,
    ...p
  );
  const exc = new Map(
    all(`SELECT ca.adherent_id, SUM(ca.montant_du) AS du,
                SUM(COALESCE((SELECT SUM(v.montant) FROM versements v WHERE v.cotisation_exc_id = ca.cotisation_id
                              AND v.adherent_id = ca.adherent_id AND v.annule = 0), 0)) AS paye
         FROM cotisation_exc_adherents ca GROUP BY ca.adherent_id`).map((r) => [r.adherent_id, r])
  );
  return adherents.map((a) => {
    const s = situationNormale(a, ctx);
    const e = exc.get(a.id) || { du: 0, paye: 0 };
    const resteExc = Math.max(e.du - e.paye, 0);
    return { ...a, situation: s, resteNormal: s.reste, resteExc, resteTotal: s.reste + resteExc };
  });
}

function recouvrementExceptionnelle(cotisationId) {
  const lignes = all(
    `SELECT a.id, a.matricule, a.nom, a.prenoms, a.telephone, ca.montant_du AS du,
            COALESCE((SELECT SUM(v.montant) FROM versements v
                      WHERE v.cotisation_exc_id = ca.cotisation_id AND v.adherent_id = a.id AND v.annule = 0), 0) AS paye
     FROM cotisation_exc_adherents ca JOIN adherents a ON a.id = ca.adherent_id
     WHERE ca.cotisation_id = ? ORDER BY a.nom, a.prenoms`,
    cotisationId
  ).map((r) => ({ ...r, reste: Math.max(r.du - r.paye, 0) }));
  const du = lignes.reduce((s, l) => s + l.du, 0);
  const paye = lignes.reduce((s, l) => s + Math.min(l.paye, l.du), 0);
  return {
    lignes,
    du,
    paye,
    reste: du - paye,
    taux: du ? Math.round((paye / du) * 100) : 0,
    nbPayeurs: lignes.filter((l) => l.reste === 0).length,
  };
}

module.exports = {
  periodeDe, periodeSuivante, listePeriodes, periodeCourante, contexte, categorieA,
  situationNormale, situationExceptionnelle, resteDuPeriode, situationsTous, recouvrementExceptionnelle,
};
