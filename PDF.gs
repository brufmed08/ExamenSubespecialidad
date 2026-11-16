/* Generador de PDF mínimo (sin dependencias) — Node y Google Apps Script.
   Soporta acentos (WinAnsi), varias "partes" en un mismo archivo (actas consolidadas),
   párrafos, listas, tablas con saltos de página, hoja de firmas autógrafas y bloques de firma. */
var PDFBuilder = (function () {
  var W = 595.28, H = 841.89, M = 56, maxW = W - M * 2;

  function cp1252(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i), b = 63;
      if (c < 128) b = c;
      else if (c <= 255) b = c;
      else {
        var map = { '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '…': 133, '€': 128, '™': 153, '·': 183 };
        b = map[str[i]] || 63;
      }
      out.push(b);
    }
    return out;
  }
  function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
  function width(text, size, bold, italic) {
    var w = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if ('iljI.,:;!|()[]\'`'.indexOf(c) >= 0) w += 0.29;
      else if ('mwMW'.indexOf(c) >= 0) w += 0.83;
      else if (c === ' ') w += 0.28;
      else if (c >= 'A' && c <= 'Z') w += 0.66;
      else w += 0.52;
    }
    return w * size * (bold ? 1.045 : (italic ? 0.98 : 1));
  }
  function wrap(text, maxWid, size, bold, italic) {
    var words = String(text == null ? '' : text).split(/\s+/), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (width(t, size, bold, italic) > maxWid && cur) { lines.push(cur); cur = words[i]; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function fit(text, maxWid, size, bold, italic) {
    var s = String(text == null ? '' : text);
    if (width(s, size, bold, italic) <= maxWid) return s;
    while (s.length > 1 && width(s + '…', size, bold, italic) > maxWid) s = s.slice(0, -1);
    return s + '…';
  }

  /* doc = {parts:[part,...]}  ó  doc = {title,...sections} (una sola parte)
     part = {eyebrow, title, subtitle, meta:[], sections:[], headerLine, footer, compact}
     section = {h, newPage?, items:[...]}
     item: {t:'p'|'li'|'note'|'table'|'att'|'sig'|'spacer'} */
  function build(doc) {
    var pages = [], cur = [], y = H - M, parts = doc.parts || [doc], footerMode = doc.footer || '';

    function put(s, size, font, color, x, yy) {
      cur.push('BT /' + font + ' ' + size + ' Tf ' + color + ' rg 1 0 0 1 ' + x.toFixed(2) + ' ' + yy.toFixed(2) + ' Tm (' + esc(s) + ') Tj ET');
    }
    function line(x1, y1, x2, y2, w, color) { cur.push(w + ' w ' + color + ' RG ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' m ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' l S'); }
    function box(x, yy, w, hh, color) { cur.push(color + ' rg ' + x.toFixed(2) + ' ' + yy.toFixed(2) + ' ' + w.toFixed(2) + ' ' + hh.toFixed(2) + ' re f'); }

    var head = null;
    function startPage(forceNew) {
      if (cur.length || pages.length) { pages.push(cur); cur = []; }
      y = H - M;
      if (head && (pages.length > 0 || forceNew)) {
        put(head, 7.6, 'F1', '0.45 0.53 0.58', M, H - M + 16);
        line(M, H - M + 9, W - M, H - M + 9, 0.6, '0.80 0.86 0.88');
        y = H - M - 22;
      }
    }
    function need(hh) { if (y - hh < M + 30) { startPage(false); return true; } return false; }

    function drawBand(p) {
      var compact = !!p.compact, band = compact ? 96 : 142;
      box(0, H - band, W, band, '0.043 0.129 0.188');
      box(0, H - band - 6, W, 6, '0.059 0.435 0.427');
      if (p.eyebrow) put(fit(p.eyebrow, maxW, 7.6), 7.6, 'F1', '0.42 0.74 0.71', M, H - (compact ? 24 : 26));
      put(fit(p.title, maxW, compact ? 16.5 : 19, true), compact ? 16.5 : 19, 'F2', '1 1 1', M, H - (compact ? 50 : 54));
      if (p.subtitle) put(fit(p.subtitle, maxW, compact ? 9.4 : 10.5), compact ? 9.4 : 10.5, 'F1', '0.72 0.84 0.88', M, H - (compact ? 68 : 76));
      y = H - band - 30;
    }

    function drawTable(spec) {
      var ws = spec.widths, tot = 0, i;
      for (i = 0; i < ws.length; i++) tot += ws[i];
      var k = maxW / tot, CW = ws.map(function (w) { return w * k; });
      var size = spec.size || 8.2, pad = 3.4, lh = size + 3.2;
      var align = spec.align || {}, ital = spec.italicCols || [];
      function rowHeight(cells) {
        var max = 1;
        for (var j = 0; j < cells.length; j++) {
          var t = cells[j] == null || cells[j] === '' ? '—' : String(cells[j]);
          var n = wrap(t, CW[j] - pad * 2, size, false, ital.indexOf(j) >= 0).length;
          if (n > max) max = n;
        }
        return max * lh + pad * 2;
      }
      function drawRow(cells, isHead) {
        var hh = rowHeight(cells);
        need(hh + 2);
        var yTop = y;
        if (isHead) box(M, yTop - hh, maxW, hh, '0.078 0.231 0.318');
        for (var j = 0; j < cells.length; j++) {
          var x = M, s = 0;
          for (var q = 0; q < j; q++) x += CW[q];
          var val = cells[j] == null || cells[j] === '' ? (isHead ? '' : '—') : String(cells[j]);
          var italic = ital.indexOf(j) >= 0, font = italic ? 'F3' : (isHead ? 'F2' : 'F1');
          var col = isHead ? '1 1 1' : (italic ? '0.06 0.24 0.32' : '0.12 0.20 0.25');
          var lines = wrap(val, CW[j] - pad * 2, size, isHead, italic);
          for (var li = 0; li < lines.length; li++) {
            var tx = x + pad, al = align[j] || (isHead ? 'c' : 'l');
            if (al === 'c') tx = x + (CW[j] - width(lines[li], size, isHead, italic)) / 2;
            if (al === 'r') tx = x + CW[j] - pad - width(lines[li], size, isHead, italic);
            put(lines[li], size, font, col, tx, yTop - pad - size - li * lh);
          }
          if (j > 0) line(x, yTop, x, yTop - hh, 0.4, '0.84 0.88 0.90');
        }
        line(M, yTop - hh, W - M, yTop - hh, 0.55, '0.72 0.78 0.81');
        y = yTop - hh;
      }
      drawRow(spec.head, true);
      for (var r = 0; r < spec.rows.length; r++) {
        if (y - rowHeight(spec.rows[r]) < M + 30) { startPage(false); drawRow(spec.head, true); }
        drawRow(spec.rows[r], false);
      }
      y -= 4;
    }

    /* Hoja de asistencia: un renglón en blanco por sustentante para firma autógrafa */
    function drawAtt(spec) {
      var cols = spec.cols, tot = 0, i;
      for (i = 0; i < cols.length; i++) tot += cols[i].w;
      var k = maxW / tot, CW = cols.map(function (c) { return c.w * k; });
      var size = 8.6, rh = spec.rowH || 34, pad = 4;
      function headRow() {
        var yTop = y;
        box(M, yTop - 20, maxW, 20, '0.078 0.231 0.318');
        var x = M;
        for (var j = 0; j < cols.length; j++) {
          put(fit(cols[j].h, CW[j] - 6, 7.6, true), 7.6, 'F2', '1 1 1', x + 4, yTop - 13);
          x += CW[j];
        }
        line(M, yTop - 20, W - M, yTop - 20, 0.55, '0.55 0.62 0.67');
        y = yTop - 20;
      }
      need(20 + rh * 3);
      headRow();
      for (var r = 0; r < spec.rows.length; r++) {
        if (y - rh < M + 30) { startPage(false); headRow(); }
        var yTop = y, x = M, row = spec.rows[r];
        for (var j = 0; j < cols.length; j++) {
          var val = row[j] == null ? '' : String(row[j]);
          var al = cols[j].align || 'l';
          var tx = x + 4;
          if (al === 'c') tx = x + (CW[j] - width(val, size, false)) / 2;
          put(fit(val, CW[j] - 8, size, false), size, 'F1', '0.12 0.20 0.25', tx, yTop - 15);
          if (j > 0) line(x, yTop, x, yTop - rh, 0.4, '0.84 0.88 0.90');
          x += CW[j];
        }
        // línea de firma del último renglón es el borde inferior
        line(M, yTop - rh, W - M, yTop - rh, 0.55, '0.62 0.68 0.72');
        y = yTop - rh;
      }
      y -= 6;
    }

    function drawSigs(spec) {
      var cols = spec.cols || 2, gap = 18, cw = (maxW - gap * (cols - 1)) / cols;
      var blocks = spec.blocks || [];
      for (var i = 0; i < blocks.length; i += cols) {
        need(86);
        var rowTop = y - 46;
        for (var j = 0; j < cols && i + j < blocks.length; j++) {
          var b = blocks[i + j], x = M + j * (cw + gap);
          line(x, rowTop, x + cw, rowTop, 0.8, '0.25 0.32 0.37');
          put(fit(b.nombre || '________________________', cw, 9.2), 9.2, 'F2', '0.10 0.18 0.23', x, rowTop - 13);
          if (b.cargo) put(fit(b.cargo, cw, 7.8), 7.8, 'F1', '0.40 0.48 0.54', x, rowTop - 24);
          if (b.detalle) put(fit(b.detalle, cw, 7.2), 7.2, 'F1', '0.48 0.56 0.62', x, rowTop - 34);
        }
        y = rowTop - 46;
      }
    }

    function drawSection(s) {
      if (s.newPage) startPage(true);
      need(40);
      y -= 22;
      box(M, y - 6, maxW, 20, '0.886 0.949 0.945');
      put(s.h, 11.5, 'F2', '0.039 0.435 0.42', M + 8, y);
      y -= 8;
      (s.items || []).forEach(function (it) {
        if (it.t === 'table') return drawTable(it);
        if (it.t === 'att') return drawAtt(it);
        if (it.t === 'sig') return drawSigs(it);
        if (it.t === 'spacer') { y -= (it.h || 10); return; }
        var size = it.t === 'note' ? 8.9 : 9.8, color = it.t === 'note' ? '0.38 0.47 0.54' : '0.13 0.21 0.26';
        var txt = it.t === 'li' ? '•  ' + it.text : it.text;
        wrap(txt, maxW - (it.t === 'li' ? 12 : 0), size).forEach(function (l) {
          need(size * 1.5); y -= size * 1.45;
          put(l, size, 'F1', color, M + (it.t === 'li' ? 12 : 0), y);
        });
      });
      y -= 6;
    }

    parts.forEach(function (p, pi) {
      startPage(true);
      head = p.headerLine || '';
      drawBand(p);
      (p.meta || []).forEach(function (m) {
        wrap(m, maxW, 9.6).forEach(function (l) { need(14); y -= 13; put(l, 9.6, 'F1', '0.28 0.36 0.42', M, y); });
      });
      (p.sections || []).forEach(drawSection);
      p.__footer = p.footer || footerMode || 'Sistema de evaluación de subespecialidades pediátricas';
    });
    pages.push(cur);
    head = '';

    // pie de página por parte (se recalcula el rango de páginas de cada parte)
    var total = pages.length;
    var footers = [];
    var acc = 0;
    parts.forEach(function (p) { footers.push({ from: acc, text: p.__footer }); acc = 0; });
    pages.forEach(function (pg, i) {
      var ft = footerMode || 'Sistema de evaluación de subespecialidades pediátricas';
      pg.push('BT /F1 7.2 Tf 0.52 0.60 0.65 rg 1 0 0 1 ' + M + ' ' + (M - 26) + ' Tm (' + esc(ft) + ') Tj ET');
      var pn = 'Página ' + (i + 1) + ' de ' + total;
      pg.push('BT /F1 7.2 Tf 0.52 0.60 0.65 rg 1 0 0 1 ' + (W - M - width(pn, 7.2)) + ' ' + (M - 26) + ' Tm (' + esc(pn) + ') Tj ET');
    });

    var objs = {}, i2;
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    var kids = [];
    for (i2 = 0; i2 < pages.length; i2++) kids.push((4 + i2) + ' 0 R');
    objs[2] = '<< /Type /Pages /Count ' + pages.length + ' /Kids [' + kids.join(' ') + '] >>';
    objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objs[99] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    objs[98] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>';
    pages.forEach(function (lines, i) {
      var stream = lines.join('\n');
      objs[4 + pages.length + i] = '<< /Length ' + cp1252(stream).length + ' >>\nstream\n' + stream + '\nendstream';
      objs[4 + i] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 3 0 R /F2 99 0 R /F3 98 0 R >> >> /Contents ' + (4 + pages.length + i) + ' 0 R >>';
    });
    var hd = '%PDF-1.4\n', pos = hd.length, offsets = {}, keys = Object.keys(objs).map(Number).sort(function (a, b) { return a - b; }), body = '';
    keys.forEach(function (kk) { offsets[kk] = pos; var chunk = kk + ' 0 obj\n' + objs[kk] + '\nendobj\n'; body += chunk; pos += cp1252(chunk).length; });
    var xrefPos = pos, maxObj = Math.max.apply(null, keys) + 1;
    var xref = 'xref\n0 ' + maxObj + '\n0000000000 65535 f \n';
    for (i2 = 1; i2 < maxObj; i2++) xref += (offsets[i2] ? String(offsets[i2]).padStart(10, '0') : '0000000000') + ' 00000 n \n';
    var full = hd + body + xref + 'trailer\n<< /Size ' + maxObj + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';
    return new Uint8Array(cp1252(full));
  }

  /* ---------- Parte de acta por subespecialidad ---------- */
  function actaPart(d) {
    var head = ['No.', 'Matrícula', 'Nombre completo (apellidos, nombre)', 'Aciertos', 'Calificación', 'Estatus', 'Consent.', 'Confid.', 'Firma electrónica registrada'];
    var rows = [], n = 0;
    d.rows.forEach(function (r) {
      if (!d.incluirPendientes && r.calificacion == null) return;
      n++;
      rows.push([String(n), r.matricula, r.nombre,
        r.aciertos == null ? '—' : (r.aciertos + '/' + r.total),
        r.calificacion == null ? '—' : String(r.calificacion),
        r.estatus, r.consent ? 'Sí' : 'No', r.confid ? 'Sí' : 'No', r.firma || '—']);
    });
    if (!rows.length) rows = [['—', '—', 'Sin sustentantes registrados en esta subespecialidad', '—', '—', '—', '—', '—', '—']];
    var att = [];
    d.rows.forEach(function (r, i) {
      att.push([String(i + 1), r.nombre, r.matricula, '', '']);
    });
    var r0 = d.resumen || {};
    return {
      compact: true,
      eyebrow: 'EVALUACIÓN DE SUBESPECIALIDADES PEDIÁTRICAS · REGISTRO DE CONTROL INTERNO',
      title: 'Acta de evaluación por subespecialidad',
      subtitle: d.especialidad + ' · Documento de control interno y resguardo',
      meta: (function () {
        var m = ['Folio del acta: ' + d.actaFolio, 'Fecha de emisión: ' + d.fecha,
          'Reactivos aplicados: ' + (r0.reactivos || '—') + ' · Calificación mínima aprobatoria: ' + d.minimo + ' de 100',
          'Documento generado por el sistema a partir del registro electrónico de respuestas y de las firmas capturadas.'];
        if (d.reimpresion) m.push('Reimpresión · Ejemplar generado el ' + d.reimpresion.fecha + ' (reimpresión número ' + d.reimpresion.veces + '). Conserva el folio, la fecha de emisión y la huella de verificación del documento original.');
        return m;
      })(),
      headerLine: 'Acta de evaluación · ' + d.especialidad + ' · Folio ' + d.actaFolio,
      footer: 'Acta de evaluación · ' + d.especialidad + ' · Folio ' + d.actaFolio,
      sections: [
        { h: 'Relación de sustentantes', items: [{ t: 'table', head: head, rows: rows, widths: [16, 50, 120, 40, 44, 52, 36, 32, 96], align: { 0: 'c', 1: 'c', 3: 'c', 4: 'c', 5: 'c', 6: 'c', 7: 'c' }, italicCols: [8], size: 8 }] },
        { h: 'Resumen', items: [{ t: 'p', text: 'Sustentantes considerados: ' + (r0.total || 0) + '  ·  Aprobados: ' + (r0.aprobados || 0) + '  ·  No aprobados: ' + (r0.noAprobados || 0) + '  ·  Pendientes de examen: ' + (r0.pendientes || 0) + '  ·  Promedio: ' + (r0.promedio == null ? '—' : r0.promedio) },
          { t: 'note', text: 'Calificación mínima aprobatoria: ' + d.minimo + ' de 100. La calificación se calcula de forma automática, proporcional al número de reactivos correctos.' }] },
        { h: 'Datos del registro', items: [
          { t: 'p', text: 'Este documento reproduce información del registro electrónico de la evaluación: fecha y hora de emisión del resultado, respuestas capturadas por cada sustentante, calificación calculada por el sistema y las firmas electrónicas registradas antes y después del examen.' },
          { t: 'p', text: 'Cada sustentante registró, antes de iniciar la prueba, la aceptación de las condiciones de aplicación y del carácter definitivo del resultado, y al concluir registró un acuerdo de confidencialidad sobre el contenido del examen. Las constancias de esas firmas quedan resguardadas en el sistema.' },
          { t: 'note', text: 'Naturaleza del documento · Este acta es un registro administrativo de control interno. No constituye por sí misma una certificación oficial, un título, una constancia de acreditación ni un documento con efectos jurídicos, y no sustituye los documentos que la institución emita conforme a sus procedimientos. Su contenido se pone a disposición del área jurídica y de las autoridades académicas para su revisión, validación y, en su caso, formalización. · Folio: ' + d.actaFolio + ' · Huella de verificación (SHA-256): ' + d.sello + ' · Generada el ' + d.fecha },
          { t: 'note', text: 'La huella de verificación permite comprobar que el contenido del archivo no ha sido modificado después de su generación; no acredita por sí misma la autenticidad de los datos de origen.' }
        ] },
        { h: 'Hoja de firmas de asistencia', newPage: true, items: [
          { t: 'p', text: 'Cada sustentante firma de su puño y letra en el renglón que le corresponde, como constancia de su asistencia y de haber recibido la explicación de las condiciones de la evaluación.' },
          { t: 'spacer', h: 6 },
          { t: 'att', cols: [{ h: 'No.', w: 26, align: 'c' }, { h: 'Nombre completo (apellidos, nombre)', w: 190 }, { h: 'Matrícula', w: 62 }, { h: 'Firma autógrafa', w: 165 }, { h: 'Fecha', w: 62 }], rows: att, rowH: 40 },
          { t: 'spacer', h: 14 },
          { t: 'note', text: 'Los renglones sin firma se consideran no asistidos. Este documento no debe firmarse en blanco ni con anticipación a la aplicación del examen.' }
        ] }
      ].concat((d.constancias || []).map(function (c) {
        var cp = constanciaPart(c);
        return { h: 'Constancia de corrección · folio ' + c.folio, newPage: true, items: cp.sections[0].items.concat([{ t: 'spacer', h: 8 }], cp.sections[1].items) };
      })).concat([
        { h: 'Firmas de las autoridades', items: [{ t: 'sig', cols: 2, blocks: d.firmas }] }
      ])
    };
  }

  /* ---------- Constancia de corrección de calificación ---------- */
  function constanciaPart(c) {
    var head = ['No.', 'Matrícula', 'Nombre completo', 'Calificación anterior', 'Aciertos anteriores', 'Calificación nueva', 'Aciertos nuevos', 'Estatus resultante'];
    var rows = c.rows.map(function (r, i) {
      return [String(i + 1), r.matricula, r.nombre,
        String(r.antes.calificacion), String(r.antes.aciertos) + '/' + (r.total || ''),
        String(r.despues.calificacion), String(r.despues.aciertos) + '/' + (r.total || ''),
        r.despues.estatus];
    });
    if (!rows.length) rows = [['—', '—', 'Sin registros', '—', '—', '—', '—', '—']];
    return {
      compact: true,
      eyebrow: 'EVALUACIÓN DE SUBESPECIALIDADES PEDIÁTRICAS · CONTROL INTERNO',
      title: 'Constancia de corrección de calificación',
      subtitle: (c.especialidadNombre || 'Todas las subespecialidades') + ' · Documento de control interno y resguardo',
      meta: ['Folio de la constancia: ' + c.folio, 'Fecha de emisión: ' + c.fecha,
        'Exámenes corregidos: ' + c.rows.length + ' · Calificación mínima aprobatoria: ' + c.minimo + ' de 100',
        'Motivo asentado: ' + c.motivo,
        'Corrección autorizada por: ' + c.usuario],
      headerLine: 'Constancia de corrección · Folio ' + c.folio,
      footer: 'Constancia de corrección · Folio ' + c.folio,
      sections: [
        { h: 'Calificaciones corregidas', items: [{ t: 'table', head: head, rows: rows, widths: [20, 60, 150, 62, 56, 54, 50, 76], align: { 0: 'c', 1: 'c', 3: 'c', 4: 'c', 5: 'c', 6: 'c', 7: 'c' }, size: 8.2 }] },
        { h: 'Descripción de la corrección', items: [
          { t: 'p', text: c.descripcion || 'Se recalcularon las calificaciones a partir de las respuestas que cada sustentante registró en el sistema. Las respuestas no fueron modificadas; únicamente se corrigió el cálculo que el sistema había realizado.' },
          { t: 'p', text: 'La corrección se aplicó a la totalidad de los exámenes afectados por el mismo defecto y no fue solicitada por ningún sustentante ni derivada de una revisión de su desempeño.' },
          { t: 'note', text: 'Trazabilidad · El valor anterior y el nuevo de cada examen, junto con el usuario que autorizó la corrección y la fecha, quedan asentados en la bitácora de auditoría del sistema. Los documentos emitidos con anterioridad conservan su folio y no se destruyen.' },
          { t: 'note', text: 'Naturaleza del documento · Registro administrativo de control interno. No constituye certificación oficial ni documento con efectos jurídicos; se somete a la revisión del área jurídica y de las autoridades académicas de la institución.' }
        ] }
      ]
    };
  }

  /* ---------- Hoja de asistencia general (expediente) ---------- */
  function asistenciaGeneralPart(a) {
    var rows = a.rows.map(function (r, i) { return [String(i + 1), r.nombre, r.matricula, r.especialidad, '', '']; });
    return {
      compact: true,
      eyebrow: 'EVALUACIÓN DE SUBESPECIALIDADES PEDIÁTRICAS · EXPEDIENTE',
      title: 'Hoja de asistencia general',
      subtitle: 'Sustentantes de las cinco subespecialidades · Documento de control interno',
      meta: ['Folio del expediente: ' + a.folio, 'Fecha de emisión: ' + a.fecha, 'Sustentantes listados: ' + a.rows.length],
      headerLine: 'Asistencia general · Folio ' + a.folio,
      footer: 'Asistencia general · Folio ' + a.folio,
      sections: [
        { h: 'Firmas de asistencia', items: [
          { t: 'p', text: 'Cada sustentante firma de su puño y letra en el renglón que le corresponde, como constancia de su asistencia a la evaluación y de haber recibido la explicación de sus condiciones.' },
          { t: 'spacer', h: 6 },
          { t: 'att', cols: [{ h: 'No.', w: 24, align: 'c' }, { h: 'Nombre completo (apellidos, nombre)', w: 150 }, { h: 'Matrícula', w: 52 }, { h: 'Subespecialidad', w: 88 }, { h: 'Firma autógrafa', w: 130 }, { h: 'Fecha', w: 44 }], rows: rows, rowH: 34 },
          { t: 'spacer', h: 12 },
          { t: 'note', text: 'Los renglones sin firma se consideran no asistidos. Este documento no debe firmarse en blanco ni con anticipación a la aplicación del examen.' }
        ] }
      ]
    };
  }

  /* ---------- Hoja de corte de numeración (expediente) ---------- */
  function cortePart(c) {
    var head = ['No.', 'Documento', 'Subespecialidad', 'Último folio antes del corte', 'Folio inicial tras el corte', 'Fecha y hora del corte', 'Autorizó'];
    var rows = [], n = 0;
    (c.cortes || []).forEach(function (k) {
      (k.rows || []).forEach(function (r) {
        n++;
        rows.push([String(n), r.etiqueta || '—', r.especialidad || 'Serie global', r.folioAnterior || '—', r.folioInicial || '—', k.fecha, k.usuario || '—']);
      });
    });
    if (!rows.length) rows = [['—', '—', '—', '—', '—', '—', '—']];
    return {
      compact: true,
      eyebrow: 'EVALUACIÓN DE SUBESPECIALIDADES PEDIÁTRICAS · EXPEDIENTE',
      title: 'Hoja de corte de numeración',
      subtitle: 'Reinicio de series de folios · Documento de control interno',
      meta: ['Folio del expediente: ' + c.folio, 'Fecha de emisión: ' + c.fecha,
        'Cortes asentados: ' + (c.cortes || []).length + ' · Calificación mínima aprobatoria: ' + c.minimo + ' de 100'],
      headerLine: 'Hoja de corte de numeración · Expediente ' + c.folio,
      footer: 'Hoja de corte · Expediente ' + c.folio,
      sections: [
        { h: 'Cortes asentados', items: [
          { t: 'p', text: 'La siguiente relación asienta cada reinicio de numeración autorizado en el sistema durante el ciclo en curso, con el último folio emitido antes del corte, el folio inicial de la nueva serie, la fecha y hora del corte y el usuario que lo autorizó.' },
          { t: 'spacer', h: 4 },
          { t: 'table', head: head, rows: rows, widths: [20, 92, 90, 88, 84, 74, 38], align: { 0: 'c', 3: 'c', 4: 'c', 5: 'c' }, size: 7.8 }
        ] },
        { h: 'Efecto del corte', items: [
          { t: 'p', text: 'A partir de la fecha y hora asentadas, la serie indicada reinició su numeración en el folio inicial señalado. Los documentos emitidos con anterioridad conservan el folio que se les asignó en el momento de su emisión: no fueron renumerados, destruidos ni sustituidos, y siguen resguardados en el sistema.' },
          { t: 'p', text: 'Consecuencia que debe considerarse al interpretar el expediente: pueden existir dos documentos distintos con el mismo número de folio, uno anterior y otro posterior al corte. Para distinguirlos deben considerarse la subespecialidad, la fecha y hora de emisión impresas en cada documento y su huella de verificación (SHA-256).' },
          { t: 'note', text: 'Recomendación de control interno · No reiniciar la numeración dentro de un mismo ciclo de evaluación. El reinicio debe usarse al abrir un ciclo nuevo (otra generación, otro curso u otro periodo) y asentarse por escrito en el expediente correspondiente. · Folio del expediente: ' + c.folio + ' · Huella de verificación (SHA-256): ' + c.sello }
        ] }
      ]
    };
  }

  /* ---------- Registro de actas emitidas (expediente) ---------- */
  function registroActasPart(r) {
    var head = ['No.', 'Folio del acta', 'Subespecialidad', 'Fecha de emisión', 'Huella de verificación (SHA-256)', 'Reimpr.', 'Última reimpresión', 'Estado'];
    var rows = (r.rows || []).map(function (x, i) {
      return [String(i + 1), x.folio, x.especialidad, x.fecha, x.sello, String(x.reimpresiones || 0),
        x.ultimaReimpresion || '—', x.reimpresiones ? 'Original con reimpresiones' : 'Original'];
    });
    if (!rows.length) rows = [['—', '—', 'Sin actas registradas', '—', '—', '—', '—', '—']];
    return {
      compact: true,
      eyebrow: 'EVALUACIÓN DE SUBESPECIALIDADES PEDIÁTRICAS · EXPEDIENTE',
      title: 'Registro de actas emitidas',
      subtitle: 'Folio, fecha y huella de cada acta · Documento de control interno',
      meta: ['Folio del expediente: ' + r.folio, 'Fecha de emisión del expediente: ' + r.fecha,
        'Actas registradas: ' + (r.rows || []).length + ' · Reimpresiones acumuladas: ' + (r.reimpresiones || 0)],
      headerLine: 'Registro de actas emitidas · Expediente ' + r.folio,
      footer: 'Registro de actas · Expediente ' + r.folio,
      sections: [
        { h: 'Actas emitidas', items: [
          { t: 'p', text: 'Cada acta recibe su folio y su fecha en la primera emisión y los conserva en toda reimpresión del mismo contenido. La columna de reimpresiones indica cuántas veces se generó de nuevo el mismo documento sin cambiar su folio, su fecha ni su huella.' },
          { t: 'spacer', h: 4 },
          { t: 'table', head: head, rows: rows, widths: [18, 92, 80, 68, 108, 34, 68, 72], align: { 0: 'c', 5: 'c' }, size: 7.6 }
        ] },
        { h: 'Lectura del registro', items: [
          { t: 'p', text: 'Una reimpresión no es un documento nuevo: es el mismo acto jurídico-administrativo reproducido. Por eso comparte folio, fecha de emisión original y huella de verificación con el ejemplar impreso la primera vez.' },
          { t: 'note', text: 'Si el contenido del acta cambia —por ejemplo, porque se incorpora un sustentante o se corrige una calificación— el sistema emite un acta nueva, con folio nuevo y huella nueva. La distinción entre reimpresión y acta nueva es la que evita confusiones al confrontar ejemplares. · Folio del expediente: ' + r.folio }
        ] }
      ]
    };
  }

  /* ---------- Documento individual ---------- */
  function buildActa(d) { return build(actaPart(d)); }
  function buildConstancia(c) { return build(constanciaPart(c)); }

  /* ---------- Consolidado de las cinco actas ---------- */
  function buildConsolidado(d) {
    // d = {fecha, folio, sello, minimo, actas:[{...misma estructura que buildActa...}], resumenGlobal}
    var idx = [['No.', 'Subespecialidad', 'React.', 'Sustent.', 'Aprob.', 'No aprob.', 'Pend.', 'Folio del acta']];
    d.actas.forEach(function (a, i) {
      var r = a.resumen || {};
      idx.push([String(i + 1), a.especialidad, String(r.reactivos || '—'), String(r.total || 0), String(r.aprobados || 0), String(r.noAprobados || 0), String(r.pendientes || 0), a.actaFolio]);
    });
    var g = d.resumenGlobal || {};
    var cover = {
      eyebrow: 'EVALUACIÓN DE SUBESPECIALIDADES PEDIÁTICAS · EXPEDIENTE',
      title: 'Expediente consolidado de actas',
      subtitle: 'Cinco subespecialidades · Documento de control interno y resguardo',
      meta: ['Folio del expediente: ' + d.folio, 'Fecha de emisión: ' + d.fecha,
        'Actas incluidas: ' + d.actas.length + ' · Calificación mínima aprobatoria: ' + d.minimo + ' de 100'],
      headerLine: 'Expediente consolidado · Folio ' + d.folio,
      footer: 'Expediente consolidado · Folio ' + d.folio,
      sections: [
        { h: 'Contenido del expediente', items: [{ t: 'table', head: idx[0], rows: idx.slice(1), widths: [24, 156, 40, 50, 44, 54, 40, 104], align: { 0: 'c', 2: 'c', 3: 'c', 4: 'c', 5: 'c', 6: 'c' }, size: 8.4 }] },
        { h: 'Resumen general', items: [{ t: 'p', text: 'Sustentantes registrados: ' + (g.total || 0) + '  ·  Aprobados: ' + (g.aprobados || 0) + '  ·  No aprobados: ' + (g.noAprobados || 0) + '  ·  Pendientes: ' + (g.pendientes || 0) + '  ·  Promedio general: ' + (g.promedio == null ? '—' : g.promedio) },
          { t: 'note', text: 'Cada acta que integra este expediente conserva su propio folio y su huella de verificación. El expediente es un registro administrativo de control interno y no sustituye los documentos que la institución emita conforme a sus procedimientos.' }] },
        { h: 'Nota para revisión jurídica', items: [{ t: 'note', text: 'Este expediente se entrega para revisión y validación por el área jurídica y las autoridades académicas. Las firmas autógrafas de la hoja de asistencia se recaban en papel; las firmas electrónicas de consentimiento y confidencialidad se registran en el sistema con fecha, hora y huella digital. La institución determina el alcance y la formalización de estos registros.' }] }
      ]
    };
    if (d.registroActas && d.registroActas.length) {
      cover.sections.push({ h: 'Registro de actas emitidas', items: [
        { t: 'p', text: 'El expediente incluye el registro de las ' + d.registroActas.length + ' actas emitidas, con su folio, su fecha de emisión y su huella de verificación, indicando cuántas reimpresiones tiene cada una.' },
        { t: 'note', text: 'Una reimpresión conserva el folio, la fecha y la huella del original por tratarse del mismo documento. Un acta con contenido distinto —otro sustentante u otra calificación— recibe folio nuevo.' }
      ] });
    }
    if (d.cortes && d.cortes.length) {
      cover.sections.push({ h: 'Cortes de numeración', items: [
        { t: 'p', text: 'Este expediente incluye la hoja de corte de numeración: se asentaron ' + d.cortes.length + ' reinicio(s) de serie durante el ciclo, con el último folio emitido y el folio inicial de la nueva serie.' },
        { t: 'note', text: 'Los documentos emitidos antes de cada corte conservan su folio original y no fueron renumerados; por ello pueden existir dos documentos con el mismo número de folio, uno anterior y otro posterior al corte. La hoja de corte permite identificarlos por fecha y hora de emisión.' }
      ] });
    }
    var parts = [cover];
    if (d.cortes && d.cortes.length) parts.push(cortePart({ folio: d.folio, fecha: d.fecha, minimo: d.minimo, sello: d.sello, cortes: d.cortes }));
    if (d.registroActas && d.registroActas.length) {
      parts.push(registroActasPart({ folio: d.folio, fecha: d.fecha, minimo: d.minimo,
        rows: d.registroActas, reimpresiones: d.registroActas.reduce(function (s2, x) { return s2 + (x.reimpresiones || 0); }, 0) }));
    }
    if (d.asistenciaGeneral && d.asistenciaGeneral.rows.length) parts.push(asistenciaGeneralPart(d.asistenciaGeneral));
    parts = parts.concat(d.actas.map(function (a, i) { var p = actaPart(a); p.headerLine = 'Expediente ' + d.folio + ' · Acta ' + (i + 1) + ' de ' + d.actas.length + ' · ' + a.especialidad; return p; }));
    (d.constancias || []).forEach(function (c) {
      var cp = constanciaPart(c);
      cp.headerLine = 'Expediente ' + d.folio + ' · Constancia ' + c.folio;
      parts.push(cp);
    });
    return build({ parts: parts, footer: 'Expediente consolidado · Folio ' + d.folio + ' · Documento de control interno' });
  }

  return { build: build, buildActa: buildActa, buildConstancia: buildConstancia, buildConsolidado: buildConsolidado, actaPart: actaPart, constanciaPart: constanciaPart, cortePart: cortePart, registroActasPart: registroActasPart };
})();
if (typeof module !== 'undefined') module.exports = PDFBuilder;
