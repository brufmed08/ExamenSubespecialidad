import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const EXAM = require('../shared/examdata.js');
const PDF = require('../shared/pdf.js');
const { createCore } = require('../shared/core.js');
const cols = {};
const store = { list: c => Object.values(cols[c] || {}).map(x => JSON.parse(JSON.stringify(x))),
  get: (c, id) => cols[c] && cols[c][id] ? JSON.parse(JSON.stringify(cols[c][id])) : null,
  put: (c, o) => { (cols[c] = cols[c] || {})[o.id] = JSON.parse(JSON.stringify(o)); },
  remove: (c, id) => { delete (cols[c] || {})[id]; }, lock: fn => fn() };
const core = createCore(EXAM, { store, sha256: s => crypto.createHash('sha256').update(s).digest('hex'),
  rand: n => crypto.randomBytes(n).toString('hex'), now: () => Date.now(),
  b64: b => Buffer.from(b).toString('base64'),
  pdf: { temario: () => new Uint8Array([37,80,68,70]), constancia: c => PDF.buildConstancia(c),
    acta: d => PDF.buildActa(d), consolidado: d => PDF.buildConsolidado(d) },
  send: () => ({ ok: true, proveedor: 't', detalle: '' }) });
const api = (a, p = {}, t = '') => core.handle(a, p, t);
let f = 0; const ok = (c, m) => { if (!c) { f++; console.log('X', m); } else console.log('OK', m); };
const Y = new Date().getFullYear();
api('setup', { nombre: 'C', usuario: 'admin', password: 'admin123' });
const adm = api('login', { usuario: 'admin', password: 'admin123' }).data.token;
api('saveSettings', { especialidades: { neonatologia: { jefe: 'Dr. Jorge Jefe', titular: 'Dra. Teresa Titular' } } }, adm);
const mk = (m, a, n, e) => api('createStudent', { apellidos: a, nombre: n, email: m.toLowerCase() + '@h.mx', matricula: m, usuario: m.toLowerCase(), password: 'pw1234', especialidad: e }, adm);
mk('NEO-01', 'ALVAREZ SOTO', 'MARIA', 'neonatologia');
mk('NEO-02', 'BENITEZ CRUZ', 'JOSE', 'neonatologia');
mk('CIR-01', 'DURAN LOPEZ', 'EVA', 'cirugia');
const take = (u, good, firma) => {
  const t = api('login', { usuario: u, password: 'pw1234' }).data.token;
  const sc = api('signConsent', { acepta: true, nombreCompleto: firma }, t); if (!sc.ok) throw new Error('consent ' + u + ': ' + sc.error);
  const st = api('startAttempt', {}, t); if (!st.ok) throw new Error('start ' + u + ': ' + st.error);
  const ans = {}; st.data.questions.forEach(q => ans[q.n] = good ? EXAM.clave[String(q.n)] : (EXAM.clave[String(q.n)] === 'a' ? 'b' : 'a'));
  const r = api('submitAttempt', { attemptId: st.data.attemptId, respuestas: ans }, t);
  api('signConfidentiality', { acepta: true, nombreCompleto: firma }, t);
  return r.data.result;
};
const r1 = take('neo-01', true, 'MARIA ALVAREZ SOTO'), r2 = take('neo-02', true, 'JOSE BENITEZ CRUZ'), r3 = take('cir-01', true, 'EVA DURAN LOPEZ');
ok(r1.calificacion === 100 && r3.calificacion === 100, 'tres examenes en 100');
// simular el defecto de la version anterior en dos de ellos
[r1.id, r2.id].forEach(id => {
  const a = store.get('attempts', id);
  a.aciertos = 0; a.calificacion = 0; a.estatus = 'NO APROBADO'; a.motor = '1.0';
  a.areas = a.areas.map(x => ({ materia: x.materia, ok: 0, total: x.total, pct: 0 }));
  store.put('attempts', a);
});

/* ---- folios: primera emision fija folio y fecha; la reimpresion reutiliza el original ---- */
const a1 = api('actaPdf', { especialidad: 'neonatologia' }, adm);
ok(a1.data.folio === `ACT-NEONAT-${Y}-0001` && a1.data.tipo === 'original', 'acta 1 original = ' + a1.data.folio);
const a2 = api('actaPdf', { especialidad: 'neonatologia' }, adm);
ok(a2.data.tipo === 'reimpresion' && a2.data.folio === a1.data.folio, 'acta 2 sin cambios = reimpresion con folio ' + a2.data.folio);
ok(a2.data.fecha === a1.data.fecha && a2.data.sello === a1.data.sello, 'la reimpresion conserva fecha y huella del original');
const a3 = api('actaPdf', { especialidad: 'cirugia' }, adm);
ok(a3.data.folio === `ACT-CIRUGI-${Y}-0001` && a3.data.tipo === 'original', 'cirugia serie propia = ' + a3.data.folio);
const e1 = api('actasPdf', {}, adm);
ok(e1.data.folio === `EXP-${Y}-0001`, 'expediente = ' + e1.data.folio);
const serNeo1 = api('folios', {}, adm).data.rows.filter(r => r.tipo === 'acta' && r.especialidad === 'neonatologia')[0];
ok(serNeo1.usados === 1, 'el expediente reutiliza el acta emitida en lugar de acunar folios (usados=' + serNeo1.usados + ')');
ok(api('folios', {}, adm).data.rows.length === 11, 'tabla de folios 11 renglones');

/* ---- diagnostico y recalificacion ---- */
const dg = api('diagnostico', {}, adm);
ok(dg.data.total === 2, 'detecta 2 calificaciones mal calculadas');
const rec = api('recalificar', { confirma: true, motivo: 'Defecto en la comparacion de la clave' }, adm);
ok(rec.data.recalificados === 2, 'recalifica 2');
ok(rec.data.constancias.length === 1 && rec.data.constancias[0].folio === `COR-NEONAT-${Y}-0001`, 'constancia propia = ' + (rec.data.constancias[0] || {}).folio);
ok(rec.data.constancias[0].examenes === 2, 'constancia agrupa 2 examenes de la misma especialidad');
const kl = api('listConstancias', {}, adm);
ok(kl.data.rows.length === 1, 'constancia listada');
const kp = api('constanciaPdf', { id: kl.data.rows[0].id }, adm);
fs.writeFileSync('/tmp/constancia.pdf', Buffer.from(kp.data.base64, 'base64'));
ok(kp.ok, 'descarga constancia');

/* el contenido cambio (calificaciones corregidas) => acta nueva, no reimpresion */
const a4 = api('actaPdf', { especialidad: 'neonatologia' }, adm);
ok(a4.data.tipo === 'original' && a4.data.folio === `ACT-NEONAT-${Y}-0002`, 'contenido nuevo = acta nueva ' + a4.data.folio);
ok(a4.data.constancias.length === 1, 'acta incluye la constancia');
fs.writeFileSync('/tmp/acta_k.pdf', Buffer.from(a4.data.base64, 'base64'));
const a5 = api('actaPdf', { especialidad: 'cirugia' }, adm);
ok(a5.data.tipo === 'reimpresion' && a5.data.folio === a3.data.folio, 'cirugia reimprime su original ' + a5.data.folio);
ok(a5.data.constancias.length === 0, 'acta de cirugia no incluye constancia ajena');

/* ---- registro de actas emitidas ---- */
const reg = api('actasEmitidas', {}, adm);
ok(reg.data.total === 6, 'registro con 6 actas: 5 subespecialidades + 1 acta nueva (' + reg.data.total + ')');
const rNeo1 = reg.data.rows.filter(x => x.folio === a1.data.folio)[0];
ok(rNeo1 && rNeo1.reimpresiones === 1 && rNeo1.reproducciones === 1 && rNeo1.sello === a1.data.sello, 'el registro marca la reimpresion (' + (rNeo1 && rNeo1.reimpresiones) + ') y guarda la huella');
ok(reg.data.rows.every(x => x.fecha && x.sello && x.estado), 'cada renglon lleva folio, fecha, huella y estado');

const e2 = api('actasPdf', { conDatos: true }, adm);
ok(e2.data.asistencia === 3, 'asistencia general con 3 sustentantes');
ok(e2.data.constancias.length === 1, 'expediente incluye la constancia');
ok(e2.data.registro === 6, 'expediente incluye el registro de actas (' + e2.data.registro + ')');

/* ---- reinicio de numeracion ---- */
const serieNeo = api('folios', {}, adm).data.rows.filter(r => r.tipo === 'acta' && r.especialidad === 'neonatologia')[0];
const rst = api('resetFolios', { confirma: true, tipo: 'acta', especialidad: 'neonatologia' }, adm);
ok(rst.data.reiniciados === 1, 'reinicia solo actas de neonatologia');
ok(rst.data.corteFolios[0] === serieNeo.ultimo + ' → ' + serieNeo.prefijo + '-' + Y + '-0001', 'hoja de corte asienta el corte: ' + rst.data.corteFolios[0]);
const ctx0 = api('cortes', {}, adm);
ok(ctx0.data.rows.length === 1 && ctx0.data.rows[0].rows.length === 1, 'corte consultable en la bitacora de folios');
ok(api('actaPdf', { especialidad: 'neonatologia' }, adm).data.folio === a4.data.folio, 'tras el reinicio el acta ya emitida sigue siendo la misma (reimpresion)');
mk('NEO-03', 'TORRES RUIZ', 'ANA', 'neonatologia');
take('neo-03', true, 'ANA TORRES RUIZ');
const a6 = api('actaPdf', { especialidad: 'neonatologia' }, adm);
ok(a6.data.tipo === 'original' && a6.data.folio === `ACT-NEONAT-${Y}-0001`, 'acta nueva tras el reinicio toma 0001: ' + a6.data.folio);
const a7 = api('actaPdf', { especialidad: 'neonatologia' }, adm);
ok(a7.data.tipo === 'reimpresion' && a7.data.folio === a6.data.folio && a7.data.sello === a6.data.sello, 'su reimpresion conserva folio y huella');
const cirTras = api('actaPdf', { especialidad: 'cirugia' }, adm);
ok(cirTras.data.folio === a3.data.folio, 'cirugia conserva el folio de su original: ' + cirTras.data.folio);
const e3 = api('actasPdf', { conDatos: true }, adm);
fs.writeFileSync('/tmp/expediente3.pdf', Buffer.from(e3.data.base64, 'base64'));
fs.writeFileSync('/tmp/exp_payload.json', JSON.stringify(e3.data.datos));
ok(e3.data.cortes === 1, 'expediente incluye hoja de corte (' + e3.data.cortes + ')');
ok(e3.data.registro === 7, 'expediente incluye el registro con 7 actas (' + e3.data.registro + ')');

ok(api('resetFolios', { confirma: false }, adm).ok === false, 'exige confirmacion');
const stx = api('login', { usuario: 'neo-01', password: 'pw1234' }).data.token;
ok(api('folios', {}, stx).ok === false && api('resetFolios', { confirma: true }, stx).ok === false, 'alumno sin acceso a folios');
ok(api('actasEmitidas', {}, stx).ok === false, 'alumno sin acceso al registro de actas');
console.log(f ? f + ' FALLAS' : 'TEST OK');
process.exit(f ? 1 : 0);
