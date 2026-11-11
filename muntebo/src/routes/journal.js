const express = require('express');
const { all } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const lignes = q
    ? all('SELECT * FROM journal WHERE action LIKE ? OR utilisateur LIKE ? OR details LIKE ? ORDER BY id DESC LIMIT 500', `%${q}%`, `%${q}%`, `%${q}%`)
    : all('SELECT * FROM journal ORDER BY id DESC LIMIT 500');
  res.render('journal', { title: "Journal d'activité", lignes, q });
});

module.exports = router;
