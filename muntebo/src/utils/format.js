const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function nombre(n) {
  const v = Math.round(Number(n) || 0);
  // Espace insécable fine comme séparateur de milliers (lisible et sûr pour PDF/Excel)
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function fcfa(n) {
  return nombre(n) + ' FCFA';
}

function dateFr(iso) {
  if (!iso) return '';
  const [d] = String(iso).split(' ');
  const [y, m, j] = d.split('-');
  if (!j) return iso;
  return `${j}/${m}/${y}`;
}

function dateHeureFr(iso) {
  if (!iso) return '';
  const [d, h] = String(iso).split(' ');
  return dateFr(d) + (h ? ' à ' + h.slice(0, 5) : '');
}

function dateLongue(iso) {
  if (!iso) return '';
  const [y, m, j] = String(iso).split(' ')[0].split('-');
  return `${Number(j)} ${MOIS[Number(m) - 1]} ${y}`;
}

// "2026-11" -> "novembre 2026" ; "2026" -> "Année 2026"
function libellePeriode(p) {
  if (!p) return '';
  const [y, m] = String(p).split('-');
  if (!m) return 'Année ' + y;
  return MOIS[Number(m) - 1] + ' ' + y;
}

function libellePeriodeCourt(p) {
  if (!p) return '';
  const [y, m] = String(p).split('-');
  if (!m) return y;
  return MOIS_COURT[Number(m) - 1] + ' ' + y;
}

function aujourdHui() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

const STATUTS = { actif: 'Actif', suspendu: 'Suspendu', radie: 'Radié' };
const MODES = ['Espèces', 'Mobile Money', 'Virement', 'Chèque'];
const TYPES_REUNION = ['Assemblée générale ordinaire', 'Assemblée générale extraordinaire', 'Réunion de bureau', 'Autre réunion'];

module.exports = {
  MOIS, nombre, fcfa, dateFr, dateHeureFr, dateLongue, libellePeriode, libellePeriodeCourt,
  aujourdHui, STATUTS, MODES, TYPES_REUNION,
};
