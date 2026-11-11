/* Charge des données fictives pour tester Muntebo : npm run demo
   N'agit que si la base ne contient encore aucun adhérent. */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { get, run, transaction, setParam, UPLOAD_DIR } = require('../src/db');

if (get('SELECT COUNT(*) AS n FROM adherents').n > 0) {
  console.log('La base contient déjà des adhérents : données de démonstration non chargées.');
  process.exit(0);
}

const annee = new Date().getFullYear();
const moisCourant = new Date().getMonth() + 1;
setParam('annee_demarrage', String(annee));
setParam('periodicite', 'mensuelle');
setParam('adresse', 'Abidjan, Cocody');
setParam('telephone', '+225 07 00 00 00 00');
setParam('tresorier', 'M. KOFFI Jean');

const cats = {};
for (const c of [['Membre actif', 5000], ['Membre bienfaiteur', 15000], ['Étudiant', 2000]]) {
  cats[c[0]] = (get('SELECT id FROM categories WHERE libelle = ?', c[0]) || {}).id;
}

const personnes = [
  ['KOUASSI', 'Aya Marie', 'F', 'Membre actif', 'Enseignante'],
  ['KONAN', 'Yao Serge', 'M', 'Membre bienfaiteur', 'Commerçant'],
  ['TRAORÉ', 'Awa', 'F', 'Membre actif', 'Infirmière'],
  ['N’GUESSAN', 'Kouadio Paul', 'M', 'Étudiant', 'Étudiant'],
  ['DIABATÉ', 'Moussa', 'M', 'Membre actif', 'Comptable'],
  ['BAMBA', 'Fatou', 'F', 'Membre bienfaiteur', 'Médecin'],
  ['YAO', 'Akissi Christelle', 'F', 'Membre actif', 'Couturière'],
  ['OUATTARA', 'Ibrahim', 'M', 'Étudiant', 'Étudiant'],
  ['KOFFI', 'Jean', 'M', 'Membre actif', 'Ingénieur'],
  ['AKA', 'Bénédicte', 'F', 'Membre actif', 'Secrétaire'],
];
const modes = ['Espèces', 'Mobile Money', 'Mobile Money', 'Virement'];
const z = (n) => String(n).padStart(2, '0');
let recu = 0;
const ids = [];

transaction(() => {
  personnes.forEach((p, i) => {
    const mat = `MU-01-${String(annee).slice(2)}-${String(i + 1).padStart(5, '0')}`;
    const cat = cats[p[3]];
    const adh = `${annee}-01-${z(1 + i)}`;
    const r = run(
      `INSERT INTO adherents(matricule, nom, prenoms, sexe, telephone, profession, categorie_id, date_adhesion, adresse)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      mat, p[0], p[1], p[2], `+225 07 ${z(10 + i)} ${z(20 + i)} ${z(30 + i)} ${z(40 + i)}`, p[4], cat, adh, 'Abidjan'
    );
    const id = Number(r.lastInsertRowid);
    ids.push(id);
    run('INSERT INTO adherent_categorie_historique(adherent_id, categorie_id, periode_debut) VALUES (?,?,?)', id, cat, '0000');
    const montant = get('SELECT montant FROM categories WHERE id = ?', cat).montant;
    // Chaque adhérent a payé un nombre variable de mois (certains en retard, un partiel)
    const moisPayes = Math.max(0, moisCourant - (i % 4));
    for (let m = 1; m <= moisPayes; m++) {
      const partiel = i === 4 && m === moisPayes;
      recu++;
      run(
        `INSERT INTO versements(numero_recu, adherent_id, type, periode, montant, date_versement, mode, saisi_par)
         VALUES (?,?,?,?,?,?,?,1)`,
        `REC-${annee}-${String(recu).padStart(5, '0')}`, id, 'normale', `${annee}-${z(m)}`,
        partiel ? Math.round(montant / 2) : montant, `${annee}-${z(m)}-${z(Math.min(5 + i, 28))}`, modes[(i + m) % modes.length]
      );
    }
  });

  // Une cotisation exceptionnelle
  const dateAppel = `${annee}-${z(Math.max(1, moisCourant - 1))}-10`;
  const c = run(
    `INSERT INTO cotisations_exceptionnelles(libelle, motif, montant_par_adherent, date_appel, date_echeance, cree_par)
     VALUES ('Soutien à la famille d’un membre', 'Assistance suite au décès du père de M. BAMBA', 10000, ?, ?, 1)`,
    dateAppel, `${annee}-12-31`
  );
  const cid = Number(c.lastInsertRowid);
  ids.forEach((aid, i) => {
    run('INSERT INTO cotisation_exc_adherents(cotisation_id, adherent_id, montant_du) VALUES (?,?,10000)', cid, aid);
    if (i % 3 !== 2) {
      recu++;
      run(
        `INSERT INTO versements(numero_recu, adherent_id, type, cotisation_exc_id, montant, date_versement, mode, saisi_par)
         VALUES (?,?,?,?,?,?,?,1)`,
        `REC-${annee}-${String(recu).padStart(5, '0')}`, aid, 'exceptionnelle', cid, i === 0 ? 5000 : 10000, dateAppel, 'Mobile Money'
      );
    }
  });

  // Un compte adhérent de démonstration
  run(
    `INSERT INTO utilisateurs(identifiant, nom_complet, mot_de_passe_hash, role, adherent_id, doit_changer_mdp)
     VALUES ('demo.adherent', 'Aya Marie KOUASSI', ?, 'adherent', ?, 0)`,
    bcrypt.hashSync('adherent2026', 10), ids[0]
  );

  // Un PV de démonstration (petit PDF généré)
  const nom = `demo-pv-${Date.now()}.pdf`;
  const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj ' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj ' +
    '4 0 obj<</Length 88>>stream\nBT /F1 18 Tf 72 760 Td (PV - Assemblee generale ordinaire) Tj 0 -30 Td (Document de demonstration) Tj ET\nendstream endobj ' +
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
  fs.writeFileSync(path.join(UPLOAD_DIR, nom), pdf);
  run(
    `INSERT INTO pv_reunions(titre, type_reunion, date_reunion, lieu, resume, fichier, nom_original, mime, taille, visible_adherents, depose_par)
     VALUES (?,?,?,?,?,?,?,?,?,1,1)`,
    `PV de l'Assemblée générale ordinaire ${annee}`, 'Assemblée générale ordinaire', `${annee}-01-20`, 'Siège de l’association',
    'Adoption du budget annuel, fixation des cotisations par catégorie, élection du bureau.', nom, `PV-AGO-${annee}.pdf`, 'application/pdf', pdf.length
  );
});

console.log('Données de démonstration chargées : 10 adhérents, versements, 1 cotisation exceptionnelle, 1 PV.');
console.log('Compte adhérent de test : demo.adherent / adherent2026');
