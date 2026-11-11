const express = require('express');
const { all, get, run, journaliser } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const categories = all(
    `SELECT c.*, (SELECT COUNT(*) FROM adherents a WHERE a.categorie_id = c.id AND a.statut = 'actif') AS nb_actifs,
            (SELECT COUNT(*) FROM adherents a WHERE a.categorie_id = c.id) AS nb_total
     FROM categories c ORDER BY c.montant`
  );
  const edition = req.query.modifier ? get('SELECT * FROM categories WHERE id = ?', req.query.modifier) : null;
  res.render('categories', { title: 'Catégories et montants', categories, edition, erreur: null });
});

function lire(b) {
  return {
    libelle: String(b.libelle || '').trim(),
    montant: Math.round(Number(String(b.montant || '').replace(/\s/g, ''))),
    description: String(b.description || '').trim(),
  };
}

function valider(c, id) {
  if (!c.libelle) return 'Le libellé est obligatoire.';
  if (!(c.montant >= 0) || Number.isNaN(c.montant)) return 'Le montant est invalide.';
  const dbl = get('SELECT id FROM categories WHERE libelle = ? AND id != ?', c.libelle, id || 0);
  if (dbl) return 'Une catégorie porte déjà ce nom.';
  return null;
}

router.post('/', (req, res) => {
  const c = lire(req.body);
  const err = valider(c);
  if (err) { req.flash('danger', err); return res.redirect('/categories'); }
  const r = run('INSERT INTO categories(libelle, montant, description) VALUES (?,?,?)', c.libelle, c.montant, c.description);
  journaliser(req.user, 'Création catégorie', 'categorie', Number(r.lastInsertRowid), `${c.libelle} — ${c.montant}`);
  req.flash('success', 'Catégorie ajoutée.');
  res.redirect('/categories');
});

router.post('/:id(\\d+)', (req, res) => {
  const ancienne = get('SELECT * FROM categories WHERE id = ?', req.params.id);
  if (!ancienne) return res.redirect('/categories');
  const c = lire(req.body);
  const err = valider(c, ancienne.id);
  if (err) { req.flash('danger', err); return res.redirect(`/categories?modifier=${ancienne.id}`); }
  run('UPDATE categories SET libelle = ?, montant = ?, description = ? WHERE id = ?', c.libelle, c.montant, c.description, ancienne.id);
  journaliser(req.user, 'Modification catégorie', 'categorie', ancienne.id, `${ancienne.libelle} ${ancienne.montant} → ${c.libelle} ${c.montant}`);
  req.flash('success', 'Catégorie modifiée.');
  res.redirect('/categories');
});

router.post('/:id(\\d+)/supprimer', (req, res) => {
  const utilise = get(
    'SELECT (SELECT COUNT(*) FROM adherents WHERE categorie_id = ?) + (SELECT COUNT(*) FROM adherent_categorie_historique WHERE categorie_id = ?) AS n',
    req.params.id, req.params.id
  ).n;
  if (utilise) req.flash('danger', 'Cette catégorie est utilisée par des adhérents et ne peut pas être supprimée.');
  else {
    run('DELETE FROM categories WHERE id = ?', req.params.id);
    journaliser(req.user, 'Suppression catégorie', 'categorie', Number(req.params.id));
    req.flash('success', 'Catégorie supprimée.');
  }
  res.redirect('/categories');
});

module.exports = router;
