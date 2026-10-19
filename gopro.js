// Vidéo GoPro calée sur un GPX : lecture du GPS enregistré par la caméra dans le MP4
// (piste « gpmd », format GPMF) et correspondance distance du tracé → instant de la vidéo.
// Fonctions pures (testables sans navigateur), exposées dans window.TMGoPro (ou module.exports).
(function (root) {
  'use strict';

  // ---------- GPMF : clés de 4 lettres, type (1 octet), taille d'un élément (1), nombre (2), données alignées sur 4 octets ----------
  function readNum(dv, o, type) {
    switch (type) {
      case 'b': return dv.getInt8(o);
      case 'B': return dv.getUint8(o);
      case 's': return dv.getInt16(o);
      case 'S': return dv.getUint16(o);
      case 'l': return dv.getInt32(o);
      case 'L': return dv.getUint32(o);
      case 'f': return dv.getFloat32(o);
      case 'd': return dv.getFloat64(o);
      case 'j': return Number(dv.getBigInt64(o));
      case 'J': return Number(dv.getBigUint64(o));
      default: return 0;
    }
  }
  const SIZES = { b: 1, B: 1, s: 2, S: 2, l: 4, L: 4, f: 4, d: 8, j: 8, J: 8 };
  function readStr(u8, o, n) { let s = ''; for (let i = 0; i < n; i++) { const c = u8[o + i]; if (c) s += String.fromCharCode(c); } return s; }

  // Points GPS d'une charge GPMF (environ 1 s de vidéo) : [{lat, lon, ele}] dans l'ordre, déjà filtrés (fix, précision).
  // stats (facultatif) : stats.raw += nombre de mesures GPS avant filtrage (0 = pas de GPS du tout).
  function parseGpmf(u8, stats) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = [];
    (function walk(start, end, strm) {
      let o = start;
      while (o + 8 <= end) {
        const key = readStr(u8, o, 4), type = String.fromCharCode(u8[o + 4]), size = u8[o + 5], rep = dv.getUint16(o + 6);
        const len = size * rep, d = o + 8, next = d + Math.ceil(len / 4) * 4;
        if (!key || next > end + 3) break;
        if (u8[o + 4] === 0) { walk(d, Math.min(d + len, end), key === 'STRM' ? {} : strm); o = next; continue; }
        if (strm) {
          if (key === 'SCAL') { strm.scal = []; const es = SIZES[type] || 4; for (let i = 0; i < len / es; i++) strm.scal.push(readNum(dv, d + i * es, type)); }
          else if (key === 'TYPE') strm.type = readStr(u8, d, len);
          else if (key === 'GPSF') strm.fix = readNum(dv, d, type);
          else if (key === 'GPSP') strm.dop = readNum(dv, d, type);
          else if (key === 'GPS5' && type === 'l') {
            if (stats) stats.raw += rep;
            const sc = strm.scal || [1, 1, 1, 1, 1], ok = (strm.fix == null || strm.fix >= 2) && (strm.dop == null || strm.dop <= 500);
            if (ok) for (let i = 0; i < rep; i++) {
              const b = d + i * size, s = k => sc[Math.min(k, sc.length - 1)] || 1;
              out.push({ lat: dv.getInt32(b) / s(0), lon: dv.getInt32(b + 4) / s(1), ele: dv.getInt32(b + 8) / s(2) });
            }
          } else if (key === 'GPS9') {
            // HERO11 et suivantes : lat, lon, alt, vit. 2D, vit. 3D, jours, secondes, DOP, fix (TYPE « lllllllSS »)
            const tp = strm.type || 'lllllllSS', sc = strm.scal || [];
            if (stats) stats.raw += rep;
            for (let i = 0; i < rep; i++) {
              const v = []; let b = d + i * size;
              for (let k = 0; k < tp.length; k++) { v.push(readNum(dv, b, tp[k]) / (sc[k] || 1)); b += SIZES[tp[k]] || 4; }
              const fix = v[8], dop = v[7];
              if ((fix == null || fix >= 2) && (dop == null || dop <= 5)) out.push({ lat: v[0], lon: v[1], ele: v[2] });
            }
          }
        }
        o = next;
      }
    })(0, u8.length, null);
    return out.filter(p => isFinite(p.lat) && isFinite(p.lon) && (p.lat || p.lon));
  }

  // ---------- MP4 : boîtes (taille 4 octets, type 4 ; taille 1 = taille sur 8 octets) ----------
  function boxes(dv, start, end) {
    const list = []; let o = start;
    while (o + 8 <= end) {
      let size = dv.getUint32(o), hdr = 8; const type = String.fromCharCode(dv.getUint8(o + 4), dv.getUint8(o + 5), dv.getUint8(o + 6), dv.getUint8(o + 7));
      if (size === 1) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; } else if (size === 0) size = end - o;
      if (size < hdr) break;
      list.push({ type, start: o + hdr, end: Math.min(o + size, end) }); o += size;
    }
    return list;
  }
  const child = (dv, b, type) => boxes(dv, b.start, b.end).find(x => x.type === type);
  function path(dv, b, types) { for (const t of types) { if (!b) return null; b = child(dv, b, t); } return b; }

  // Lecture d'un fichier (File/Blob) : renvoie { dur (s), pts: [{t (s), lat, lon, ele}], track (piste de télémétrie présente), raw (mesures GPS avant filtrage) }.
  async function readMp4Gps(file, onProgress) {
    const slice = async (a, b) => new DataView(await file.slice(a, b).arrayBuffer());
    // boîte moov : au début ou à la fin du fichier, on saute les autres (mdat fait plusieurs Go)
    let o = 0, moov = null;
    while (o + 8 <= file.size) {
      const h = await slice(o, Math.min(o + 16, file.size)); let size = h.getUint32(0);
      const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
      if (size === 1) size = Number(h.getBigUint64(8)); else if (size === 0) size = file.size - o;
      if (size < 8) break;
      if (type === 'moov') { moov = await slice(o, o + size); break; }
      o += size;
    }
    if (!moov) throw new Error('fichier vidéo illisible (MP4 attendu)');
    const root = { start: 8, end: moov.byteLength };
    const mvhd = child(moov, root, 'mvhd');
    let dur = 0;
    if (mvhd) { const v = moov.getUint8(mvhd.start); dur = v ? Number(moov.getBigUint64(mvhd.start + 24)) / moov.getUint32(mvhd.start + 20) : moov.getUint32(mvhd.start + 16) / moov.getUint32(mvhd.start + 12); }
    let trak = null;
    for (const t of boxes(moov, root.start, root.end).filter(b => b.type === 'trak')) {
      const stsd = path(moov, t, ['mdia', 'minf', 'stbl', 'stsd']);
      if (stsd && stsd.end - stsd.start >= 16 && String.fromCharCode(...new Uint8Array(moov.buffer, stsd.start + 12, 4)) === 'gpmd') { trak = t; break; }
    }
    if (!trak) return { dur, pts: [], track: false, raw: 0 };   // pas de télémétrie (autre caméra, ou fichier réexporté)
    const mdhd = path(moov, trak, ['mdia', 'mdhd']), stbl = path(moov, trak, ['mdia', 'minf', 'stbl']);
    const mv = moov.getUint8(mdhd.start), scale = mv ? moov.getUint32(mdhd.start + 20) : moov.getUint32(mdhd.start + 12);
    const u32 = (b, i) => moov.getUint32(b.start + i);
    // durées des échantillons (stts), tailles (stsz), échantillons par bloc (stsc), position des blocs (stco / co64)
    const stts = child(moov, stbl, 'stts'), stsz = child(moov, stbl, 'stsz'), stsc = child(moov, stbl, 'stsc');
    const stco = child(moov, stbl, 'stco'), co64 = child(moov, stbl, 'co64');
    const n = u32(stsz, 8), fixed = u32(stsz, 4), sizes = [];
    for (let i = 0; i < n; i++) sizes.push(fixed || u32(stsz, 12 + i * 4));
    const deltas = []; for (let e = 0, c = u32(stts, 4); e < c; e++) { const k = u32(stts, 8 + e * 8), dl = u32(stts, 12 + e * 8); for (let j = 0; j < k; j++) deltas.push(dl); }
    const chunks = []; if (co64) { for (let i = 0, c = u32(co64, 4); i < c; i++) chunks.push(Number(moov.getBigUint64(co64.start + 8 + i * 8))); }
    else for (let i = 0, c = u32(stco, 4); i < c; i++) chunks.push(u32(stco, 8 + i * 4));
    const sc = []; for (let e = 0, c = u32(stsc, 4); e < c; e++) sc.push({ first: u32(stsc, 8 + e * 12), per: u32(stsc, 12 + e * 12) });
    const samples = []; let s = 0;
    for (let ci = 0; ci < chunks.length && s < n; ci++) {
      let per = 1; for (const e of sc) if (ci + 1 >= e.first) per = e.per;
      let off = chunks[ci];
      for (let j = 0; j < per && s < n; j++, s++) { samples.push({ off, size: sizes[s] }); off += sizes[s]; }
    }
    const pts = [], stats = { raw: 0 }; let t = 0;
    for (let i = 0; i < samples.length; i++) {
      const dt = (deltas[i] != null ? deltas[i] : deltas[deltas.length - 1] || scale) / scale;
      const u8 = new Uint8Array(await file.slice(samples[i].off, samples[i].off + samples[i].size).arrayBuffer());
      const g = parseGpmf(u8, stats);
      g.forEach((p, k) => pts.push({ t: t + dt * k / g.length, lat: p.lat, lon: p.lon, ele: p.ele }));
      t += dt;
      if (onProgress && i % 20 === 0) onProgress(i / samples.length);
    }
    return { dur: dur || t, pts, track: true, raw: stats.raw };
  }

  // ---------- correspondance distance du tracé → vidéo ----------
  const R = 6371000, rad = x => x * Math.PI / 180;
  function flatDist(a, b) { const x = rad(b.lon - a.lon) * Math.cos(rad((a.lat + b.lat) / 2)), y = rad(b.lat - a.lat); return R * Math.hypot(x, y); }

  // Projette chaque point GPS de la vidéo sur le tracé (toujours vers l'avant, fenêtre de 600 m, pour les allers-retours et les boucles).
  // track : [{d, lat, lon}] ; files : [{pts:[{t,lat,lon}], dur}] dans l'ordre de tournage.
  // Renvoie { map: [[d (m), fichier, t (s)], ...] tous les `step` m, d0, d1 } ou null si la vidéo ne suit pas le tracé.
  function buildVideoMap(track, files, step) {
    step = step || 5;
    const seq = []; files.forEach((f, fi) => f.pts.forEach(p => seq.push({ fi, t: p.t, lat: p.lat, lon: p.lon })));
    if (seq.length < 2 || track.length < 2) return null;
    // départ : parmi les points du tracé proches du premier point de la vidéo, le premier du parcours
    let best = Infinity; const dist0 = track.map(p => flatDist(p, seq[0]));
    dist0.forEach(v => { if (v < best) best = v; });
    let cur = dist0.findIndex(v => v <= best + 20);
    const proj = []; let off = 0;
    for (const p of seq) {
      let bi = cur, bd = Infinity;
      for (let i = Math.max(0, cur - 5); i < track.length && track[i].d <= track[cur].d + 600; i++) {
        const v = flatDist(track[i], p); if (v < bd) { bd = v; bi = i; }
      }
      if (bd > 150) { off++; continue; }   // hors du tracé (GPS perdu, détour) : ignoré
      cur = bi;
      const d = track[bi].d;
      if (!proj.length || d >= proj[proj.length - 1].d) proj.push({ d, fi: p.fi, t: p.t });
    }
    if (proj.length < 2 || off > seq.length * 0.5) return null;
    const d0 = proj[0].d, d1 = proj[proj.length - 1].d;
    if (d1 - d0 < 100) return null;
    // pour chaque distance : premier instant où la vidéo l'atteint (les arrêts filmés sont ainsi sautés)
    const map = []; let k = 0;
    for (let d = Math.ceil(d0 / step) * step; d <= d1; d += step) {
      while (k < proj.length - 1 && proj[k + 1].d < d) k++;
      const a = proj[k], b = proj[Math.min(k + 1, proj.length - 1)];
      let fi = a.fi, t = a.t;
      if (b !== a && b.fi === a.fi && b.d > a.d) t = a.t + (b.t - a.t) * (d - a.d) / (b.d - a.d);
      else if (b !== a && d >= b.d) { fi = b.fi; t = b.t; }
      map.push([d, fi, Math.round(t * 100) / 100]);
    }
    const last = proj[proj.length - 1];
    if (!map.length || map[map.length - 1][0] < d1) map.push([d1, last.fi, Math.round(last.t * 100) / 100]);
    return { map, d0, d1 };
  }

  // Sans GPS dans la vidéo : défilement proportionnel sur tout le tracé (fichiers mis bout à bout).
  function linearVideoMap(totalDist, files, step) {
    step = step || 5;
    const total = files.reduce((a, f) => a + f.dur, 0); if (!total || totalDist < 100) return null;
    const map = [];
    for (let d = 0; d <= totalDist; d += step) {
      let tt = d / totalDist * total, fi = 0;
      while (fi < files.length - 1 && tt > files[fi].dur) { tt -= files[fi].dur; fi++; }
      map.push([d, fi, Math.round(Math.min(tt, files[fi].dur) * 100) / 100]);
    }
    return { map, d0: 0, d1: totalDist };
  }

  // Calage manuel (comme l'import de Kinomap) : l'instant tA de la vidéo correspond au km d0 du tracé, tB à d1 ;
  // défilement régulier entre les deux. Les temps tA / tB sont comptés sur les fichiers mis bout à bout.
  function anchorVideoMap(files, tA, tB, d0, d1, step) {
    step = step || 5;
    if (!(tB > tA) || !(d1 - d0 >= 100)) return null;
    const map = [];
    for (let d = Math.ceil(d0 / step) * step; d <= d1; d += step) {
      let tt = tA + (d - d0) / (d1 - d0) * (tB - tA), fi = 0;
      while (fi < files.length - 1 && tt > files[fi].dur) { tt -= files[fi].dur; fi++; }
      map.push([d, fi, Math.round(Math.min(tt, files[fi].dur) * 100) / 100]);
    }
    if (!map.length || map[map.length - 1][0] < d1) {
      let tt = tB, fi = 0; while (fi < files.length - 1 && tt > files[fi].dur) { tt -= files[fi].dur; fi++; }
      map.push([d1, fi, Math.round(Math.min(tt, files[fi].dur) * 100) / 100]);
    }
    return { map, d0, d1 };
  }

  // Position dans la vidéo pour une distance du tracé : { fi, t, vs (vitesse de la vidéo à cet endroit, m/s) } ou null hors vidéo.
  function videoAt(v, d) {
    const m = v.map; if (!m || !m.length || d < m[0][0] || d > m[m.length - 1][0]) return null;
    let lo = 0, hi = m.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (m[mid][0] <= d) lo = mid; else hi = mid; }
    const a = m[lo], b = m[hi];
    let t = a[2], fi = a[1];
    if (b[1] === a[1] && b[0] > a[0]) t = a[2] + (b[2] - a[2]) * (d - a[0]) / (b[0] - a[0]);
    // vitesse de la vidéo : sur ±25 m autour du point, dans le même fichier
    const w = Math.max(1, Math.round(25 / ((m[1] ? m[1][0] - m[0][0] : 5) || 5)));
    let p = m[Math.max(0, lo - w)], q = m[Math.min(m.length - 1, lo + w)];
    if (p[1] !== q[1]) { if (p[1] !== a[1]) p = a; else q = a; }   // changement de fichier : on reste du côté du point courant
    const vs = (p[1] === q[1] && q[2] > p[2]) ? (q[0] - p[0]) / (q[2] - p[2]) : 0;
    return { fi, t, vs };
  }

  const api = { VERSION: '2026.10.19-2', parseGpmf, readMp4Gps, buildVideoMap, linearVideoMap, anchorVideoMap, videoAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TMGoPro = api;
})(typeof window !== 'undefined' ? window : globalThis);
