// Test de bout en bout : démarre Muntebo sur une base temporaire et parcourt les fonctions principales.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'muntebo-test-'));
process.env.MUNTEBO_DATA = dataDir;
process.env.SESSION_SECRET = 'test';
const app = require('../server');
require('../scripts/demo');

let server, base;
before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
after(() => { server.close(); require('../src/db').db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

// Petit client HTTP avec cookie de session
function client() {
  let cookie = '';
  async function req(method, url, body, opts = {}) {
    const headers = { cookie, ...(opts.headers || {}) };
    let payload = body;
    if (body && !(body instanceof FormData)) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(body).toString();
    }
    const r = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return r;
  }
  return {
    get: (u) => req('GET', u),
    post: (u, b) => req('POST', u, b),
    async csrf(u = '/login') {
      const html = await (await req('GET', u)).text();
      const m = html.match(/name="_csrf" value="([^"]+)"/);
      return m && m[1];
    },
  };
}

const admin = client();
const adherent = client();
let adherentId, versementId;

test('connexion admin + changement de mot de passe obligatoire', async () => {
  let t = await admin.csrf();
  let r = await admin.post('/login', { _csrf: t, identifiant: 'admin', mot_de_passe: 'mauvais' });
  assert.equal(r.status, 401);
  t = await admin.csrf();
  r = await admin.post('/login', { _csrf: t, identifiant: 'admin', mot_de_passe: 'muntebo2026' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/mot-de-passe');
  r = await admin.get('/tableau-de-bord');
  assert.equal(r.headers.get('location'), '/mot-de-passe');
  t = await admin.csrf('/mot-de-passe');
  r = await admin.post('/mot-de-passe', { _csrf: t, actuel: 'muntebo2026', nouveau: 'Nouveau2026', confirmation: 'Nouveau2026' });
  assert.equal(r.status, 302);
});

test('formulaire sans jeton CSRF refusé', async () => {
  const r = await admin.post('/categories', { libelle: 'X', montant: '1' });
  assert.equal(r.status, 403);
});

test('toutes les pages admin s’affichent', async () => {
  for (const u of ['/tableau-de-bord', '/adherents', '/adherents/nouveau', '/adherents/1', '/versements', '/versements/nouveau',
    '/versements/nouveau?adherent=1', '/exceptionnelles', '/exceptionnelles/nouvelle', '/exceptionnelles/1', '/pv', '/pv/nouveau', '/pv/1',
    '/categories', '/parametres', '/utilisateurs', '/exports', '/journal', '/adherents?situation=retard', '/versements?etat=tous']) {
    const r = await admin.get(u);
    assert.equal(r.status, 200, `${u} → ${r.status}`);
  }
});

test('créer un adhérent', async () => {
  const t = await admin.csrf('/adherents/nouveau');
  const r = await admin.post('/adherents', {
    _csrf: t, nom: 'Test', prenoms: 'Adhérent', sexe: 'F', telephone: '+225 01 02 03 04', categorie_id: '1', date_adhesion: new Date().toISOString().slice(0, 10),
  });
  assert.equal(r.status, 302);
  adherentId = Number(r.headers.get('location').split('/').pop());
  const html = await (await admin.get(`/adherents/${adherentId}`)).text();
  assert.match(html, /TEST Adhérent/);
  assert.match(html, /MU-\d{2}-\d{2}-00011/);
  assert.match(html, /5 000 FCFA/); // reste dû = 1 mois de Membre actif
});

// PNG 1×1 valide
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('naissance, famille et photo : création, modification, contrôles', async () => {
  let t = await admin.csrf('/adherents/nouveau');
  let fd = new FormData();
  for (const [k, v] of Object.entries({ _csrf: t, nom: 'Kouadio', prenoms: 'Affoué', categorie_id: '1', date_adhesion: '2026-01-01',
    lieu_naissance: 'Boniankro', famille: 'Famille N’Dri', nom_pere: 'KOUADIO Konan', nom_mere: 'AMOIN Akissi' })) fd.set(k, v);
  fd.set('photo', new Blob([PNG], { type: 'image/png' }), 'photo.png');
  let r = await admin.post('/adherents', fd);
  assert.equal(r.status, 302);
  const id = r.headers.get('location').split('/').pop();
  const html = await (await admin.get(`/adherents/${id}`)).text();
  for (const s of ['Boniankro', 'Famille N’Dri', 'KOUADIO Konan', 'AMOIN Akissi', `/adherents/${id}/photo`]) assert.ok(html.includes(s), s);
  r = await admin.get(`/adherents/${id}/photo`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');

  // Faux fichier image refusé, l'ancienne photo est conservée
  t = await admin.csrf(`/adherents/${id}/modifier`);
  fd = new FormData();
  for (const [k, v] of Object.entries({ _csrf: t, nom: 'Kouadio', prenoms: 'Affoué', categorie_id: '1', date_adhesion: '2026-01-01' })) fd.set(k, v);
  fd.set('photo', new Blob(['MZ pas une image'], { type: 'image/jpeg' }), 'x.jpg');
  r = await admin.post(`/adherents/${id}`, fd);
  assert.equal(r.status, 400);
  assert.equal((await admin.get(`/adherents/${id}/photo`)).status, 200);

  // Retrait de la photo
  fd.delete('photo');
  fd.set('retirer_photo', '1');
  r = await admin.post(`/adherents/${id}`, fd);
  assert.equal(r.status, 302);
  assert.equal((await admin.get(`/adherents/${id}/photo`)).status, 404);

  // Sans jeton CSRF : refusé
  const sans = new FormData();
  sans.set('nom', 'X'); sans.set('prenoms', 'Y'); sans.set('categorie_id', '1');
  assert.equal((await admin.post('/adherents', sans)).status, 403);
});

test('enregistrer un versement partiel puis complet', async () => {
  const periode = new Date().toISOString().slice(0, 7);
  let t = await admin.csrf(`/versements/nouveau?adherent=${adherentId}`);
  let r = await admin.post('/versements', { _csrf: t, adherent_id: adherentId, type: 'normale', periode, montant: '2000', date_versement: new Date().toISOString().slice(0, 10), mode: 'Espèces' });
  assert.equal(r.status, 302);
  versementId = Number(r.headers.get('location').split('/').pop());
  let html = await (await admin.get(`/adherents/${adherentId}`)).text();
  assert.match(html, /Partiel/);
  t = await admin.csrf(`/versements/nouveau?adherent=${adherentId}`);
  r = await admin.post('/versements', { _csrf: t, adherent_id: adherentId, type: 'normale', periode, montant: '3000', date_versement: new Date().toISOString().slice(0, 10), mode: 'Mobile Money' });
  assert.equal(r.status, 302);
  html = await (await admin.get(`/adherents?q=00011`)).text();
  assert.match(html, /À jour/);
});

test('montant invalide refusé', async () => {
  const t = await admin.csrf(`/versements/nouveau?adherent=${adherentId}`);
  const r = await admin.post('/versements', { _csrf: t, adherent_id: adherentId, type: 'normale', periode: '2026-01', montant: '-5', mode: 'Espèces' });
  assert.equal(r.status, 400);
});

test('reçu PDF', async () => {
  const r = await admin.get(`/versements/${versementId}/recu.pdf`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
});

test('annulation d’un versement', async () => {
  const t = await admin.csrf(`/versements/${versementId}`);
  const r = await admin.post(`/versements/${versementId}/annuler`, { _csrf: t, motif: 'Erreur de saisie' });
  assert.equal(r.status, 302);
  const html = await (await admin.get(`/adherents/${adherentId}`)).text();
  assert.match(html, /Partiel/); // 3000 sur 5000 restent
  const j = await (await admin.get('/journal')).text();
  assert.match(j, /Annulation versement/);
});

test('cotisation exceptionnelle', async () => {
  const t = await admin.csrf('/exceptionnelles/nouvelle');
  const r = await admin.post('/exceptionnelles', { _csrf: t, libelle: 'Fête annuelle', montant_par_adherent: '3000', cible: 'tous', date_appel: new Date().toISOString().slice(0, 10) });
  assert.equal(r.status, 302);
  const html = await (await admin.get(r.headers.get('location'))).text();
  assert.match(html, /Fête annuelle/);
  assert.match(html, /0 %/);
});

test('exports Excel', async () => {
  for (const u of ['/exports/adherents.xlsx', '/exports/versements.xlsx', '/exports/impayes.xlsx', '/exports/exceptionnelle/1.xlsx']) {
    const r = await admin.get(u);
    assert.equal(r.status, 200, u);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.subarray(0, 2).toString(), 'PK', u);
  }
});

test('dépôt de PV : fichier valide accepté, faux PDF refusé', async () => {
  const t = await admin.csrf('/pv/nouveau');
  const fd = (contenu) => {
    const f = new FormData();
    f.set('_csrf', t); f.set('titre', 'PV bureau'); f.set('type_reunion', 'Réunion de bureau'); f.set('date_reunion', '2026-03-01');
    f.set('fichier', new Blob([contenu], { type: 'application/pdf' }), 'pv.pdf');
    return f;
  };
  let r = await admin.post('/pv', fd('MZ pas un pdf'));
  assert.equal(r.status, 400);
  r = await admin.post('/pv', fd('%PDF-1.4 contenu'));
  assert.equal(r.status, 302);
  const id = r.headers.get('location').split('/').pop();
  r = await admin.get(`/pv/${id}/fichier`);
  assert.equal(r.status, 200);
  // Non visible par les adhérents (case non cochée)
  globalThis.pvPrive = id;
});

test('espace adhérent : accès limité à ses propres données', async () => {
  const t = await adherent.csrf();
  let r = await adherent.post('/login', { _csrf: t, identifiant: 'demo.adherent', mot_de_passe: 'adherent2026' });
  assert.equal(r.status, 302);
  r = await adherent.get('/portail');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /KOUASSI/);
  for (const u of ['/adherents', '/tableau-de-bord', '/versements/1', '/exports/adherents.xlsx', '/pv/nouveau', '/adherents/2/photo']) {
    r = await adherent.get(u);
    assert.equal(r.status, 403, u);
  }
  // reçu d'un autre adhérent
  r = await adherent.get(`/portail/recu/${versementId}.pdf`);
  assert.equal(r.status, 403);
  // son propre reçu
  const m = html.match(/\/portail\/recu\/(\d+)\.pdf/);
  r = await adherent.get(`/portail/recu/${m[1]}.pdf`);
  assert.equal(r.status, 200);
  // PV publié visible, PV privé invisible
  assert.equal((await adherent.get('/pv/1')).status, 200);
  assert.equal((await adherent.get(`/pv/${globalThis.pvPrive}`)).status, 404);
  assert.equal((await adherent.get(`/pv/${globalThis.pvPrive}/fichier`)).status, 404);
  // sa carte de membre oui, celle d'un autre non
  r = await adherent.get('/portail/carte.pdf');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal((await adherent.get(`/adherents/${adherentId}/carte.pdf`)).status, 403);
  assert.equal((await adherent.get('/adherents/cartes.pdf')).status, 403);
});

test('cartes de membre : carte seule, planche A4, signature', async () => {
  const pdf = async (u) => {
    const r = await admin.get(u);
    assert.equal(r.status, 200, u);
    assert.equal(r.headers.get('content-type'), 'application/pdf', u);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.subarray(0, 4).toString(), '%PDF', u);
    return buf.toString('latin1');
  };
  // Carte seule : 1 page au format carte (85,6 × 54 mm)
  let s = await pdf(`/adherents/${adherentId}/carte.pdf`);
  assert.match(s, /\/MediaBox \[0 0 242\.6\d* 153\.0\d*\]/);
  // Bouton sur la fiche et sur la liste
  assert.match(await (await admin.get(`/adherents/${adherentId}`)).text(), /carte\.pdf/);
  assert.match(await (await admin.get('/adherents')).text(), /\/adherents\/cartes\.pdf\?/);
  // Planche A4 : 12 adhérents -> 2 pages
  s = await pdf('/adherents/cartes.pdf');
  assert.equal((s.match(/\/Type \/Page\b/g) || []).length, 2);
  // Filtre sans résultat -> retour à la liste
  const r = await admin.get('/adherents/cartes.pdf?q=introuvable-xyz');
  assert.equal(r.status, 302);
  // Signature : faux fichier refusé, PNG accepté, puis retirée
  let t = await admin.csrf('/parametres');
  let fd = new FormData();
  fd.set('_csrf', t); fd.set('signature', new Blob(['pas une image'], { type: 'image/png' }), 's.png');
  await admin.post('/parametres/signature', fd);
  assert.equal((await admin.get('/parametres/signature')).status, 404);
  fd = new FormData();
  fd.set('_csrf', t); fd.set('signature', new Blob([PNG], { type: 'image/png' }), 's.png');
  assert.equal((await admin.post('/parametres/signature', fd)).status, 302);
  assert.equal((await admin.get('/parametres/signature')).status, 200);
  await pdf(`/adherents/${adherentId}/carte.pdf`);
  t = await admin.csrf('/parametres');
  await admin.post('/parametres/signature/supprimer', { _csrf: t });
  assert.equal((await admin.get('/parametres/signature')).status, 404);
});

test('blocage après 5 échecs de connexion', async () => {
  const c = client();
  let r;
  for (let i = 0; i < 5; i++) {
    const t = await c.csrf();
    r = await c.post('/login', { _csrf: t, identifiant: 'demo.adherent', mot_de_passe: 'faux' });
  }
  const html = await r.text();
  assert.match(html, /bloqué/);
});

// ---- Import d'adhérents (placé en dernier : le mode « remplacer » vide la base) ----
function fichierImport(contenu, nom, type) {
  return new Blob([contenu], { type });
}

test('import CSV (Windows-1252, point-virgule) : aperçu puis ajout', async () => {
  const csv = 'Mat.;Nom;Prénoms;Sexe;Né le;Lieu;Profession;Tel;Résidence;Famille\r\n' +
    'MU-09-25-00904;KONAN;YAO DÉSIRÉ;Masculin;10/10/1975;;COMPTABLE;07 59 77 37 15;BINGERVILLE ;YOBOUET\r\n' +
    "MU-04-26-00937;N'GUESSAN;KONAN ALAIN;Masculin;03/11/1979;07 08 00 44 45;RH;07 08 00 44 45;COCODY;YOBOUE\r\n" +
    'MU-08-26-00962;YAO;AYA;Féminin;31/02/1957;;MENAGERE;00 00 00 00 00;SINFRA;BIZA\r\n' +
    'MU-08-26-00963;SANS;;Féminin;01/01/1990;;;;;\r\n';
  const latin1 = Buffer.from(csv, 'latin1');
  let t = await admin.csrf('/adherents/importer');
  const fd = new FormData();
  fd.set('_csrf', t); fd.set('categorie_id', '1'); fd.set('remplacer', '0'); fd.set('date_adhesion', '2026-01-01');
  fd.set('fichier', fichierImport(latin1, 'liste.csv', 'text/csv'), 'liste.csv');
  let r = await admin.post('/adherents/importer', fd);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /YAO DÉSIRÉ/); // accents Windows-1252 correctement décodés
  assert.match(html, /ressemble à un téléphone/);
  assert.match(html, /téléphone « 00 00 00 00 00 » ignoré/);
  assert.match(html, /date « 31\/02\/1957 » invalide/);
  assert.match(html, /prénoms manquants/);
  assert.match(html, /Importer 3 adhérent/);
  t = await admin.csrf('/adherents');
  r = await admin.post('/adherents/importer/confirmer', { _csrf: t });
  assert.equal(r.status, 302);
  const fiche = await (await admin.get('/adherents?q=MU-09-25-00904')).text();
  assert.match(fiche, /KONAN/);
  assert.match(fiche, /01\/09\/2025/); // date d'adhésion déduite du matricule
});

test('import : modèle Excel téléchargeable et réimportable', async () => {
  const r = await admin.get('/adherents/importer/modele.xlsx');
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  const t = await admin.csrf('/adherents/importer');
  const fd = new FormData();
  fd.set('_csrf', t); fd.set('categorie_id', '1'); fd.set('remplacer', '0');
  fd.set('fichier', fichierImport(buf, 'modele.xlsx', 'application/octet-stream'), 'modele.xlsx');
  const html = await (await admin.post('/adherents/importer', fd)).text();
  assert.match(html, /YAO JEAN/);
  assert.match(html, /Importer 1 adhérent/);
});

test('import en mode remplacement : confirmation exigée, sauvegarde, base remplacée', async () => {
  const csv = 'Nom;Prénoms;Sexe\nALPHA;UN;M\nBETA;DEUX;F\n';
  const envoyer = async () => {
    const t = await admin.csrf('/adherents/importer');
    const fd = new FormData();
    fd.set('_csrf', t); fd.set('categorie_id', '1'); fd.set('remplacer', '1');
    fd.set('fichier', fichierImport(csv, 'r.csv', 'text/csv'), 'r.csv');
    return (await admin.post('/adherents/importer', fd)).text();
  };
  let html = await envoyer();
  assert.match(html, /Mode remplacement/);
  let t = await admin.csrf('/adherents');
  let r = await admin.post('/adherents/importer/confirmer', { _csrf: t, confirmation: 'oui' });
  assert.equal(r.headers.get('location'), '/adherents/importer');
  assert.ok((await (await admin.get('/adherents')).text()).includes('KOUASSI')); // rien supprimé
  await envoyer();
  t = await admin.csrf('/adherents');
  r = await admin.post('/adherents/importer/confirmer', { _csrf: t, confirmation: 'REMPLACER' });
  assert.equal(r.status, 302);
  html = await (await admin.get('/adherents')).text();
  assert.match(html, /2 adhérents/);
  assert.match(html, /ALPHA/);
  assert.ok(!html.includes('KOUASSI'));
  assert.ok(fs.readdirSync(path.join(dataDir, 'sauvegardes')).some((f) => f.startsWith('avant-import-')));
  assert.match(html, /MU-\d{2}-\d{2}-\d{5}/); // matricules générés au format MU
});
