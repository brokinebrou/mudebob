const { all, getParams } = require('../db');

// Format MUDEBO : PREFIXE-MM-AA-NNNNN (mois et année d'adhésion, numéro d'ordre global)
// ex. MU-09-25-00004

function numeroDe(matricule) {
  const m = String(matricule || '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

function dernierNumero() {
  return all('SELECT matricule FROM adherents').reduce((max, r) => Math.max(max, numeroDe(r.matricule)), 0);
}

function formaterMatricule(numero, dateAdhesion, prefixe = getParams().prefixe_matricule || 'MU') {
  const d = String(dateAdhesion || '').match(/^(\d{4})-(\d{2})/);
  const mm = d ? d[2] : String(new Date().getMonth() + 1).padStart(2, '0');
  const aa = d ? d[1].slice(2) : String(new Date().getFullYear()).slice(2);
  return `${prefixe}-${mm}-${aa}-${String(numero).padStart(5, '0')}`;
}

function genererMatricule(dateAdhesion) {
  return formaterMatricule(dernierNumero() + 1, dateAdhesion);
}

// Date d'adhésion déduite d'un matricule MU-MM-AA-NNNNN (1er jour du mois)
function dateAdhesionDepuisMatricule(matricule) {
  const m = String(matricule || '').match(/^[A-Z]+-(\d{2})-(\d{2})-\d+$/i);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return null;
  return `20${m[2]}-${m[1]}-01`;
}

module.exports = { genererMatricule, formaterMatricule, dernierNumero, numeroDe, dateAdhesionDepuisMatricule };
