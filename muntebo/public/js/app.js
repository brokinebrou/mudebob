/* Muntebo — scripts côté navigateur (aucun script inline : compatible CSP stricte) */
(function () {
  'use strict';

  // Menu latéral sur mobile
  document.querySelectorAll('[data-toggle-sidebar]').forEach((b) =>
    b.addEventListener('click', () => document.querySelector('.mt-sidebar').classList.toggle('open'))
  );

  // Confirmation avant action sensible
  document.addEventListener('submit', (e) => {
    const msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // Soumission automatique des filtres
  document.querySelectorAll('[data-autosubmit]').forEach((el) =>
    el.addEventListener('change', () => el.form && el.form.submit())
  );

  // Afficher / masquer le mot de passe
  document.querySelectorAll('[data-toggle-password]').forEach((b) =>
    b.addEventListener('click', () => {
      const input = document.getElementById(b.getAttribute('data-toggle-password'));
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      b.querySelector('i').className = visible ? 'bi bi-eye' : 'bi bi-eye-slash';
    })
  );

  // Aperçu de la photo choisie avant envoi
  document.querySelectorAll('input[type=file][data-apercu]').forEach((input) =>
    input.addEventListener('change', () => {
      const img = document.getElementById(input.getAttribute('data-apercu'));
      const vide = document.getElementById('photo-vide');
      const fichier = input.files && input.files[0];
      if (!fichier || !fichier.type.startsWith('image/')) return;
      if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
      img.dataset.url = URL.createObjectURL(fichier);
      img.src = img.dataset.url;
      img.hidden = false;
      if (vide) vide.hidden = true;
    })
  );

  // Copier dans le presse-papiers
  document.querySelectorAll('[data-copy]').forEach((b) =>
    b.addEventListener('click', () => {
      navigator.clipboard && navigator.clipboard.writeText(b.getAttribute('data-copy'));
      b.innerHTML = '<i class="bi bi-check2"></i> Copié';
    })
  );

  // Formulaire cotisation exceptionnelle : tous / sélection
  const cible = document.querySelectorAll('input[name="cible"]');
  if (cible.length) {
    const zone = document.getElementById('zone-selection');
    const maj = () => { zone.hidden = document.querySelector('input[name="cible"]:checked').value !== 'selection'; };
    cible.forEach((r) => r.addEventListener('change', maj));
    maj();
    const tout = document.getElementById('tout-cocher');
    if (tout) tout.addEventListener('change', () => zone.querySelectorAll('input[type=checkbox][name="adherents"]').forEach((c) => { if (!c.closest('[hidden]')) c.checked = tout.checked; }));
    const filtre = document.getElementById('filtre-adherents');
    if (filtre) filtre.addEventListener('input', () => {
      const q = filtre.value.toLowerCase();
      zone.querySelectorAll('[data-nom]').forEach((el) => { el.hidden = !el.getAttribute('data-nom').includes(q); });
    });
  }

  // Formulaire de versement : type normale / exceptionnelle et montant proposé
  const formV = document.getElementById('form-versement');
  if (formV) {
    const types = formV.querySelectorAll('input[name="type"]');
    const montant = formV.querySelector('#montant');
    const majType = () => {
      const t = formV.querySelector('input[name="type"]:checked');
      if (!t) return;
      formV.querySelectorAll('[data-type]').forEach((el) => { el.hidden = el.getAttribute('data-type') !== t.value; });
      proposer();
    };
    const proposer = () => {
      const t = formV.querySelector('input[name="type"]:checked');
      if (!t) return;
      const sel = formV.querySelector(t.value === 'normale' ? '#periode' : '#cotisation_exc_id');
      const opt = sel && sel.selectedOptions[0];
      if (opt && opt.dataset.reste && Number(opt.dataset.reste) > 0 && (!montant.value || montant.dataset.auto === '1')) {
        montant.value = opt.dataset.reste;
        montant.dataset.auto = '1';
      }
    };
    types.forEach((r) => r.addEventListener('change', () => { montant.dataset.auto = '1'; majType(); }));
    formV.querySelectorAll('#periode, #cotisation_exc_id').forEach((s) => s.addEventListener('change', () => { montant.dataset.auto = '1'; proposer(); }));
    montant.addEventListener('input', () => { montant.dataset.auto = '0'; });
    majType();
  }

  // Recherche d'adhérent avec suggestions
  document.querySelectorAll('[data-autocomplete]').forEach((input) => {
    const liste = document.createElement('div');
    liste.className = 'autocomplete-list';
    liste.hidden = true;
    input.parentNode.appendChild(liste);
    let timer, index = -1;
    const cible = input.getAttribute('data-autocomplete');
    const choisir = (a) => { window.location.href = cible + a.id; };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { liste.hidden = true; return; }
      timer = setTimeout(async () => {
        const r = await fetch('/adherents/recherche.json?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } });
        const data = await r.json();
        liste.innerHTML = '';
        index = -1;
        if (!data.length) {
          liste.innerHTML = '<div class="p-2 text-muted small">Aucun adhérent trouvé</div>';
        }
        data.forEach((a) => {
          const b = document.createElement('button');
          b.type = 'button';
          const strong = document.createElement('strong');
          strong.textContent = a.nom + ' ' + a.prenoms;
          const small = document.createElement('div');
          small.className = 'small text-muted';
          small.textContent = a.matricule + ' · ' + a.categorie + (a.statut !== 'actif' ? ' · ' + a.statut : '');
          b.append(strong, small);
          b.addEventListener('click', () => choisir(a));
          liste.appendChild(b);
        });
        liste.hidden = false;
      }, 200);
    });
    input.addEventListener('keydown', (e) => {
      const items = liste.querySelectorAll('button');
      if (!items.length) return;
      if (e.key === 'ArrowDown') { index = Math.min(index + 1, items.length - 1); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { index = Math.max(index - 1, 0); e.preventDefault(); }
      else if (e.key === 'Enter' && index >= 0) { items[index].click(); e.preventDefault(); return; }
      items.forEach((it, i) => it.classList.toggle('actif', i === index));
    });
    document.addEventListener('click', (e) => { if (!input.parentNode.contains(e.target)) liste.hidden = true; });
  });

  // Graphiques du tableau de bord
  const donnees = document.getElementById('donnees-graphiques');
  if (donnees && window.Chart) {
    const d = JSON.parse(donnees.textContent);
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = '#6b7770';
    const fcfa = (v) => Number(v).toLocaleString('fr-FR') + ' FCFA';
    const c1 = document.getElementById('graph-encaissements');
    if (c1) new Chart(c1, {
      type: 'bar',
      data: {
        labels: d.labels,
        datasets: [
          { label: 'Cotisations normales', data: d.normales, backgroundColor: '#2e8b2a', borderRadius: 4, stack: 's' },
          { label: 'Cotisations exceptionnelles', data: d.exceptionnelles, backgroundColor: '#8dc63f', borderRadius: 4, stack: 's' },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => c.dataset.label + ' : ' + fcfa(c.parsed.y) } } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: (v) => Number(v).toLocaleString('fr-FR') } } },
      },
    });
    const c2 = document.getElementById('graph-categories');
    if (c2) new Chart(c2, {
      type: 'doughnut',
      data: {
        labels: d.repartition.map((r) => r.libelle),
        datasets: [{ data: d.repartition.map((r) => r.n), backgroundColor: ['#1e6b23', '#8dc63f', '#3c8d63', '#e0c56e', '#7fb89a', '#8a6d1a', '#b7d8c4'], borderWidth: 2 }],
      },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom' } } },
    });
  }
})();
