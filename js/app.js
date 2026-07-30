/* Pipeline Monitor — pure logic + renderer.
   Works both inside the Trello Power-Up modal (dashboard.html)
   and in the offline preview harness (preview.html). */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- helpers

    var REGION_RE = /^\s*(\d+)\s*[.,)-]\s*(.+)$/; // now also tolerates a comma separator, e.g. "1, FROZENLAND 1"
  var NO_REGION = 'Tanpa Region';

  function stripNumber(name) {
    var m = REGION_RE.exec(name || '');
    return m ? m[2].trim() : String(name || '').trim();
  }

  function labelOrder(name) {
    var m = REGION_RE.exec(name || '');
    return m ? parseInt(m[1], 10) : 999;
  }

  /* A label is treated as a REGION when it is numbered ("4. FROZENLAND 4 (JAWA)").
     Any other label is treated as a BRAND ("FROZENLAND", "SPLASHBOM"). */
  function isRegionLabel(name) {
    return REGION_RE.test(name || '');
  }

  function regionOf(card) {
    var labels = card.labels || [];
    for (var i = 0; i < labels.length; i++) {
      if (isRegionLabel(labels[i].name)) {
        return { name: stripNumber(labels[i].name), order: labelOrder(labels[i].name) };
      }
    }
    return { name: NO_REGION, order: 1000 };
  }

  function brandsOf(card) {
    return (card.labels || [])
      .filter(function (l) { return l.name && !isRegionLabel(l.name); })
      .map(function (l) { return l.name.trim(); });
  }

  function checklistOf(card) {
    var b = card.badges || {};
    var total = b.checkItems || 0;
    var done = b.checkItemsChecked || 0;
    return { total: total, done: done, pct: total ? Math.round((done / total) * 100) : null };
  }

  function pctClass(pct) {
    if (pct === null) return 'none';
    if (pct >= 100) return 'good';
    if (pct >= 60) return 'warn';
    return 'bad';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ------------------------------------------------------------- aggregate

  /* lists: [{id, name}] in board order
     cards: [{id, name, idList, labels, badges, url}] */
  function aggregate(lists, cards, brandFilter) {
    var stages = lists.map(function (l) {
      return { id: l.id, name: stripNumber(l.name), raw: l.name };
    });

    var allBrands = {};
    cards.forEach(function (c) {
      brandsOf(c).forEach(function (b) { allBrands[b] = true; });
    });

    var kept = cards.filter(function (c) {
      if (!brandFilter || brandFilter === '__all__') return true;
      return brandsOf(c).indexOf(brandFilter) !== -1;
    });

    var regionMap = {}; // name -> {name, order, cells: {listId: [cards]}}
    function ensure(r) {
      if (!regionMap[r.name]) {
        regionMap[r.name] = { name: r.name, order: r.order, cells: {} };
        stages.forEach(function (s) { regionMap[r.name].cells[s.id] = []; });
      }
      return regionMap[r.name];
    }

    var orphan = 0;
    kept.forEach(function (c) {
      var row = ensure(regionOf(c));
      if (row.cells[c.idList]) row.cells[c.idList].push(c);
      else orphan++;
    });

    var regions = Object.keys(regionMap).map(function (k) { return regionMap[k]; })
      .sort(function (a, b) { return a.order - b.order || a.name.localeCompare(b.name); });

    // cell / row / column stats
    function stat(arr) {
      var done = 0, total = 0, withCl = 0;
      arr.forEach(function (c) {
        var cl = checklistOf(c);
        if (cl.total > 0) { done += cl.done; total += cl.total; withCl++; }
      });
      return {
        count: arr.length,
        cards: arr,
        withChecklist: withCl,
        pct: total ? Math.round((done / total) * 100) : null
      };
    }

    regions.forEach(function (r) {
      r.stats = {};
      var rowCards = [];
      stages.forEach(function (s) {
        r.stats[s.id] = stat(r.cells[s.id]);
        rowCards = rowCards.concat(r.cells[s.id]);
      });
      r.total = stat(rowCards);
    });

    var colTotals = {};
    stages.forEach(function (s) {
      var arr = [];
      regions.forEach(function (r) { arr = arr.concat(r.cells[s.id]); });
      colTotals[s.id] = stat(arr);
    });

    return {
      stages: stages,
      regions: regions,
      colTotals: colTotals,
      grand: stat(kept),
      brands: Object.keys(allBrands).sort(),
      orphan: orphan
    };
  }

  // ---------------------------------------------------------------- render

  function bar(pct) {
    if (pct === null) return '<div class="bar"><span class="empty">—</span></div>';
    return '<div class="bar bar-' + pctClass(pct) + '"><i style="width:' + pct + '%"></i></div>';
  }

  function cellHtml(st, regionName, stageId, stageName) {
    if (!st.count) return '<td class="cell zero">0</td>';
    return '<td class="cell" data-region="' + esc(regionName) + '" data-stage="' + esc(stageId) +
      '" data-stagename="' + esc(stageName) + '" tabindex="0">' +
      '<b>' + st.count + '</b>' +
      (st.pct === null ? '' : '<em>' + st.pct + '%</em>') +
      (st.pct === null ? '' : bar(st.pct)) +
      '</td>';
  }

  function matrixHtml(agg) {
    var h = '<table class="matrix"><thead><tr><th class="rowhead">Region</th>';
    agg.stages.forEach(function (s) { h += '<th>' + esc(s.name) + '</th>'; });
    h += '<th class="tot">Total</th></tr></thead><tbody>';

    agg.regions.forEach(function (r) {
      h += '<tr><th class="rowhead">' + esc(r.name) + '</th>';
      agg.stages.forEach(function (s) {
        h += cellHtml(r.stats[s.id], r.name, s.id, s.name);
      });
      h += '<td class="cell tot"><b>' + r.total.count + '</b>' +
        (r.total.pct === null ? '' : '<em>' + r.total.pct + '%</em>') + '</td></tr>';
    });

    h += '</tbody><tfoot><tr><th class="rowhead">Total</th>';
    agg.stages.forEach(function (s) {
      var st = agg.colTotals[s.id];
      h += '<td class="cell tot"><b>' + st.count + '</b>' +
        (st.pct === null ? '' : '<em>' + st.pct + '%</em>') + '</td>';
    });
    h += '<td class="cell tot grand"><b>' + agg.grand.count + '</b></td></tr></tfoot></table>';
    return h;
  }

  function kpiHtml(agg) {
    function find(re) {
      var s = agg.stages.filter(function (x) { return re.test(x.name); })[0];
      return s ? agg.colTotals[s.id].count : 0;
    }
    var contact = find(/contact/i), nego = find(/nego/i), deal = find(/^deal/i);
    var operating = find(/operating/i), canceled = find(/cancel/i), closed = find(/closed/i);
    var active = contact + nego + deal;
    var decided = operating + canceled + closed;
    var winRate = decided ? Math.round((operating / decided) * 100) : null;

    var items = [
      ['Total kartu', agg.grand.count, ''],
      ['Pipeline aktif', active, 'Contact + On Nego + Deal'],
      ['Operating', operating, ''],
      ['Canceled', canceled, ''],
      ['Win rate', winRate === null ? '—' : winRate + '%', 'Operating ÷ (Operating+Canceled+Closed)'],
      ['Kesiapan checklist', agg.grand.pct === null ? '—' : agg.grand.pct + '%', 'Rata-rata semua kartu']
    ];
    return '<div class="kpis">' + items.map(function (it) {
      return '<div class="kpi" title="' + esc(it[2]) + '"><span>' + esc(it[0]) + '</span><strong>' + esc(it[1]) + '</strong></div>';
    }).join('') + '</div>';
  }

  function cardRowsHtml(cards) {
    if (!cards.length) return '<p class="muted">Tidak ada kartu.</p>';
    var sorted = cards.slice().sort(function (a, b) {
      var pa = checklistOf(a).pct, pb = checklistOf(b).pct;
      if (pa === null && pb === null) return a.name.localeCompare(b.name);
      if (pa === null) return 1;
      if (pb === null) return -1;
      return pa - pb;
    });
    return '<ul class="cards">' + sorted.map(function (c) {
      var cl = checklistOf(c);
      return '<li>' +
        '<a href="' + esc(c.url || '#') + '" target="_blank" rel="noopener" data-card="' + esc(c.id) + '">' + esc(c.name) + '</a>' +
        '<div class="clwrap">' + bar(cl.pct) +
        '<span class="clnum">' + (cl.total ? cl.done + '/' + cl.total : 'tanpa checklist') + '</span></div>' +
        '</li>';
    }).join('') + '</ul>';
  }

  function checklistTabHtml(agg) {
    var h = '';
    agg.regions.forEach(function (r) {
      var cards = r.total.cards.filter(function (c) { return checklistOf(c).total > 0; });
      if (!cards.length) return;
      h += '<section class="clgroup"><h3>' + esc(r.name) +
        ' <small>' + cards.length + ' kartu · ' + (r.total.pct === null ? '—' : r.total.pct + '%') + '</small></h3>' +
        cardRowsHtml(cards) + '</section>';
    });
    return h || '<p class="muted">Belum ada kartu dengan checklist.</p>';
  }

  var STYLES = [
    ':root{color-scheme:light}',
    '*{box-sizing:border-box}',
    'body{margin:0;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#172b4d;background:#fff}',
    '.wrap{padding:14px 16px 40px}',
    '.top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px}',
    '.top h1{font-size:16px;margin:0;font-weight:600}',
    '.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    'select,button{font:inherit;border:1px solid #dfe1e6;background:#fff;border-radius:6px;padding:5px 9px;color:#172b4d;cursor:pointer}',
    'button:hover,select:hover{background:#f4f5f7}',
    'button.primary{background:#0c66e4;border-color:#0c66e4;color:#fff}',
    '.tabs{display:flex;gap:4px;margin:0 0 12px;border-bottom:1px solid #dfe1e6}',
    '.tabs button{border:0;border-radius:0;background:none;padding:7px 12px;color:#5e6c84;font-weight:600}',
    '.tabs button.active{color:#0c66e4;box-shadow:inset 0 -2px 0 #0c66e4}',
    '.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:14px}',
    '.kpi{background:#f4f5f7;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px}',
    '.kpi span{font-size:11px;color:#5e6c84;text-transform:uppercase;letter-spacing:.4px}',
    '.kpi strong{font-size:20px;font-weight:600}',
    'table.matrix{border-collapse:separate;border-spacing:0;width:100%;font-size:12px}',
    '.matrix th,.matrix td{border-bottom:1px solid #ebecf0;padding:7px 8px;text-align:center;vertical-align:middle}',
    '.matrix thead th{background:#f4f5f7;font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:#5e6c84;position:sticky;top:0;z-index:2}',
    '.matrix .rowhead{text-align:left;font-weight:600;white-space:nowrap;background:#fff;position:sticky;left:0;z-index:1}',
    '.matrix thead .rowhead{background:#f4f5f7;z-index:3}',
    '.matrix td.cell{cursor:pointer;min-width:78px}',
    '.matrix td.cell:hover{background:#e9f2ff}',
    '.matrix td.zero{color:#b3bac5;cursor:default}',
    '.matrix td.cell b{font-size:15px;display:block;line-height:1.1}',
    '.matrix td.cell em{font-size:10px;color:#5e6c84;font-style:normal}',
    '.matrix .tot{background:#fafbfc;font-weight:600}',
    '.matrix tfoot td,.matrix tfoot th{background:#f4f5f7;font-weight:600}',
    '.matrix td.sel{outline:2px solid #0c66e4;outline-offset:-2px;background:#e9f2ff}',
    '.bar{position:relative;height:4px;border-radius:3px;background:#dfe1e6;margin:4px auto 0;overflow:hidden}',
    '.bar i{position:absolute;left:0;top:0;bottom:0;display:block;border-radius:3px}',
    '.bar-good i{background:#22a06b}.bar-warn i{background:#e2b203}.bar-bad i{background:#c9372c}',
    '.bar .empty{font-size:9px;color:#b3bac5}',
    '.detail{margin-top:16px;border-top:1px solid #dfe1e6;padding-top:12px}',
    '.detail h2{font-size:13px;margin:0 0 8px}',
    'ul.cards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px}',
    'ul.cards li{border:1px solid #dfe1e6;border-radius:8px;padding:8px 10px}',
    'ul.cards a{color:#0c66e4;text-decoration:none;font-weight:500;display:block;margin-bottom:6px}',
    'ul.cards a:hover{text-decoration:underline}',
    '.clwrap{display:flex;align-items:center;gap:8px}',
    '.clwrap .bar{flex:1;margin:0}',
    '.clnum{font-size:11px;color:#5e6c84;white-space:nowrap}',
    '.clgroup{margin-bottom:18px}',
    '.clgroup h3{font-size:13px;margin:0 0 8px}',
    '.clgroup small{font-weight:400;color:#5e6c84}',
    '.muted{color:#5e6c84}',
    '.note{font-size:11px;color:#5e6c84;margin-top:10px}'
  ].join('\n');

  /* opts: { el, lists, cards, boardName, onOpenCard, onRefresh } */
  function render(opts) {
    var el = opts.el;
    var state = { brand: '__all__', tab: 'matrix', sel: null };

    if (!document.getElementById('pm-styles')) {
      var st = document.createElement('style');
      st.id = 'pm-styles';
      st.textContent = STYLES;
      document.head.appendChild(st);
    }

    function draw() {
      var agg = aggregate(opts.lists, opts.cards, state.brand);
      var brandOpts = ['<option value="__all__">Semua brand</option>'].concat(
        agg.brands.map(function (b) {
          return '<option value="' + esc(b) + '"' + (state.brand === b ? ' selected' : '') + '>' + esc(b) + '</option>';
        })).join('');

      el.innerHTML =
        '<div class="wrap">' +
        '<div class="top"><h1>' + esc(opts.boardName || 'Pipeline') + '</h1>' +
        '<div class="controls">' +
        '<select id="pm-brand">' + brandOpts + '</select>' +
        '<button id="pm-csv">Export CSV</button>' +
        '<button id="pm-refresh" class="primary">Refresh</button>' +
        '</div></div>' +
        '<div class="tabs">' +
        '<button data-tab="matrix" class="' + (state.tab === 'matrix' ? 'active' : '') + '">Matriks</button>' +
        '<button data-tab="checklist" class="' + (state.tab === 'checklist' ? 'active' : '') + '">Progress Checklist</button>' +
        '</div>' +
        (state.tab === 'matrix'
          ? kpiHtml(agg) + '<div class="scroll">' + matrixHtml(agg) + '</div>' +
            '<div class="detail" id="pm-detail"><p class="muted">Klik salah satu angka di matriks untuk melihat daftar kartunya.</p></div>' +
            '<p class="note">Angka besar = jumlah kartu. Angka kecil + bar = rata-rata progress checklist. Kartu tanpa label bernomor masuk ke baris “Tanpa Region”.</p>'
          : checklistTabHtml(agg)) +
        '</div>';

      el.querySelector('#pm-brand').onchange = function () {
        state.brand = this.value; state.sel = null; draw();
      };
      el.querySelector('#pm-refresh').onclick = function () {
        if (opts.onRefresh) opts.onRefresh();
      };
      el.querySelector('#pm-csv').onclick = function () { exportCsv(agg, opts.boardName); };
      Array.prototype.forEach.call(el.querySelectorAll('.tabs button'), function (b) {
        b.onclick = function () { state.tab = b.dataset.tab; draw(); };
      });

      Array.prototype.forEach.call(el.querySelectorAll('td.cell[data-region]'), function (td) {
        function open() {
          Array.prototype.forEach.call(el.querySelectorAll('td.sel'), function (x) { x.classList.remove('sel'); });
          td.classList.add('sel');
          var r = agg.regions.filter(function (x) { return x.name === td.dataset.region; })[0];
          var st = r.stats[td.dataset.stage];
          var d = el.querySelector('#pm-detail');
          d.innerHTML = '<h2>' + esc(td.dataset.region) + ' — ' + esc(td.dataset.stagename) +
            ' <span class="muted">(' + st.count + ' kartu' +
            (st.pct === null ? '' : ', kesiapan ' + st.pct + '%') + ')</span></h2>' + cardRowsHtml(st.cards);
          bindCardLinks(d);
          if (d.scrollIntoView) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        td.onclick = open;
        td.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
      });

      bindCardLinks(el);
    }

    function bindCardLinks(scope) {
      if (!opts.onOpenCard) return;
      Array.prototype.forEach.call(scope.querySelectorAll('a[data-card]'), function (a) {
        a.onclick = function (e) { e.preventDefault(); opts.onOpenCard(a.dataset.card); };
      });
    }

    draw();
  }

  function exportCsv(agg, boardName) {
    var rows = [['Region'].concat(agg.stages.map(function (s) { return s.name; })).concat(['Total', 'Kesiapan %'])];
    agg.regions.forEach(function (r) {
      rows.push([r.name].concat(agg.stages.map(function (s) { return r.stats[s.id].count; }))
        .concat([r.total.count, r.total.pct === null ? '' : r.total.pct]));
    });
    rows.push(['TOTAL'].concat(agg.stages.map(function (s) { return agg.colTotals[s.id].count; }))
      .concat([agg.grand.count, agg.grand.pct === null ? '' : agg.grand.pct]));

    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');

    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (boardName || 'pipeline').replace(/[^\w-]+/g, '_') + '_pipeline.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  root.PipelineMonitor = {
    aggregate: aggregate,
    render: render,
    _helpers: { regionOf: regionOf, brandsOf: brandsOf, checklistOf: checklistOf, stripNumber: stripNumber }
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
