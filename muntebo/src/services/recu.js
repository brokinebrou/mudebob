const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { get, getParams } = require('../db');
const f = require('../utils/format');

const VERT = '#1e6b23';
const OR = '#8dc63f';
const LOGO = path.join(__dirname, '..', '..', 'public', 'img', 'logo.jpg');

// Conversion d'un montant en toutes lettres (français)
function enLettres(n) {
  n = Math.floor(Number(n) || 0);
  if (n === 0) return 'zéro';
  const u = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize',
    'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const d = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];
  function cent(x) {
    let s = '';
    const c = Math.floor(x / 100), r = x % 100;
    if (c) s = (c > 1 ? u[c] + ' cent' : 'cent') + (c > 1 && r === 0 ? 's' : '');
    if (r) {
      let t;
      if (r < 20) t = u[r];
      else {
        const di = Math.floor(r / 10), un = r % 10;
        if (di === 7 || di === 9) t = d[di] + (di === 7 && un === 1 ? '-et-' : '-') + u[10 + un];
        else t = d[di] + (un === 1 && di !== 8 ? '-et-un' : un ? '-' + u[un] : (di === 8 ? 's' : ''));
      }
      s += (s ? ' ' : '') + t;
    }
    return s;
  }
  const parts = [];
  const mds = Math.floor(n / 1e9), mns = Math.floor((n % 1e9) / 1e6), mls = Math.floor((n % 1e6) / 1000), rest = n % 1000;
  if (mds) parts.push(cent(mds) + ' milliard' + (mds > 1 ? 's' : ''));
  if (mns) parts.push(cent(mns) + ' million' + (mns > 1 ? 's' : ''));
  if (mls) parts.push(mls === 1 ? 'mille' : cent(mls).replace(/(cent|vingt)s$/, '$1') + ' mille');
  if (rest) parts.push(cent(rest));
  return parts.join(' ');
}

function chargerVersement(id) {
  return get(
    `SELECT v.*, a.matricule, a.nom, a.prenoms, a.telephone, c.libelle AS exc_libelle, u.nom_complet AS saisi_par_nom, u.identifiant AS saisi_par_id
     FROM versements v JOIN adherents a ON a.id = v.adherent_id
     LEFT JOIN cotisations_exceptionnelles c ON c.id = v.cotisation_exc_id
     LEFT JOIN utilisateurs u ON u.id = v.saisi_par WHERE v.id = ?`,
    id
  );
}

function genererRecu(v, res) {
  const p = getParams();
  const doc = new PDFDocument({ size: 'A5', layout: 'landscape', margins: { top: 36, left: 36, right: 36, bottom: 0 }, info: { Title: 'Reçu ' + v.numero_recu, Author: p.nom_association } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="recu-${v.numero_recu}.pdf"`);
  doc.pipe(res);

  const W = doc.page.width, H = doc.page.height;
  doc.rect(0, 0, W, 78).fill(VERT);
  doc.rect(0, 78, W, 4).fill(OR);
  // Logo dans un cartouche clair (le fond du logo est gris très clair)
  doc.roundedRect(24, 8, 108, 62, 6).fill('#f5f5f5');
  if (fs.existsSync(LOGO)) doc.image(LOGO, 28, 11, { fit: [100, 56], align: 'center', valign: 'center' });
  const X = 146;
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(20).text(p.nom_association.toUpperCase(), X, 16, { width: 230, lineBreak: false });
  doc.font('Helvetica').fontSize(9).text(p.slogan || '', X, 40, { width: 230 });
  const coord = [p.adresse, p.telephone, p.email].filter(Boolean).join('  •  ');
  if (coord) doc.fontSize(8).text(coord, X, 54, { width: 260 });
  doc.font('Helvetica-Bold').fontSize(15).text('REÇU DE VERSEMENT', 0, 20, { align: 'right', width: W - 36 });
  doc.font('Helvetica').fontSize(10).text('N° ' + v.numero_recu, 0, 42, { align: 'right', width: W - 36 });

  let y = 98;
  const ligne = (lib, val) => {
    doc.fillColor('#555').font('Helvetica').fontSize(10).text(lib, 36, y, { width: 150 });
    doc.fillColor('#111').font('Helvetica-Bold').text(val || '—', 190, y, { width: W - 226 });
    y += 20;
  };
  ligne('Date du versement', f.dateLongue(v.date_versement));
  ligne('Reçu de', `${v.nom} ${v.prenoms}   (Matricule ${v.matricule})`);
  ligne('Objet', v.type === 'normale' ? `Cotisation normale — ${f.libellePeriode(v.periode)}` : `Cotisation exceptionnelle — ${v.exc_libelle || ''}`);
  ligne('Mode de paiement', v.mode + (v.reference ? `  (réf. ${v.reference})` : ''));

  y += 6;
  doc.roundedRect(36, y, W - 72, 52, 6).lineWidth(1).strokeColor(OR).stroke();
  doc.fillColor(VERT).font('Helvetica-Bold').fontSize(20).text(f.fcfa(v.montant), 50, y + 8);
  const lettres = enLettres(v.montant);
  doc.fillColor('#333').font('Helvetica-Oblique').fontSize(9)
    .text(`Arrêté le présent reçu à la somme de : ${lettres.charAt(0).toUpperCase() + lettres.slice(1)} francs CFA`, 50, y + 34, { width: W - 100 });
  y += 70;

  if (v.annule) {
    doc.save().rotate(-20, { origin: [W / 2, H / 2] }).fillColor('#dc3545').opacity(0.35).font('Helvetica-Bold').fontSize(70)
      .text('ANNULÉ', 0, H / 2 - 40, { align: 'center', width: W }).restore();
    doc.opacity(1).fillColor('#dc3545').font('Helvetica').fontSize(9).text('Motif d’annulation : ' + (v.motif_annulation || ''), 36, y);
  }

  doc.fillColor('#555').font('Helvetica').fontSize(9).text('Enregistré par : ' + (v.saisi_par_nom || v.saisi_par_id || ''), 36, H - 70);
  doc.text('Le Trésorier' + (p.tresorier ? ' : ' + p.tresorier : ''), W - 236, H - 90, { width: 200, align: 'center' });
  doc.moveTo(W - 216, H - 50).lineTo(W - 56, H - 50).strokeColor('#999').lineWidth(0.5).stroke();
  const maintenant = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).replace(' ', ' à ');
  doc.fontSize(7).fillColor('#999').text(`Édité le ${maintenant} — ${p.nom_association}`, 36, H - 30, { lineBreak: false });
  doc.end();
}

module.exports = { genererRecu, chargerVersement, enLettres };
