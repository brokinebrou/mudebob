const express = require('express');
const { all, get, run, transaction, journaliser } = require('../db');
const { recouvrementExceptionnelle } = require('../services/cotisations');
const { aujourdHui } = require('../utils/format');

const router = express.Router();

router.get('/', (req, res) => {
  const liste = all('SELECT * FROM cotisations_exceptionnelles ORDER BY cloturee, date_appel DESC')
    .map((c) => ({ ...c, rec: recouvrementExceptionnelle(c.id) }));
  res.render('exceptionnelles/liste', { title: 'Cotisations exceptionnelles', liste });
});

router.get('/nouvelle', (req, res) => {
  res.render('exceptionnelles/form', {
    title: 'Nouvelle cotisation exceptionnelle',
    c: { date_appel: aujourdHui(), cible: 'tous' },
    adherents: all("SELECT id, matricule, nom, prenoms FROM adherents WHERE statut = 'actif' ORDER BY nom, prenoms"),
    selection: [],
    erreurs: [],
  });
});

router.post('/', (req, res) => {
  const b = req.body;
  const c = {
    libelle: String(b.libelle || '').trim(),
    motif: String(b.motif || '').trim(),
    montant_par_adherent: Math.round(Number(String(b.montant_par_adherent || '').replace(/\s/g, ''))),
    date_appel: b.date_appel || aujourdHui(),
    date_echeance: b.date_echeance || null,
    cible: b.cible === 'selection' ? 'selection' : 'tous',
  };
  let selection = [].concat(b.adherents || []).map(Number).filter(Boolean);
  const erreurs = [];
  if (!c.libelle) erreurs.push('Le libellé est obligatoire.');
  if (!(c.montant_par_adherent > 0)) erreurs.push('Le montant par adhérent doit être supérieur à zéro.');
  if (c.date_echeance && c.date_echeance < c.date_appel) erreurs.push("L'échéance doit être postérieure à la date d'appel.");
  const actifs = all("SELECT id FROM adherents WHERE statut = 'actif'").map((a) => a.id);
  if (c.cible === 'tous') selection = actifs;
  else selection = selection.filter((id) => actifs.includes(id));
  if (!selection.length) erreurs.push('Sélectionnez au moins un adhérent concerné.');
  if (erreurs.length) {
    return res.status(400).render('exceptionnelles/form', {
      title: 'Nouvelle cotisation exceptionnelle', c, selection, erreurs,
      adherents: all("SELECT id, matricule, nom, prenoms FROM adherents WHERE statut = 'actif' ORDER BY nom, prenoms"),
    });
  }
  const id = transaction(() => {
    const r = run(
      'INSERT INTO cotisations_exceptionnelles(libelle, motif, montant_par_adherent, date_appel, date_echeance, cree_par) VALUES (?,?,?,?,?,?)',
      c.libelle, c.motif, c.montant_par_adherent, c.date_appel, c.date_echeance, req.user.id
    );
    const newId = Number(r.lastInsertRowid);
    for (const aid of selection) run('INSERT INTO cotisation_exc_adherents(cotisation_id, adherent_id, montant_du) VALUES (?,?,?)', newId, aid, c.montant_par_adherent);
    journaliser(req.user, 'Création cotisation exceptionnelle', 'cotisation_exc', newId, `${c.libelle} — ${c.montant_par_adherent} FCFA × ${selection.length}`);
    return newId;
  });
  req.flash('success', `Cotisation « ${c.libelle} » créée pour ${selection.length} adhérent(s).`);
  res.redirect(`/exceptionnelles/${id}`);
});

router.get('/:id(\\d+)', (req, res) => {
  const c = get('SELECT * FROM cotisations_exceptionnelles WHERE id = ?', req.params.id);
  if (!c) return res.status(404).render('erreur', { title: 'Introuvable', code: 404, message: 'Cotisation introuvable.' });
  const rec = recouvrementExceptionnelle(c.id);
  const filtre = req.query.filtre || '';
  let lignes = rec.lignes;
  if (filtre === 'payes') lignes = lignes.filter((l) => l.reste === 0);
  if (filtre === 'non_payes') lignes = lignes.filter((l) => l.reste > 0);
  const nonConcernes = all(
    `SELECT id, matricule, nom, prenoms FROM adherents WHERE statut='actif'
     AND id NOT IN (SELECT adherent_id FROM cotisation_exc_adherents WHERE cotisation_id = ?) ORDER BY nom`, c.id
  );
  res.render('exceptionnelles/detail', { title: c.libelle, c, rec, lignes, filtre, nonConcernes });
});

router.post('/:id(\\d+)/ajouter', (req, res) => {
  const c = get('SELECT * FROM cotisations_exceptionnelles WHERE id = ?', req.params.id);
  const aid = Number(req.body.adherent_id);
  if (c && get("SELECT 1 FROM adherents WHERE id = ? AND statut='actif'", aid)) {
    run('INSERT OR IGNORE INTO cotisation_exc_adherents(cotisation_id, adherent_id, montant_du) VALUES (?,?,?)', c.id, aid, c.montant_par_adherent);
    journaliser(req.user, 'Ajout adhérent à cotisation exceptionnelle', 'cotisation_exc', c.id, `adhérent ${aid}`);
    req.flash('success', 'Adhérent ajouté à la cotisation.');
  }
  res.redirect(`/exceptionnelles/${req.params.id}`);
});

router.post('/:id(\\d+)/retirer', (req, res) => {
  const aid = Number(req.body.adherent_id);
  const paye = get('SELECT COUNT(*) AS n FROM versements WHERE cotisation_exc_id = ? AND adherent_id = ? AND annule = 0', req.params.id, aid).n;
  if (paye) req.flash('danger', 'Impossible de retirer un adhérent qui a déjà versé pour cette cotisation.');
  else {
    run('DELETE FROM cotisation_exc_adherents WHERE cotisation_id = ? AND adherent_id = ?', req.params.id, aid);
    journaliser(req.user, 'Retrait adhérent de cotisation exceptionnelle', 'cotisation_exc', Number(req.params.id), `adhérent ${aid}`);
    req.flash('success', 'Adhérent retiré de la cotisation.');
  }
  res.redirect(`/exceptionnelles/${req.params.id}`);
});

router.post('/:id(\\d+)/cloture', (req, res) => {
  run('UPDATE cotisations_exceptionnelles SET cloturee = CASE cloturee WHEN 1 THEN 0 ELSE 1 END WHERE id = ?', req.params.id);
  journaliser(req.user, 'Clôture/réouverture cotisation exceptionnelle', 'cotisation_exc', Number(req.params.id));
  res.redirect(`/exceptionnelles/${req.params.id}`);
});

router.post('/:id(\\d+)/supprimer', (req, res) => {
  const n = get('SELECT COUNT(*) AS n FROM versements WHERE cotisation_exc_id = ?', req.params.id).n;
  if (n) {
    req.flash('danger', 'Cette cotisation a déjà des versements : clôturez-la plutôt que de la supprimer.');
    return res.redirect(`/exceptionnelles/${req.params.id}`);
  }
  run('DELETE FROM cotisations_exceptionnelles WHERE id = ?', req.params.id);
  journaliser(req.user, 'Suppression cotisation exceptionnelle', 'cotisation_exc', Number(req.params.id));
  req.flash('success', 'Cotisation supprimée.');
  res.redirect('/exceptionnelles');
});

module.exports = router;
