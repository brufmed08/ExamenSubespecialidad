/* Servidor del sistema de evaluación de subespecialidades pediátricas.
   Node 18+, sin dependencias.  node server.js   (PORT, DATA_DIR)
   Variables para correo: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
   Variables para WhatsApp: WA_PROVIDER=callmebot|meta, WA_KEY (callmebot), WA_PHONE_ID y WA_TOKEN (meta) */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), net = require('net'), tls = require('tls');

const ROOT = __dirname;
const SH = fs.existsSync(path.join(ROOT, 'shared')) ? path.join(ROOT, 'shared') : path.join(ROOT, '..', 'shared');
const PUB = fs.existsSync(path.join(ROOT, 'public')) ? path.join(ROOT, 'public') : path.join(ROOT, '..', 'public');
const EXAM = require(path.join(SH, 'examdata.js'));
const PDF = require(path.join(SH, 'pdf.js'));
const { createCore, STUDY } = require(path.join(SH, 'core.js'));

const DD = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DD, { recursive: true });
const DBF = path.join(DD, 'db.json');
let db = { users: {}, sessions: {}, attempts: {}, consents: {}, incidents: {}, notifications: {}, settings: {} };
if (fs.existsSync(DBF)) { try { db = Object.assign(db, JSON.parse(fs.readFileSync(DBF, 'utf8'))); } catch (e) { console.error('db.json ilegible:', e.message); process.exit(1); } }
let dirty = false;
const flush = () => { if (!dirty) return; dirty = false; fs.writeFileSync(DBF + '.tmp', JSON.stringify(db)); fs.renameSync(DBF + '.tmp', DBF); };
setInterval(flush, 1200).unref();
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => { flush(); process.exit(0); }));

const store = {
  list: c => Object.values(db[c] || {}).map(x => JSON.parse(JSON.stringify(x))),
  get: (c, id) => db[c] && db[c][id] ? JSON.parse(JSON.stringify(db[c][id])) : null,
  put: (c, o) => { (db[c] = db[c] || {})[o.id] = JSON.parse(JSON.stringify(o)); dirty = true; },
  remove: (c, id) => { if (db[c]) { delete db[c][id]; dirty = true; } },
  lock: fn => fn()
};

/* ---------------- PDFs ---------------- */
function temarioPdf(u) {
  const sp = EXAM.especialidades[u.especialidad];
  const mats = [...new Set(sp.items.map(n => sp.materias[String(n)]))];
  const secs = mats.map(m => {
    const s = STUDY[m] || { temas: [], biblio: [] };
    return { h: m, items: s.temas.map(t => ({ t: 'li', text: t })).concat(s.biblio.length ? [{ t: 'note', text: 'Bibliografía: ' + s.biblio.join(' · ') }] : []) };
  });
  return PDF.build({
    title: 'Temario de estudio', subtitle: sp.nombre + ' · Evaluación de subespecialidades pediátricas',
    meta: ['Sustentante: ' + u.apellidos + ', ' + u.nombre, 'Matrícula / folio: ' + u.matricula, 'Correo registrado: ' + u.email,
      'Reactivos del examen: ' + sp.items.length + ' · Calificación mínima aprobatoria: 60 de 100',
      'Este temario corresponde a las materias que integran su examen. Los reactivos se basan en PREP® Self-Assessment 2021 (AAP).'],
    sections: secs.concat([{ h: 'Recomendaciones', items: [{ t: 'li', text: 'Estudie primero las materias con menor puntaje; el debriefing posterior al examen le indicará cuáles son.' }, { t: 'li', text: 'El resultado es definitivo una vez emitido y no admite modificación ni apelación.' }] }]),
    footer: 'Documento generado automáticamente'
  });
}
function constanciaPdf(u, a) {
  const sp = EXAM.especialidades[a.especialidad];
  return PDF.build({
    title: 'Resultado del examen', subtitle: sp.nombre + ' · Documento oficial de calificación',
    meta: ['Sustentante: ' + u.apellidos + ', ' + u.nombre, 'Matrícula / folio: ' + u.matricula,
      'Fecha de emisión: ' + new Date(a.emitido).toLocaleString('es-MX'), 'Folio del intento: ' + a.id],
    sections: [
      { h: 'Calificación', items: [{ t: 'p', text: a.calificacion + ' / 100  ·  ' + a.estatus + '  (mínimo aprobatorio ' + a.minimo + ')' }, { t: 'p', text: 'Reactivos correctos: ' + a.aciertos + ' de ' + a.total }] },
      { h: 'Desempeño por materia', items: a.areas.map(x => ({ t: 'li', text: x.materia + ': ' + x.pct + '% (' + x.ok + '/' + x.total + ')' })) },
      { h: 'Declaración', items: [{ t: 'note', text: 'El resultado se emitió automáticamente al concluir el examen, es inapelable y no puede modificarse. El sustentante firmó consentimiento informado y acuerdo de confidencialidad.' }] }
    ],
    footer: 'Sistema de evaluación · subespecialidades pediátricas'
  });
}

/* ---------------- Correo (SMTP) ---------------- */
function smtpConfigured() { return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS); }
function sendMail({ to, subject, text, pdf, pdfName }) {
  return new Promise(resolve => {
    if (!smtpConfigured()) return resolve({ ok: false, proveedor: 'simulado', detalle: 'SMTP no configurado (modo simulación)' });
    const host = process.env.SMTP_HOST, port = +(process.env.SMTP_PORT || 587);
    const secure = port === 465 || process.env.SMTP_SECURE === '1';
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const bnd = 'r' + crypto.randomBytes(8).toString('hex');
    let msg = `From: ${from}\r\nTo: ${to}\r\nSubject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${bnd}"\r\n\r\n--${bnd}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(text).toString('base64')}\r\n`;
    if (pdf) msg += `--${bnd}\r\nContent-Type: application/pdf; name="${pdfName}"\r\nContent-Disposition: attachment; filename="${pdfName}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(pdf).toString('base64')}\r\n`;
    msg += `--${bnd}--\r\n`;
    let sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buf = '', step = 0, done = false;
    const fin = r => { if (done) return; done = true; try { sock.destroy(); } catch (e) {} resolve(r); };
    const timer = setTimeout(() => fin({ ok: false, proveedor: 'smtp', detalle: 'Tiempo de espera agotado' }), 20000);
    const w = l => sock.write(l + '\r\n');
    const auth = () => {
      const u = Buffer.from(process.env.SMTP_USER).toString('base64'), p = Buffer.from(process.env.SMTP_PASS).toString('base64');
      w('AUTH LOGIN'); setTimeout(() => w(u), 120); setTimeout(() => w(p), 240);
    };
    sock.setEncoding('utf8');
    sock.on('data', d => {
      buf += d;
      let lines = buf.split('\r\n'); buf = lines.pop();
      for (const line of lines) {
        const code = line.slice(0, 3);
        if (step === 0 && code === '220') { w('EHLO sistema.local'); step = 1; }
        else if (step === 1 && /^250/.test(line)) { if (/STARTTLS/.test(line) && !secure && !sock.__tls) { w('STARTTLS'); step = 2; } else if (step !== 3) { if (smtpConfigured()) { auth(); step = 4; } else { w('MAIL FROM:<' + from + '>'); step = 5; } } }
        else if (step === 2 && code === '220') { sock.__tls = true; const s2 = tls.connect({ socket: sock, servername: host }, () => { sock = s2; sock.on('data', arguments.callee); w('EHLO sistema.local'); step = 1; }); }
        else if (step === 4 && code === '235') { w('MAIL FROM:<' + from + '>'); step = 5; }
        else if (step === 4 && code === '535') fin({ ok: false, proveedor: 'smtp', detalle: 'Credenciales rechazadas' });
        else if (step === 5 && code === '250') { w('RCPT TO:<' + to + '>'); step = 6; }
        else if (step === 6 && /^25[01]/.test(code)) { w('DATA'); step = 7; }
        else if (step === 7 && code === '354') { sock.write(msg); w('.'); step = 8; }
        else if (step === 8 && code === '250') { clearTimeout(timer); w('QUIT'); fin({ ok: true, proveedor: 'smtp', detalle: 'Enviado a ' + to }); }
        else if (/^5\d\d/.test(code) && step >= 5) { clearTimeout(timer); fin({ ok: false, proveedor: 'smtp', detalle: line.slice(0, 160) }); }
      }
    });
    sock.on('error', e => { clearTimeout(timer); fin({ ok: false, proveedor: 'smtp', detalle: e.message }); });
  });
}

/* ---------------- WhatsApp ---------------- */
async function sendWhatsApp({ to, text }) {
  const prov = process.env.WA_PROVIDER || '';
  const num = String(to || '').replace(/[^\d]/g, '');
  if (!prov || !num) return { ok: false, proveedor: 'simulado', detalle: 'WhatsApp no configurado (modo simulación)' };
  try {
    if (prov === 'callmebot') {
      const u = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent('+' + num)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(process.env.WA_KEY || '')}`;
      const r = await fetch(u); const t = await r.text();
      return { ok: r.ok, proveedor: 'callmebot', detalle: (r.ok ? 'Enviado' : 'HTTP ' + r.status) + ' ' + t.slice(0, 120) };
    }
    if (prov === 'meta') {
      const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WA_PHONE_ID}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.WA_TOKEN },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: num, type: 'text', text: { body: text } })
      });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, proveedor: 'meta', detalle: r.ok ? 'Enviado' : JSON.stringify(j).slice(0, 160) };
    }
    return { ok: false, proveedor: prov, detalle: 'Proveedor desconocido' };
  } catch (e) { return { ok: false, proveedor: prov, detalle: e.message }; }
}

const core = createCore(EXAM, {
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  httpGet: (url) => require('child_process').execFileSync('curl', ['-sfL', '--max-time', '15', url], { encoding: 'utf8' }),
  store,
  sha256: s => crypto.createHash('sha256').update(s, 'utf8').digest('hex'),
  rand: n => crypto.randomBytes(n).toString('hex'),
  now: () => Date.now(),
  b64: bytes => Buffer.from(bytes).toString('base64'),
  pdf: { temario: temarioPdf, constancia: constanciaPdf, acta: function (d) { return PDF.buildActa(d); }, constanciaDoc: function (c) { return PDF.buildConstancia(c); }, consolidado: function (d) { return PDF.buildConsolidado(d); } },
  canalCorreo: () => smtpConfigured() ? 'smtp' : 'simulado',
  canalWhatsapp: () => (process.env.WA_PROVIDER || 'simulado'),
  send: (job, payload) => {
    const u = payload.alumno || {};
    if (job.canal === 'correo') {
      const pdf = payload.tipo === 'temario' ? temarioPdf(u) : (payload.tipo === 'reset' || payload.tipo === 'reset_hecho' ? null : constanciaPdf(u, payload.intento));
      const nombre = payload.tipo === 'temario' ? 'Temario_' + u.especialidad + '.pdf' : 'Resultado_' + (u.matricula || u.usuario) + '.pdf';
      return sendMail({ to: job.para, subject: job.asunto, text: job.cuerpo + '\n\n' + saludo(payload), pdf, pdfName: nombre });
    }
    return sendWhatsApp({ to: job.para, text: '*Evaluación de subespecialidades*\n' + job.cuerpo });
  }
});
function saludo(p) {
  const u = p.alumno || {};
  if (p.tipo === 'temario') return `Estimado(a) ${u.nombre} ${u.apellidos}:\n\nAdjuntamos el temario de estudio y la bibliografía recomendada para su examen de ${(EXAM.especialidades[u.especialidad] || {}).nombre}.\n\nSistema de evaluación de subespecialidades pediátricas.`;
  const a = p.intento || {};
  return `Resultado emitido automáticamente.\nCalificación: ${a.calificacion}/100 · ${a.estatus} (mínimo ${a.minimo}).\nEste resultado es definitivo e inapelable.\n\nSistema de evaluación de subespecialidades pediátricas.`;
}

/* ---------------- HTTP ---------------- */
const HDR = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
const hits = new Map();
function limited(ip) { const n = Date.now(), w = hits.get(ip) || { t: n, n: 0 }; if (n - w.t > 60000) { w.t = n; w.n = 0; } w.n++; hits.set(ip, w); return w.n > 300; }
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, { ...HDR, 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(PUB, 'index.html')));
  }
  if (req.method === 'GET' && url === '/salud') { res.writeHead(200); return res.end('ok'); }
  if (req.method === 'POST' && url === '/api') {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
    if (limited(ip)) { res.writeHead(429, HDR); return res.end(JSON.stringify({ ok: false, error: 'Demasiadas solicitudes.' })); }
    let b = ''; req.on('data', c => { b += c; if (b.length > 3e6) req.destroy(); });
    req.on('end', async () => {
      let out, action = '';
      try { const m = JSON.parse(b || '{}'); action = String(m.action || ''); out = core.handle(action, m.params || {}, (req.headers.authorization || '').replace(/^Bearer\s+/i, '')); }
      catch (e) { out = { ok: false, error: 'Solicitud inválida.' }; }
      if (out.ok && /^(setup|login|signConsent|signConfidentiality|submitAttempt|saveAnswers|createStudent|importStudents|updateUser|deleteUser|createStaff|saveSettings|resend|logIncident|logout)$/.test(action)) flush();
      if (out.debug) { console.error('[api]', action, out.debug); delete out.debug; }
      res.writeHead(200, { ...HDR, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(404, HDR); res.end('No encontrado');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Subespecialidades pediátricas · http://localhost:' + PORT + '  datos:' + DBF + '  correo:' + (smtpConfigured() ? 'smtp' : 'simulado') + '  whatsapp:' + (process.env.WA_PROVIDER || 'simulado')));
