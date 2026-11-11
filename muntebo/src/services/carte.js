/* Carte de membre MUDEBO (format carte bancaire CR80 : 85,6 × 54 mm).
   Le fond (assets/carte-fond.jpg) contient déjà le logo, le titre et le bandeau vert ;
   on y place la photo, les informations, le QR code, la signature et le contact.
   Les positions sont exprimées en fraction de la carte (relevées sur le modèle PDF). */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { getParams, PHOTO_DIR, DATA_DIR } = require('../db');

const FOND = path.join(__dirname, '..', '..', 'assets', 'carte-fond.jpg');
const MM = 72 / 25.4;
const W = 85.6 * MM; // 242,65 pt
const H = 54 * MM;   // 153,07 pt
const ROUGE = '#7d1414';
const VERT = '#2ba337';

// ---- Signature du président (gérée dans Paramètres) ---------------------------
const SIGNATURE_EXT = ['.png', '.jpg'];
function cheminSignature() {
  for (const ext of SIGNATURE_EXT) {
    const p = path.join(DATA_DIR, 'signature' + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const SEXES = { M: 'Masculin', F: 'Féminin' };
const maj = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
const nomCourt = (s) => String(s || '').toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

// Écrit un texte sur une ligne, en réduisant la police s'il est trop long
function texteAjuste(doc, txt, x, yCentre, largeurMax, taille, min = 4) {
  doc.fontSize(taille);
  while (taille > min && doc.widthOfString(txt) > largeurMax) doc.fontSize((taille -= 0.25));
  doc.text(txt, x, yCentre - taille * 0.5, { lineBreak: false, width: largeurMax + 20 });
}

function photoUtilisable(nom) {
  if (!nom) return null;
  const p = path.join(PHOTO_DIR, path.basename(nom));
  // PDFKit ne lit que le JPEG et le PNG (une photo WEBP est remplacée par un cadre vide)
  if (!/\.(jpe?g|png)$/i.test(p) || !fs.existsSync(p)) return null;
  return p;
}

function dessinerQr(doc, texte, x, y, taille) {
  const qr = QRCode.create(texte, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const marge = taille * 0.04;
  const m = (taille - 2 * marge) / n;
  doc.save().rect(x, y, taille, taille).fill('#ffffff');
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.modules.get(r, c)) doc.rect(x + marge + c * m, y + marge + r * m, m + 0.02, m + 0.02);
  doc.fill('#000000').restore();
}

function dessinerCarte(doc, a, x0, y0, ctx) {
  const X = (f) => x0 + f * W;
  const Y = (f) => y0 + f * H;
  doc.save();
  doc.rect(x0, y0, W, H).clip();
  doc.image(FOND, x0, y0, { width: W, height: H });

  // Photo (dans le cadre prévu sur le fond)
  const px = X(0.0289), py = Y(0.2931), pw = 0.2032 * W, ph = 0.4075 * H;
  const photo = photoUtilisable(a.photo);
  if (photo) {
    doc.save().rect(px, py, pw, ph).clip();
    try { doc.image(photo, px, py, { cover: [pw, ph], align: 'center', valign: 'center' }); } catch { /* image illisible */ }
    doc.restore();
  } else {
    doc.save().rect(px, py, pw, ph).fill('#f4f6f4').restore();
    doc.font('Helvetica').fontSize(4.5).fillColor('#9aa59a').text('PHOTO', px, py + ph / 2 - 2.5, { width: pw, align: 'center', lineBreak: false });
  }
  doc.save().lineWidth(0.6).rect(px, py, pw, ph).stroke(VERT).restore();

  // Informations
  const lignes = [
    ['Nom', maj(a.nom), 0.414, 6.6],
    ['Prénoms', maj(a.prenoms), 0.507, 6.6],
    ['Sexe', SEXES[a.sexe] || '', 0.594, 6.6],
    ['Résidence', maj(a.adresse), 0.673, 6.6],
    ['Numéro', a.matricule, 0.762, 7.8],
  ];
  const xLib = X(0.268), xVal = X(0.447), largeurVal = X(0.828) - xVal;
  for (const [lib, val, yf, taille] of lignes) {
    doc.font('Helvetica-Bold').fillColor(ROUGE);
    texteAjuste(doc, lib, xLib, Y(yf), xVal - xLib - 3, 6.9);
    doc.font('Helvetica-Bold').fillColor('#111111');
    if (val) texteAjuste(doc, val, xVal, Y(yf), largeurVal, taille);
  }

  // QR code : identité du membre
  dessinerQr(doc, `${ctx.nomAsso} - Carte de membre\nN° ${a.matricule}\n${maj(a.nom)} ${maj(a.prenoms)}`, X(0.837), Y(0.427), 0.125 * W);

  // Le Président + signature
  doc.font('Helvetica-Bold').fontSize(5.3).fillColor('#111111')
    .text('Le Président', X(0.78), Y(0.694) - 2.9, { width: 0.205 * W, align: 'center', lineBreak: false, characterSpacing: 0.15 });
  if (ctx.signature) {
    const sx = X(0.779), sy = Y(0.738), sw = 0.203 * W, sh = 0.111 * H;
    doc.save().rect(sx, sy, sw, sh).fill('#ffffff').restore();
    try { doc.image(ctx.signature, sx + 1, sy + 1, { fit: [sw - 2, sh - 2], align: 'center', valign: 'center' }); } catch { /* ignorée */ }
  }

  // Bandeau : contact
  if (ctx.contact) {
    doc.font('Helvetica-Bold').fontSize(7.4).fillColor('#ffffff')
      .text(`Contact ${nomCourt(ctx.nomAsso)}      ${ctx.contact}`, x0, Y(0.94) - 3.8, { width: W * 0.94, align: 'center', lineBreak: false });
  }
  doc.restore();
}

function contexte() {
  const p = getParams();
  return { nomAsso: p.nom_association || 'MUDEBO', contact: (p.telephone || '').trim(), signature: cheminSignature() };
}

function envoyerPdf(res, doc, nomFichier, telecharger) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${telecharger ? 'attachment' : 'inline'}; filename="${nomFichier}"`);
  doc.pipe(res);
  doc.end();
}

// Une carte = une page au format carte (imprimante à cartes ou découpe)
function genererCarte(a, res, telecharger = false) {
  const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `Carte de membre ${a.matricule}` } });
  dessinerCarte(doc, a, 0, 0, contexte());
  envoyerPdf(res, doc, `carte-${a.matricule}.pdf`, telecharger);
}

// Planche A4 : 10 cartes par page (2 × 5) avec traits de coupe
function genererPlanche(adherents, res) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: 'Cartes de membre' } });
  const ctx = contexte();
  const PW = 595.28, PH = 841.89, COLS = 2, ROWS = 5;
  const mx = (PW - COLS * W) / 2, my = (PH - ROWS * H) / 2;
  adherents.forEach((a, i) => {
    const k = i % (COLS * ROWS);
    if (k === 0) {
      doc.addPage();
      // traits de coupe dans les marges
      doc.save().lineWidth(0.3).strokeColor('#999999');
      for (let c = 0; c <= COLS; c++) { const x = mx + c * W; doc.moveTo(x, my - 14).lineTo(x, my - 4).moveTo(x, PH - my + 4).lineTo(x, PH - my + 14); }
      for (let r = 0; r <= ROWS; r++) { const y = my + r * H; doc.moveTo(mx - 14, y).lineTo(mx - 4, y).moveTo(PW - mx + 4, y).lineTo(PW - mx + 14, y); }
      doc.stroke().restore();
    }
    dessinerCarte(doc, a, mx + (k % COLS) * W, my + Math.floor(k / COLS) * H, ctx);
  });
  envoyerPdf(res, doc, 'cartes-membres.pdf', false);
}

module.exports = { genererCarte, genererPlanche, cheminSignature, SIGNATURE_EXT };
