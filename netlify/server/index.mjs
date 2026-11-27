/* API del sistema de evaluación de subespecialidades pediátricas en Netlify.
   El navegador llama POST /api { action, params } con "Authorization: Bearer <token>".
   Los datos persisten en Netlify Database (tabla "records", una fila JSON por documento).
   Variables opcionales: GOOGLE_CLIENT_ID, SMTP_USER + SMTP_PASS (Gmail: cuenta y contraseña de aplicación; host/puerto automáticos),
   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_FROM, SMTP_FROM_NAME,
   WA_PROVIDER=callmebot|meta, WA_KEY, WA_PHONE_ID, WA_TOKEN */
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { getDatabase } from '@netlify/database';
import { getContext } from '@netlify/server';
import EXAM from '../../examdata.js';
import PDF from '../../pdf.js';
import coreMod from '../../core.js';
import { sendMail, smtpConfigured, sendWhatsApp } from './notify.mjs';

const { createCore, STUDY } = coreMod;

export const config = { path: ['/api', '/api/*'] };

/* ---------------- Base de datos ---------------- */
let db;
const pool = () => (db ||= getDatabase()).pool;

/* Ejecuta fn(store) dentro de una transacción serializada. El núcleo es síncrono, así que se
   carga una instantánea de todos los documentos, se trabaja en memoria y al final se guardan
   únicamente los documentos modificados. */
async function withStore(fn) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727201)');
    const { rows } = await client.query('SELECT collection, id, data FROM records');
    const mem = {};
    for (const r of rows) (mem[r.collection] ||= {})[r.id] = r.data;
    const changed = new Map();
    const cp = o => JSON.parse(JSON.stringify(o));
    const store = {
      list: c => Object.values(mem[c] || {}).map(cp),
      get: (c, id) => (mem[c] && mem[c][id] ? cp(mem[c][id]) : null),
      put: (c, o) => { (mem[c] ||= {})[o.id] = cp(o); changed.set(c + '\u0000' + o.id, { c, id: String(o.id) }); },
      remove: (c, id) => { if (mem[c]) delete mem[c][id]; changed.set(c + '\u0000' + id, { c, id: String(id) }); },
      lock: f => f()
    };
    const out = fn(store);
    for (const { c, id } of changed.values()) {
      const val = mem[c] && mem[c][id];
      if (val) await client.query(
        `INSERT INTO records (collection, id, data, updated_at) VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [c, id, JSON.stringify(val)]);
      else await client.query('DELETE FROM records WHERE collection = $1 AND id = $2', [c, id]);
    }
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

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
function saludo(p) {
  const u = p.alumno || {};
  if (p.tipo === 'temario') return `Estimado(a) ${u.nombre} ${u.apellidos}:\n\nAdjuntamos el temario de estudio y la bibliografía recomendada para su examen de ${(EXAM.especialidades[u.especialidad] || {}).nombre}.\n\nSistema de evaluación de subespecialidades pediátricas.`;
  const a = p.intento || {};
  return `Resultado emitido automáticamente.\nCalificación: ${a.calificacion}/100 · ${a.estatus} (mínimo ${a.minimo}).\nEste resultado es definitivo e inapelable.\n\nSistema de evaluación de subespecialidades pediátricas.`;
}

/* GET síncrono (el núcleo lo usa para validar credenciales de Google). */
const HTTP_GET = "fetch(process.argv[1]).then(r=>{if(!r.ok)process.exit(1);return r.text()}).then(t=>process.stdout.write(t)).catch(()=>process.exit(1))";
function httpGet(url) {
  const r = spawnSync(process.execPath, ['-e', HTTP_GET, url], { encoding: 'utf8', timeout: 15000 });
  if (r.status !== 0) throw new Error('Fallo al consultar ' + url.split('?')[0]);
  return r.stdout;
}

/* Las notificaciones reales (SMTP/WhatsApp) son asíncronas: el núcleo recibe un acuse inmediato
   y el resultado definitivo se guarda en el registro de la notificación al terminar el envío. */
function buildCore(pending, store) {
  return createCore(EXAM, {
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    httpGet,
    store,
    sha256: s => crypto.createHash('sha256').update(s, 'utf8').digest('hex'),
    rand: n => crypto.randomBytes(n).toString('hex'),
    now: () => Date.now(),
    b64: bytes => Buffer.from(bytes).toString('base64'),
    pdf: { temario: temarioPdf, constancia: constanciaPdf, acta: d => PDF.buildActa(d), constanciaDoc: c => PDF.buildConstancia(c), consolidado: d => PDF.buildConsolidado(d) },
    canalCorreo: () => (smtpConfigured() ? 'smtp' : 'simulado'),
    canalWhatsapp: () => process.env.WA_PROVIDER || 'simulado',
    send: (job, payload) => {
      const u = payload.alumno || {};
      let promise, proveedor;
      if (job.canal === 'correo') {
        const pdf = payload.tipo === 'temario' ? temarioPdf(u) : (payload.tipo === 'reset' || payload.tipo === 'reset_hecho' ? null : constanciaPdf(u, payload.intento));
        const nombre = payload.tipo === 'temario' ? 'Temario_' + u.especialidad + '.pdf' : 'Resultado_' + (u.matricula || u.usuario) + '.pdf';
        proveedor = smtpConfigured() ? 'smtp' : 'simulado';
        if (proveedor === 'simulado') return { ok: false, proveedor, detalle: 'SMTP no configurado (modo simulación)' };
        promise = sendMail({ to: job.para, subject: job.asunto, text: job.cuerpo + '\n\n' + saludo(payload), pdf, pdfName: nombre });
      } else {
        proveedor = process.env.WA_PROVIDER || 'simulado';
        if (proveedor === 'simulado' || !String(job.para || '').replace(/[^\d]/g, '')) return { ok: false, proveedor: 'simulado', detalle: 'WhatsApp no configurado (modo simulación)' };
        promise = sendWhatsApp({ to: job.para, text: '*Evaluación de subespecialidades*\n' + job.cuerpo });
      }
      pending.push({ id: job.id, promise });
      return { ok: true, proveedor, detalle: 'En proceso de envío' };
    }
  });
}

async function settle(pending) {
  const results = await Promise.all(pending.map(p => p.promise.then(r => ({ id: p.id, r }), e => ({ id: p.id, r: { ok: false, detalle: String(e && e.message || e) } }))));
  await withStore(store => {
    for (const { id, r } of results) {
      const job = store.get('notifications', id);
      if (!job) continue;
      job.estado = r.ok ? 'enviado' : 'error';
      if (r.proveedor) job.proveedor = r.proveedor;
      job.detalle = r.detalle || '';
      job.enviado = Date.now();
      store.put('notifications', job);
    }
  });
}

/* ---------------- HTTP ---------------- */
const HDR = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' };
const hits = new Map();
function limited(ip) { const n = Date.now(), w = hits.get(ip) || { t: n, n: 0 }; if (n - w.t > 60000) { w.t = n; w.n = 0; } w.n++; hits.set(ip, w); return w.n > 300; }
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: HDR });

export default async function handler(req) {
  if (req.method === 'GET') return json({ ok: true, servicio: 'api' });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método no permitido.' }, 405);
  const ip = (req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (limited(ip)) return json({ ok: false, error: 'Demasiadas solicitudes.' }, 429);

  let m;
  try {
    const body = await req.text();
    if (body.length > 3e6) return json({ ok: false, error: 'Solicitud demasiado grande.' }, 413);
    m = JSON.parse(body || '{}');
  } catch (e) { return json({ ok: false, error: 'Solicitud inválida.' }); }

  const action = String(m.action || '');
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const pending = [];
  let out;
  try {
    out = await withStore(store => {
      return buildCore(pending, store).handle(action, m.params || {}, token);
    });
  } catch (e) {
    console.error('[api]', action, e);
    return json({ ok: false, error: 'Error interno del servidor. Intente de nuevo.' }, 500);
  }
  if (out && out.debug) { console.error('[api]', action, out.debug); delete out.debug; }
  if (pending.length) {
    const work = settle(pending).catch(e => console.error('[notificaciones]', e));
    try { getContext().waitUntil(work); } catch (_) { await work; }
  }
  return json(out);
}

