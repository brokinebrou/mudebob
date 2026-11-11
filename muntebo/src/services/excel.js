const ExcelJS = require('exceljs');
const { getParams } = require('../db');

const FCFA = '#,##0 "FCFA"';

/**
 * Envoie un classeur Excel avec une feuille.
 * colonnes : [{ header, key, width, fcfa?: true, date?: true }]
 */
async function envoyerClasseur(res, nomFichier, titre, colonnes, lignes, totaux) {
  const p = getParams();
  const wb = new ExcelJS.Workbook();
  wb.creator = p.nom_association;
  wb.created = new Date();
  const ws = wb.addWorksheet(titre.slice(0, 31));

  ws.mergeCells(1, 1, 1, colonnes.length);
  ws.getCell(1, 1).value = `${p.nom_association} — ${titre}`;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FF0F5132' } };
  ws.mergeCells(2, 1, 2, colonnes.length);
  ws.getCell(2, 1).value = `Édité le ${new Date().toLocaleString('fr-FR')}`;
  ws.getCell(2, 1).font = { italic: true, size: 9, color: { argb: 'FF666666' } };

  const entete = ws.getRow(4);
  colonnes.forEach((c, i) => {
    const cell = entete.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F5132' } };
    cell.alignment = { vertical: 'middle' };
    ws.getColumn(i + 1).width = c.width || 16;
    if (c.fcfa) ws.getColumn(i + 1).numFmt = FCFA;
  });

  lignes.forEach((l, idx) => {
    const row = ws.getRow(5 + idx);
    colonnes.forEach((c, i) => {
      let v = typeof c.key === 'function' ? c.key(l) : l[c.key];
      if (c.date && v) v = new Date(String(v).slice(0, 10) + 'T00:00:00');
      row.getCell(i + 1).value = v == null ? '' : v;
      if (c.date) row.getCell(i + 1).numFmt = 'dd/mm/yyyy';
    });
    if (idx % 2) row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F7F4' } }; });
  });

  if (totaux) {
    const row = ws.getRow(5 + lignes.length + 1);
    colonnes.forEach((c, i) => {
      if (totaux[c.header] !== undefined) row.getCell(i + 1).value = totaux[c.header];
    });
    row.font = { bold: true };
  }

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + lignes.length, column: colonnes.length } };
  ws.views = [{ state: 'frozen', ySplit: 4 }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nomFichier}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

module.exports = { envoyerClasseur };
