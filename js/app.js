/* Pipeline Monitor — pure logic + renderer.
   Works both inside the Trello Power-Up modal (dashboard.html)
   and in the offline preview harness (preview.html). */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- helpers

  var REGION_RE = /^\s*(\d+)\s*[.,)-]\s*(.+)$/; // "3. FROZENLAND 3 (SUMATERA 2)" — also tolerates a stray comma like "1, FROZENLAND 1"
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

  /* Stable, deterministic accent color per region/brand name — same name always
     gets the same hue, regardless of sort order or active filter. Purely decorative. */
  function hueFor(name) {
    var s = String(name || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return h % 360;
  }
  function dotColor(name) { return 'hsl(' + hueFor(name) + ', 62%, 46%)'; }

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
      orphan: orphan,
      cards: kept
    };
  }

  // ---------------------------------------------------------------- render

  var ICON_MARK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="2" y="10" width="5" height="12" rx="1.2" fill="currentColor" opacity=".95"/>' +
    '<rect x="9.5" y="5" width="5" height="17" rx="1.2" fill="currentColor" opacity=".75"/>' +
    '<rect x="17" y="2" width="5" height="20" rx="1.2" fill="currentColor" opacity=".5"/>' +
    '</svg>';
  var ICON_REFRESH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M20 11A8 8 0 1 0 18.5 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '<path d="M20 5v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12 3v12m0 0 4-4m-4 4-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function bar(pct) {
    if (pct === null) return '<div class="bar"><span class="empty">—</span></div>';
    return '<div class="bar bar-' + pctClass(pct) + '"><i style="width:' + pct + '%"></i></div>';
  }

  function cellHtml(st, regionName, stageId, stageName) {
    if (!st.count) return '<td class="cell zero">–</td>';
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
      h += '<tr><th class="rowhead"><span class="dot" style="background:' + dotColor(r.name) + '"></span>' + esc(r.name) + '</th>';
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
    var winRate = decided ? Math.round(((operating + closed) / decided) * 100) : null;

    var items = [
      ['Total kartu', agg.grand.count, '', '#6366f1'],
      ['Pipeline aktif', active, 'Contact + On Nego + Deal', '#0c66e4'],
      ['Operating', operating, '', '#16a34a'],
      ['Canceled', canceled, '', '#dc2626'],
      ['Win rate', winRate === null ? '—' : winRate + '%', '(Operating+Already Closed) ÷ (Operating+Canceled+Already Closed)', '#d97706'],
      ['Kesiapan checklist', agg.grand.pct === null ? '—' : agg.grand.pct + '%', 'Rata-rata semua kartu', '#0891b2']
    ];
    return '<div class="kpis">' + items.map(function (it) {
      return '<div class="kpi" style="--k:' + it[3] + '" title="' + esc(it[2]) + '"><span>' + esc(it[0]) + '</span><strong>' + esc(it[1]) + '</strong></div>';
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
      h += '<section class="clgroup"><h3><span class="dot" style="background:' + dotColor(r.name) + '"></span>' + esc(r.name) +
        ' <small>' + cards.length + ' kartu · ' + (r.total.pct === null ? '—' : r.total.pct + '%') + '</small></h3>' +
        cardRowsHtml(cards) + '</section>';
    });
    return h || '<p class="muted">Belum ada kartu dengan checklist.</p>';
  }

  // ------------------------------------------------------------- geo / map

  /* Parses "Key : value" lines out of a card description, e.g.
     "Latitude : 7°34'39.1\"S" / "Longitude : 110°46'58.7\"E" / "Mall : ..." */
  function parseCardMeta(desc) {
    var meta = {};
    String(desc || '').split(/\r?\n/).forEach(function (line) {
      var m = /^\s*([A-Za-z][A-Za-z .]*?)\s*:\s*(.+?)\s*$/.exec(line);
      if (m) meta[m[1].trim().toLowerCase()] = m[2].trim();
    });
    return {
      lat: parseCoordToken(meta['latitude']),
      lon: parseCoordToken(meta['longitude']),
      mall: meta['mall'] || '',
      city: meta['city'] || '',
      region: meta['region'] || '',
      category: meta['category'] || '',
      priority: meta['priority'] || '',
      targetOpening: meta['target opening'] || ''
    };
  }

  /* Accepts either "7°34'39.1\"S" (DMS) or a plain decimal like "-7.578". */
  function parseCoordToken(raw) {
    if (!raw) return null;
    raw = String(raw).trim();
    var dms = /(-?\d+(?:\.\d+)?)\s*°\s*(\d+(?:\.\d+)?)?\s*['′]?\s*(\d+(?:\.\d+)?)?\s*["″]?\s*([NnSsEeWw])?/.exec(raw);
    if (dms && (dms[2] !== undefined || dms[4] !== undefined)) {
      var deg = parseFloat(dms[1]);
      var min = dms[2] ? parseFloat(dms[2]) : 0;
      var sec = dms[3] ? parseFloat(dms[3]) : 0;
      var val = Math.abs(deg) + min / 60 + sec / 3600;
      if (dms[4] && /[SW]/i.test(dms[4])) val = -val;
      return val;
    }
    var dec = parseFloat(raw.replace(',', '.'));
    return isNaN(dec) ? null : dec;
  }

  // Rough bounding box of Indonesia, used to place the stylised background
  // islands and to project each card's lat/long onto the same canvas.
  var MAP_W = 1000, MAP_H = 420;
  var MAP_LON_MIN = 94, MAP_LON_MAX = 141.5, MAP_LAT_MAX = 7.5, MAP_LAT_MIN = -11.5;

  function geoX(lon) { return (lon - MAP_LON_MIN) / (MAP_LON_MAX - MAP_LON_MIN) * MAP_W; }
  function geoY(lat) { return (MAP_LAT_MAX - lat) / (MAP_LAT_MAX - MAP_LAT_MIN) * MAP_H; }
  function inIndonesia(lat, lon) {
    return lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon) &&
      lat <= MAP_LAT_MAX + 1 && lat >= MAP_LAT_MIN - 1 && lon >= MAP_LON_MIN - 1 && lon <= MAP_LON_MAX + 1;
  }

  /* Draws a smooth closed shape through a hand-plotted set of coastline
     points (Catmull-Rom-ish: quadratic curves through edge midpoints).
     Looks like an actual, if stylised, island outline rather than a
     generic blob — no external map/GeoJSON data involved. */
  function smoothPoly(points) {
    var n = points.length;
    var mid = function (a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
    var m0 = mid(points[n - 1], points[0]);
    var d = 'M' + m0[0].toFixed(1) + ',' + m0[1].toFixed(1) + ' ';
    for (var i = 0; i < n; i++) {
      var cur = points[i], next = points[(i + 1) % n], m = mid(cur, next);
      d += 'Q' + cur[0].toFixed(1) + ',' + cur[1].toFixed(1) + ' ' + m[0].toFixed(1) + ',' + m[1].toFixed(1) + ' ';
    }
    return d + 'Z';
  }

  // Real Indonesia coastline data (simplified via Douglas-Peucker), projected
  // through geoX/geoY so every island lines up with real card coordinates.
  // Source: public-domain-derived country boundary coordinates (Natural Earth lineage).
  var ISLAND_SHAPES = [
    // Sumba
    [[562.4,392.1],[553.6,392.6],[525.6,377.1],[545.3,372.7],[556.3,379.5],[563.7,386.2],[562.4,392.1]],
    // Timor
    [[640.8,389.9],[622.7,394.8],[620.2,392.1],[622.1,384.6],[631.2,371.1],[652,362.4],[654.1,366.7],[654.5,373.4],[640.8,389.9]],
    // Sumbawa
    [[503.2,344.7],[510.7,350.6],[523.8,348.8],[529,358.2],[490.1,365.6],[478.7,365.5],[486,352.7],[497.5,352.6],[503.2,344.7]],
    // Flores
    [[608.5,344.7],[605.4,357],[573.8,363.3],[545.8,360.5],[545.7,352.5],[562.4,347.9],[575.6,354.5],[589.6,352.8],[608.5,344.7]],
    // Jawa & Bali
    [[307.9,315.6],[348.2,317.8],[352.8,308.7],[391.9,319.3],[399.6,333.7],[431.1,337.7],[457,350.8],[432.9,359.3],[409.8,350.3],[390.7,350.9],[368.9,349.3],[349.2,345.3],[324.8,336.9],[309.3,334.7],[300.6,337.5],[262.2,328.4],[258.5,318.9],[239.3,317.2],[253.7,296.1],[279.3,297.4],[296.3,306.1],[305,307.7],[307.9,315.6]],
    // Kai
    [[857.4,303.2],[846.5,318.2],[844.5,301.6],[852.6,286.2],[857.4,292.6],[857.4,303.2]],
    // Ambon
    [[700,242.3],[692.1,249.6],[677.6,245.5],[673.5,236],[694.8,235],[700,242.3]],
    // Seram
    [[767.8,234.2],[775.5,251.1],[757.7,242],[740.1,240.1],[728.2,241.6],[713.7,240.8],[718.7,228.6],[744.7,227.7],[767.8,234.2]],
    // Papua
    [[845.1,191.3],[851,227],[872.8,240.2],[890.4,216.8],[914.5,203.4],[933.3,203.4],[966.9,219],[989.5,223.3],[990.2,367.3],[971.4,349.2],[950.1,344.8],[944.9,351.1],[918.2,351.7],[927.1,333.7],[940.4,327.6],[934.9,303.6],[924.8,285],[884,266.3],[866.6,264.4],[835,244],[828.8,254.8],[820.7,256.7],[815.9,248.6],[815.9,239],[799.8,228.1],[822.5,220.2],[837.5,220.6],[835.7,214.7],[804.9,214.7],[796.6,201.5],[777.7,197.5],[768.8,186.5],[797.2,181.2],[808,174],[841.8,183],[845.1,191.3]],
    // Sulawesi
    [[657.7,134.4],[640.8,156.3],[625,160.6],[604.7,156.3],[569.6,157.4],[551.2,160.5],[548.2,177.3],[567.1,196.9],[578.4,186.9],[617.7,179.4],[616,189.6],[606.8,186.4],[597.7,199.3],[579.1,207.9],[599,236.2],[595.2,243.8],[614.1,269.3],[613.9,283.8],[602.7,290.3],[594.5,282.6],[604.6,264.5],[584,273],[578.7,266.9],[581.5,258.4],[566.3,245.4],[567.8,223.9],[553.8,230.6],[555.6,256.4],[556.4,288],[543.1,291.2],[534,284.7],[540.1,264.4],[536.8,243],[528,242.9],[521.4,227.7],[530.1,213.3],[533.1,195.7],[543.7,162.4],[548.1,153.3],[566,136.8],[582.5,143.4],[609,146.4],[633.2,145.5],[654,129.5],[657.7,134.4]],
    // Halmahera
    [[730.3,140.8],[729.2,160.1],[718.3,157.9],[715.1,171.4],[723.8,183],[717.9,185.7],[709.4,171.7],[703.1,143.4],[707.4,125.8],[714.4,117.7],[715.9,129.8],[728.3,131.7],[730.3,140.8]],
    // Kalimantan
    [[502.6,125.4],[526.2,145.8],[501.3,148.5],[494.3,163.5],[495.2,183.6],[474.9,198.7],[474.4,220.7],[466.3,254.5],[463.2,246.6],[439.3,256.6],[430.9,243.1],[415.9,241.8],[405.4,234.7],[380.4,242.7],[372.7,232],[358.9,233.2],[341.6,230.6],[338.3,201],[327.8,194.9],[317.7,175.9],[314.8,156.6],[317.2,136.1],[329.8,121.4],[333.3,136.2],[347.7,148.7],[361.2,144.2],[374.7,145.8],[387,134.6],[397,132.7],[417,138.9],[434.1,134.2],[444.9,103.4],[453,95.7],[460.3,70.6],[484.5,70.6],[502.8,74.3],[490.8,94.3],[506.3,115.2],[502.6,125.4]],
    // Sumatera
    [[248.8,295.2],[225.5,295.6],[207.8,277.1],[180.7,259.1],[171.7,245.7],[155.8,227.7],[145.3,211.1],[129.3,180.2],[110.8,161.7],[104.6,142.7],[96.9,125.5],[77.9,111.6],[66.9,92.6],[51,80.3],[29.1,55.9],[27.2,44.7],[40.8,45.5],[73.4,49.8],[92,71.4],[108.3,86.4],[119.9,95.6],[139.8,119.4],[161.2,119.7],[178.9,134.9],[191.1,153.4],[207.1,163.5],[198.7,181.5],[210.8,189.2],[218.3,189.8],[221.9,205.2],[229.2,217.5],[244.7,219.5],[254.9,233.5],[249.6,261],[248.8,295.2]]
  ];

  var ISLANDS_SVG = ISLAND_SHAPES.map(function (pts) {
    return '<path class="island" d="' + smoothPoly(pts) + '"/>';
  }).join('');

  function geoPointsOf(cards) {
    var out = [];
    cards.forEach(function (c) {
      var meta = parseCardMeta(c.desc);
      if (!inIndonesia(meta.lat, meta.lon)) return;
      out.push({
        card: c, meta: meta, region: regionOf(c).name,
        x: geoX(meta.lon), y: geoY(meta.lat)
      });
    });
    return out;
  }

  /* Rough label width estimate for a 9.5px bold sans-serif label — used only
     to decide when two labels' boxes would overlap, not for exact layout. */
  function estimateLabelWidth(s) { return s.length * 5.4 + 10; }

  /* Global label de-collision: sorts every marker top-to-bottom and pushes a
     label straight down until its estimated box no longer overlaps any
     already-placed label (checked on both X and Y, not just same column), so
     dense clusters (e.g. Sulawesi/Maluku) stop rendering overlapping text.
     The dot itself never moves; a thin leader line is drawn whenever a label
     had to shift away from its dot. */
  function layoutLabels(points) {
    points.forEach(function (p) {
      p.leftSide = p.x > MAP_W * 0.72;
      p.anchor = p.leftSide ? 'end' : 'start';
      p.lx = p.leftSide ? p.x - 8 : p.x + 8;
      p.dispName = p.card.name.length > 26 ? p.card.name.slice(0, 25) + '…' : p.card.name;
      p.labelW = estimateLabelWidth(p.dispName);
    });
    var minGap = 13, pad = 6;
    var placed = [];
    points.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (p) {
      var boxLeft = p.leftSide ? p.lx - p.labelW : p.lx;
      var boxRight = p.leftSide ? p.lx : p.lx + p.labelW;
      var y = p.y, moved = true, guard = 0;
      while (moved && guard++ < 200) {
        moved = false;
        for (var i = 0; i < placed.length; i++) {
          var q = placed[i];
          var xOverlap = boxLeft < q.right + pad && boxRight > q.left - pad;
          if (xOverlap && Math.abs(y - q.y) < minGap) { y = q.y + minGap; moved = true; }
        }
      }
      p.labelY = y;
      placed.push({ y: y, left: boxLeft, right: boxRight });
    });
  }

  function mapSvgHtml(points) {
    layoutLabels(points);
    var markers = points.map(function (p) {
      var color = dotColor(p.region);
      var needsLine = Math.abs(p.labelY - p.y) > 4 || p.leftSide;
      return '<g class="geo-dot" data-card="' + esc(p.card.id) + '" tabindex="0">' +
        (needsLine ? '<line class="geo-line" x1="' + p.x.toFixed(1) + '" y1="' + p.y.toFixed(1) + '" x2="' + p.lx.toFixed(1) + '" y2="' + p.labelY.toFixed(1) + '"/>' : '') +
        '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4.5" fill="' + color + '"/>' +
        '<text class="geo-label" x="' + p.lx.toFixed(1) + '" y="' + p.labelY.toFixed(1) + '" text-anchor="' + p.anchor + '" dy="3">' + esc(p.dispName) + '</text>' +
        '<title>' + esc(p.card.name) + (p.meta.mall ? ' · ' + esc(p.meta.mall) : '') + (p.meta.city ? ' · ' + esc(p.meta.city) : '') + '</title>' +
        '</g>';
    }).join('');
    return '<svg class="pm-map" viewBox="0 0 ' + MAP_W + ' ' + MAP_H + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect class="ocean" x="0" y="0" width="' + MAP_W + '" height="' + MAP_H + '" rx="16"/>' +
      ISLANDS_SVG + markers + '</svg>';
  }

  function mapListHtml(points, missingCount) {
    if (!points.length) {
      return '<p class="muted">Belum ada kartu dengan koordinat Latitude/Longitude yang bisa dibaca di deskripsi.</p>';
    }
    var byRegion = {};
    points.forEach(function (p) { (byRegion[p.region] = byRegion[p.region] || []).push(p); });
    var names = Object.keys(byRegion).sort();
    var h = '<div class="geolegend">';
    names.forEach(function (name) {
      h += '<section class="clgroup"><h3><span class="dot" style="background:' + dotColor(name) + '"></span>' + esc(name) +
        ' <small>' + byRegion[name].length + ' lokasi</small></h3><ul class="cards">' +
        byRegion[name].map(function (p) {
          return '<li><a href="' + esc(p.card.url || '#') + '" target="_blank" rel="noopener" data-card="' + esc(p.card.id) + '">' + esc(p.card.name) + '</a>' +
            (p.meta.mall || p.meta.city ? '<div class="geo-meta">' + esc([p.meta.mall, p.meta.city].filter(Boolean).join(' · ')) + '</div>' : '') +
            '</li>';
        }).join('') + '</ul></section>';
    });
    h += '</div>';
    if (missingCount) {
      h += '<p class="note">' + missingCount + ' kartu (di filter brand saat ini) belum punya koordinat Latitude/Longitude yang terbaca di deskripsi, jadi belum muncul di peta.</p>';
    }
    return h;
  }

  function mapTabHtml(agg) {
    var points = geoPointsOf(agg.cards);
    var missing = agg.cards.length - points.length;
    return '<div class="mapwrap">' + mapSvgHtml(points) + '</div>' +
      '<div class="detail-inner" style="padding-top:0">' + mapListHtml(points, missing) + '</div>';
  }

  var STYLES = [
    ':root{color-scheme:light;',
    '  --ink:#172b4d;--muted:#6b778c;--faint:#98a2b3;--line:#eceef2;--panel:#ffffff;--page:#f6f7fb;',
    '  --accent:#4f46e5;--accent-2:#0c66e4;--good:#16a34a;--warn:#d97706;--bad:#dc2626;',
    '  --radius:14px;--radius-sm:9px;',
    '  --shadow-sm:0 1px 2px rgba(15,23,42,.05);',
    '  --shadow-md:0 10px 28px rgba(15,23,42,.08),0 2px 6px rgba(15,23,42,.05);}',
    '*{box-sizing:border-box}',
    'body{margin:0;background:var(--page);font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}',
    '.wrap{padding:22px 24px 48px;max-width:1280px;margin:0 auto}',

    '.pm-header{display:flex;align-items:center;gap:12px;margin-bottom:20px}',
    '.pm-mark{flex:none;width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;color:#fff;background:linear-gradient(135deg,var(--accent),var(--accent-2));box-shadow:var(--shadow-sm)}',
    '.pm-title{flex:1;min-width:0}',
    '.pm-title h1{margin:0;font-size:17px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pm-title p{margin:2px 0 0;font-size:11.5px;color:var(--muted)}',

    '.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    'select.pm-select{appearance:none;-webkit-appearance:none;font:inherit;font-weight:600;border:1px solid var(--line);background:#fff url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="6"><path d="M1 1l4 4 4-4" stroke="%236b778c" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>\') no-repeat right 12px center;border-radius:999px;padding:8px 30px 8px 16px;color:var(--ink);cursor:pointer;box-shadow:var(--shadow-sm);transition:border-color .15s,box-shadow .15s}',
    'select.pm-select:hover{border-color:#c7cce0}',
    'button.pm-btn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-weight:600;border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 16px;color:var(--ink);cursor:pointer;box-shadow:var(--shadow-sm);transition:transform .12s,box-shadow .12s,border-color .12s}',
    'button.pm-btn:hover{transform:translateY(-1px);box-shadow:var(--shadow-md);border-color:#d8dceb}',
    'button.pm-btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent-2));border-color:transparent;color:#fff}',

    '.tabs{display:inline-flex;background:#eceef5;padding:4px;border-radius:999px;gap:2px;margin-bottom:20px}',
    '.tabs button{border:0;border-radius:999px;background:transparent;padding:8px 18px;color:var(--muted);font-weight:700;font-size:12px;letter-spacing:.1px;cursor:pointer;transition:background .15s,color .15s}',
    '.tabs button.active{background:#fff;color:var(--ink);box-shadow:var(--shadow-sm)}',

    '.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}',
    '.kpi{position:relative;overflow:hidden;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:16px 16px 14px;box-shadow:var(--shadow-sm);transition:transform .15s,box-shadow .15s}',
    '.kpi::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--k,var(--accent))}',
    '.kpi:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}',
    '.kpi span{display:block;font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}',
    '.kpi strong{display:block;margin-top:8px;font-size:25px;font-weight:800;letter-spacing:-.02em;color:var(--ink)}',

    '.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-sm);overflow:hidden}',
    '.scroll{overflow:auto}',
    '.scroll::-webkit-scrollbar{height:9px}',
    '.scroll::-webkit-scrollbar-thumb{background:#d7dae5;border-radius:8px}',
    '.scroll::-webkit-scrollbar-track{background:transparent}',

    'table.matrix{border-collapse:collapse;width:100%;font-size:12.5px;min-width:640px}',
    '.matrix th,.matrix td{padding:12px 12px;text-align:center;vertical-align:middle;border-bottom:1px solid var(--line)}',
    '.matrix thead th{background:#fafbff;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);font-weight:700;position:sticky;top:0;z-index:2;border-bottom:1px solid var(--line)}',
    '.matrix .rowhead{text-align:left;font-weight:700;white-space:nowrap;background:var(--panel);position:sticky;left:0;z-index:1}',
    '.matrix thead .rowhead{background:#fafbff;z-index:3}',
    '.matrix .dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:8px;vertical-align:middle}',
    '.matrix td.cell{cursor:pointer;min-width:86px;transition:background .12s}',
    '.matrix td.cell:hover{background:#f1f4fd}',
    '.matrix td.zero{color:#c7cce0;cursor:default}',
    '.matrix td.cell b{font-size:16px;font-weight:800;display:block;line-height:1.15;letter-spacing:-.01em}',
    '.matrix td.cell em{font-size:10.5px;color:var(--muted);font-style:normal;font-weight:600}',
    '.matrix .tot{background:#fafbff;font-weight:700}',
    '.matrix tfoot td,.matrix tfoot th{background:#f3f4fa;font-weight:800;border-top:1px solid #e3e6f0;border-bottom:none}',
    '.matrix td.sel{background:#eef1ff;box-shadow:inset 0 0 0 2px var(--accent)}',

    '.bar{position:relative;height:5px;border-radius:5px;background:#e9ebf2;margin:6px auto 0;overflow:hidden;min-width:52px}',
    '.bar i{position:absolute;inset:0;border-radius:5px}',
    '.bar-good i{background:linear-gradient(90deg,#34d399,#16a34a)}',
    '.bar-warn i{background:linear-gradient(90deg,#fbbf24,#d97706)}',
    '.bar-bad i{background:linear-gradient(90deg,#f87171,#dc2626)}',
    '.bar .empty{font-size:9px;color:var(--faint)}',

    '.detail{margin-top:20px}',
    '.detail-inner{padding:18px 20px}',
    '.detail h2{font-size:13.5px;margin:0 0 12px;font-weight:700}',
    '.detail h2 .muted{font-weight:500}',

    'ul.cards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:10px}',
    'ul.cards li{border:1px solid var(--line);border-radius:var(--radius-sm);padding:12px 14px;background:#fff;transition:box-shadow .15s,transform .15s}',
    'ul.cards li:hover{box-shadow:var(--shadow-md);transform:translateY(-1px)}',
    'ul.cards a{color:var(--accent-2);text-decoration:none;font-weight:600;display:block;margin-bottom:8px;font-size:12.5px}',
    'ul.cards a:hover{text-decoration:underline}',
    '.clwrap{display:flex;align-items:center;gap:10px}',
    '.clwrap .bar{flex:1;margin:0}',
    '.clnum{font-size:11px;color:var(--muted);white-space:nowrap;font-weight:600}',

    '.clgroup{margin-bottom:22px}',
    '.clgroup h3{font-size:13px;margin:0 0 10px;font-weight:700;display:flex;align-items:center}',
    '.clgroup small{font-weight:500;color:var(--muted);margin-left:6px}',

    '.muted{color:var(--muted)}',
    '.note{font-size:11px;color:var(--faint);margin-top:14px;line-height:1.6}',

    '.mapwrap{padding:14px;margin-bottom:16px}',
    'svg.pm-map{width:100%;height:auto;display:block}',
    '.pm-map .ocean{fill:#f3f5fc;stroke:#e7eaf5;stroke-width:1}',
    '.pm-map .island{fill:#dfe6fb;stroke:#c3cdf0;stroke-width:1}',
    '.pm-map .geo-line{stroke:#c3cce0;stroke-width:.8}',
    '.pm-map .geo-label{font-size:9.5px;font-weight:700;fill:var(--ink);paint-order:stroke;stroke:#fff;stroke-width:3}',
    '.pm-map .geo-dot{cursor:pointer}',
    '.pm-map .geo-dot circle{stroke:#fff;stroke-width:1.4;transition:r .12s}',
    '.pm-map .geo-dot:hover circle{r:6.5}',
    '.pm-map .geo-dot:hover .geo-label{fill:var(--accent-2)}',
    '.geolegend{margin-top:4px}',
    '.geo-meta{font-size:11px;color:var(--muted);margin-top:-4px;margin-bottom:2px}'
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
        '<div class="pm-header">' +
        '<div class="pm-mark">' + ICON_MARK + '</div>' +
        '<div class="pm-title"><h1>' + esc(opts.boardName || 'Pipeline') + '</h1>' +
        '<p>' + agg.grand.count + ' kartu · ' + agg.regions.length + ' region · diperbarui otomatis dari board Trello</p></div>' +
        '<div class="controls">' +
        '<select id="pm-brand" class="pm-select">' + brandOpts + '</select>' +
        '<button id="pm-csv" class="pm-btn">' + ICON_DOWNLOAD + ' Export CSV</button>' +
        '<button id="pm-refresh" class="pm-btn primary">' + ICON_REFRESH + ' Refresh</button>' +
        '</div></div>' +
        '<div class="tabs">' +
        '<button data-tab="matrix" class="' + (state.tab === 'matrix' ? 'active' : '') + '">Matriks</button>' +
        '<button data-tab="checklist" class="' + (state.tab === 'checklist' ? 'active' : '') + '">Progress Checklist</button>' +
        '<button data-tab="map" class="' + (state.tab === 'map' ? 'active' : '') + '">Peta</button>' +
        '</div>' +
        (state.tab === 'matrix'
          ? kpiHtml(agg) + '<div class="panel scroll">' + matrixHtml(agg) + '</div>' +
            '<div class="detail panel" id="pm-detail"><div class="detail-inner"><p class="muted">Klik salah satu angka di matriks untuk melihat daftar kartunya.</p></div></div>' +
            '<p class="note">Angka besar = jumlah kartu. Angka kecil + bar = rata-rata progress checklist. Kartu tanpa label bernomor masuk ke baris "Tanpa Region".</p>'
          : state.tab === 'checklist'
          ? '<div class="panel"><div class="detail-inner">' + checklistTabHtml(agg) + '</div></div>'
          : '<div class="panel">' + mapTabHtml(agg) + '</div>') +
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
          d.innerHTML = '<div class="detail-inner"><h2><span class="dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:8px;vertical-align:middle;background:' +
            dotColor(td.dataset.region) + '"></span>' + esc(td.dataset.region) + ' — ' + esc(td.dataset.stagename) +
            ' <span class="muted">(' + st.count + ' kartu' +
            (st.pct === null ? '' : ', kesiapan ' + st.pct + '%') + ')</span></h2>' + cardRowsHtml(st.cards) + '</div>';
          bindCardLinks(d);
          if (d.scrollIntoView) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        td.onclick = open;
        td.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
      });

      bindCardLinks(el);

      if (opts.onOpenCard) {
        Array.prototype.forEach.call(el.querySelectorAll('.geo-dot[data-card]'), function (g) {
          function openDot() { opts.onOpenCard(g.dataset.card); }
          g.onclick = openDot;
          g.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDot(); } };
        });
      }
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
    _helpers: {
      regionOf: regionOf, brandsOf: brandsOf, checklistOf: checklistOf, stripNumber: stripNumber, hueFor: hueFor,
      parseCoordToken: parseCoordToken, parseCardMeta: parseCardMeta, geoX: geoX, geoY: geoY
    }
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
