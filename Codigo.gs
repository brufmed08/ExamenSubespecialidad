/* =====================================================================
   Examen de subespecialidades pediátricas — Google Apps Script
   Hojas: DB_users, DB_attempts, DB_consents, DB_incidents, DB_notifications, DB_settings
   Correo: MailApp (cuota diaria de la cuenta). WhatsApp: UrlFetchApp (CallMeBot / Meta).
   Propiedades del script: WA_PROVIDER, WA_KEY, WA_PHONE_ID, WA_TOKEN, CORREO_COPIA
   ===================================================================== */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('Evaluación de subespecialidades pediátricas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function api(action, params, token) {
  var props = PropertiesService.getScriptProperties();
  var core = createCore(EXAM, {
  googleClientId: (function () { try { return PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID') || ''; } catch (e) { return ''; } })(),
  httpGet: function (url) { return UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText(); },
    store: GasStore_(),
    sha256: function (s) {
      var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8), h = '';
      for (var i = 0; i < b.length; i++) { var v = (b[i] + 256) % 256; h += (v < 16 ? '0' : '') + v.toString(16); } return h;
    },
    rand: function (n) { var s = ''; while (s.length < n * 2) s += Utilities.getUuid().replace(/-/g, ''); return s.slice(0, n * 2); },
    now: function () { return Date.now(); },
    b64: function (bytes) { return Utilities.base64Encode(bytes); },
    pdf: {
      temario: function (u) { return buildTemario_(u); },
      constancia: function (u, a) { return buildConstancia_(u, a); },
      acta: function (d) { return PDFBuilder.buildActa(d); }, constancia: function (c) { return PDFBuilder.buildConstancia(c); }, consolidado: function (d) { return PDFBuilder.buildConsolidado(d); }
    },
    canalCorreo: function () { return 'apps-script'; },
    canalWhatsapp: function () { return props.getProperty('WA_PROVIDER') || 'simulado'; },
    send: function (job, payload) {
      var u = payload.alumno || {}, sp = EXAM.especialidades[u.especialidad] || { nombre: '' };
      if (job.canal === 'correo') {
        var pdf = payload.tipo === 'temario' ? buildTemario_(u) : buildConstancia_(u, payload.intento);
        var nombre = payload.tipo === 'temario' ? 'Temario_' + u.especialidad + '.pdf' : 'Resultado_' + (u.matricula || '') + '.pdf';
        var texto = payload.tipo === 'temario'
          ? 'Estimado(a) ' + u.nombre + ' ' + u.apellidos + ':\n\nAdjuntamos el temario y la bibliografía para su examen de ' + sp.nombre + '.\n\nSistema de evaluación de subespecialidades pediátricas.'
          : 'Resultado emitido automáticamente.\nCalificación: ' + payload.intento.calificacion + '/100 · ' + payload.intento.estatus + ' (mínimo ' + payload.intento.minimo + ').\nEste resultado es definitivo e inapelable.';
        MailApp.sendEmail({ to: job.para, subject: job.asunto, body: texto + '\n\n' + job.cuerpo,
          attachments: [Utilities.newBlob(pdf, 'application/pdf', nombre)] });
        return { ok: true, proveedor: 'MailApp', detalle: 'Enviado a ' + job.para };
      }
      var prov = props.getProperty('WA_PROVIDER'), num = String(job.para || '').replace(/[^\d]/g, '');
      if (!prov || !num) return { ok: false, proveedor: 'simulado', detalle: 'WhatsApp no configurado' };
      var texto = 'Evaluación de subespecialidades\n' + job.cuerpo;
      if (prov === 'callmebot') {
        var r = UrlFetchApp.fetch('https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent('+' + num) + '&text=' + encodeURIComponent(texto) + '&apikey=' + encodeURIComponent(props.getProperty('WA_KEY') || ''), { muteHttpExceptions: true });
        return { ok: r.getResponseCode() < 300, proveedor: 'callmebot', detalle: 'HTTP ' + r.getResponseCode() };
      }
      var resp = UrlFetchApp.fetch('https://graph.facebook.com/v20.0/' + props.getProperty('WA_PHONE_ID') + '/messages', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + props.getProperty('WA_TOKEN') },
        payload: JSON.stringify({ messaging_product: 'whatsapp', to: num, type: 'text', text: { body: texto } })
      });
      return { ok: resp.getResponseCode() < 300, proveedor: 'meta', detalle: 'HTTP ' + resp.getResponseCode() };
    }
  });
  var out = core.handle(String(action || ''), params || {}, String(token || ''));
  if (out.debug) { console.error('[api] ' + action + ': ' + out.debug); delete out.debug; }
  return JSON.stringify(out);
}

function buildTemario_(u) {
  var sp = EXAM.especialidades[u.especialidad], mats = [], secs = [];
  sp.items.forEach(function (n) { var m = sp.materias[String(n)]; if (mats.indexOf(m) < 0) mats.push(m); });
  mats.forEach(function (m) {
    var s = STUDY[m] || { temas: [], biblio: [] }, items = s.temas.map(function (t) { return { t: 'li', text: t }; });
    if (s.biblio.length) items.push({ t: 'note', text: 'Bibliografía: ' + s.biblio.join(' · ') });
    secs.push({ h: m, items: items });
  });
  secs.push({ h: 'Recomendaciones', items: [{ t: 'li', text: 'Estudie primero las materias con menor puntaje; el debriefing posterior al examen le indicará cuáles son.' }, { t: 'li', text: 'El resultado es definitivo una vez emitido y no admite modificación ni apelación.' }] });
  return PDFBuilder.build({ title: 'Temario de estudio', subtitle: sp.nombre + ' · Evaluación de subespecialidades pediátricas',
    meta: ['Sustentante: ' + u.apellidos + ', ' + u.nombre, 'Matrícula / folio: ' + u.matricula, 'Correo registrado: ' + u.email,
      'Reactivos: ' + sp.items.length + ' · Calificación mínima aprobatoria: 60 de 100'], sections: secs });
}

function buildConstancia_(u, a) {
  var sp = EXAM.especialidades[a.especialidad];
  return PDFBuilder.build({ title: 'Resultado del examen', subtitle: sp.nombre + ' · Documento oficial de calificación',
    meta: ['Sustentante: ' + u.apellidos + ', ' + u.nombre, 'Matrícula / folio: ' + u.matricula, 'Folio del intento: ' + a.id],
    sections: [
      { h: 'Calificación', items: [{ t: 'p', text: a.calificacion + ' / 100  ·  ' + a.estatus + '  (mínimo ' + a.minimo + ')' }, { t: 'p', text: 'Reactivos correctos: ' + a.aciertos + ' de ' + a.total }] },
      { h: 'Desempeño por materia', items: a.areas.map(function (x) { return { t: 'li', text: x.materia + ': ' + x.pct + '% (' + x.ok + '/' + x.total + ')' }; }) },
      { h: 'Declaración', items: [{ t: 'note', text: 'Resultado emitido automáticamente al concluir el examen; es inapelable y no puede modificarse.' }] }
    ] });
}

function GasStore_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Cree este proyecto desde una Hoja de Google (Extensiones > Apps Script).');
  var cache = {};
  function sh(c) {
    var n = 'DB_' + c, s = ss.getSheetByName(n);
    if (!s) { s = ss.insertSheet(n); s.getRange(1, 1, 1, 2).setValues([['id', 'json']]); s.hideSheet(); }
    return s;
  }
  function load(c) {
    if (cache[c]) return cache[c];
    var s = sh(c), last = s.getLastRow(), m = {};
    if (last > 1) s.getRange(2, 1, last - 1, 2).getValues().forEach(function (v, i) { if (v[0]) { try { m[v[0]] = { row: i + 2, obj: JSON.parse(v[1]) }; } catch (e) {} } });
    cache[c] = m; return m;
  }
  function cp(o) { return JSON.parse(JSON.stringify(o)); }
  return {
    list: function (c) { var m = load(c), o = []; for (var k in m) o.push(cp(m[k].obj)); return o; },
    get: function (c, id) { var m = load(c); return m[id] ? cp(m[id].obj) : null; },
    put: function (c, obj) {
      var m = load(c), s = sh(c), j = JSON.stringify(obj);
      if (m[obj.id]) { s.getRange(m[obj.id].row, 2).setValue(j); m[obj.id].obj = cp(obj); }
      else { s.appendRow([obj.id, j]); m[obj.id] = { row: s.getLastRow(), obj: cp(obj) }; }
    },
    remove: function (c, id) { var m = load(c); if (!m[id]) return; sh(c).deleteRow(m[id].row); delete cache[c]; },
    lock: function (fn) { var l = LockService.getScriptLock(); l.waitLock(25000); try { cache = {}; var r = fn(); SpreadsheetApp.flush(); return r; } finally { l.releaseLock(); } }
  };
}
