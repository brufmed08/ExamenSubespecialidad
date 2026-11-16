import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const EXAM = require('../shared/examdata.js');
const { createCore } = require('../shared/core.js');
const cols = {}; const store = {
  list: c => Object.values(cols[c] || {}).map(x => JSON.parse(JSON.stringify(x))),
  get: (c, id) => cols[c] && cols[c][id] ? JSON.parse(JSON.stringify(cols[c][id])) : null,
  put: (c, o) => { (cols[c] = cols[c] || {})[o.id] = JSON.parse(JSON.stringify(o)); },
  remove: (c, id) => { delete (cols[c] || {})[id]; },
  lock: fn => fn()
};
const core = createCore(EXAM, { store, sha256: s => crypto.createHash('sha256').update(s).digest('hex'),
  rand: n => crypto.randomBytes(n).toString('hex'), now: () => Date.now(),
  b64: b => Buffer.from(b).toString('base64'),
  pdf: { temario: () => new Uint8Array([37,80,68,70]), constancia: () => new Uint8Array([37,80,68,70]),
         acta: () => new Uint8Array([37,80,68,70]), consolidado: () => new Uint8Array([37,80,68,70]) },
  send: () => ({ ok: true, proveedor: 'test', detalle: '' }) });
const api = (a, p = {}, t = '') => core.handle(a, p, t);
let f = 0; const ok = (c, m) => { if (!c) { f++; console.log('X', m); } else console.log('OK', m); };
api('setup', { nombre: 'C', usuario: 'admin', password: 'admin123' });
const adm = api('login', { usuario: 'admin', password: 'admin123' }).data.token;
const mk = (mat, esp = 'neonatologia') => api('createStudent', { apellidos: 'PRUEBA ' + mat, nombre: 'UNO', email: mat + '@x.mx', matricula: mat, usuario: mat, password: 'pw1234', especialidad: esp }, adm);
mk('N1'); mk('N2');
const t1 = api('login', { usuario: 'n1', password: 'pw1234' }).data.token;
api('signConsent', { acepta: true, nombreCompleto: 'UNO PRUEBA N1' }, t1);
const st = api('startAttempt', {}, t1);
const good = {}; st.data.questions.forEach(q => good[q.n] = EXAM.clave[String(q.n)]);
let r = api('submitAttempt', { attemptId: st.data.attemptId, respuestas: good }, t1);
ok(r.data.result.calificacion === 100, 'califica 100 con la clave en minusculas');
ok(r.data.result.motor === '1.1', 'marca motor 1.1');
// simular estrago de la version anterior
const a = store.get('attempts', r.data.result.id);
a.calificacion = 0; a.aciertos = 0; a.estatus = 'NO APROBADO'; a.motor = '1.0';
store.put('attempts', a);
let d = api('diagnostico', {}, adm);
ok(d.data.total === 1 && d.data.rows[0].nuevo.aciertos > 0 && d.data.rows[0].actual.aciertos === 0, 'diagnostico detecta el examen mal calificado (' + d.data.rows[0].nuevo.aciertos + ' aciertos nuevos)');
ok(api('recalificar', { confirma: false }, adm).ok === false, 'recalificar exige confirmacion');
const rec = api('recalificar', { confirma: true, motivo: 'Prueba' }, adm);
ok(rec.data.recalificados === 1 && rec.data.detalle[0].despues.calificacion === 100, 'recalifica a 100');
ok(api('diagnostico', {}, adm).data.total === 0, 'diagnostico queda limpio');
ok(store.list('audit').filter(x => x.tipo === 'recalificacion').length === 1, 'auditoria registrada');
// examen en blanco: no debe marcarse como discrepancia
const t2 = api('login', { usuario: 'n2', password: 'pw1234' }).data.token;
api('signConsent', { acepta: true, nombreCompleto: 'UNO PRUEBA N2' }, t2);
const st2 = api('startAttempt', {}, t2);
api('submitAttempt', { attemptId: st2.data.attemptId, respuestas: {} }, t2);
ok(api('diagnostico', {}, adm).data.total === 0, 'examen en blanco no se marca como discrepancia');
// acta + expediente
const ac = api('actaPdf', { especialidad: 'neonatologia' }, adm);
ok(ac.ok && ac.data.folio.startsWith('ACT-NEONAT'), 'acta individual');
const ex = api('actasPdf', {}, adm);
ok(ex.ok && ex.data.actas.length === 5 && ex.data.folio.startsWith('EXP-'), 'expediente con 5 actas');
ok(ex.data.resumenGlobal.total === 2 && ex.data.resumenGlobal.aprobados === 1, 'resumen global del expediente');
ok(ex.data.actas.map(x => x.especialidad).join('|').includes('Cirugía pediátrica'), 'incluye cirugia');
const stx = api('login', { usuario: 'n1', password: 'pw1234' }).data.token;
ok(api('actasPdf', {}, stx).ok === false, 'alumno no genera expediente');
ok(api('diagnostico', {}, stx).ok === false, 'alumno no ve diagnostico');
console.log(f ? f + ' FALLAS' : 'UNIT OK');
process.exit(f ? 1 : 0);
