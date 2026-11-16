import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const EXAM = require('../shared/examdata.js');
const PDF = require('../shared/pdf.js');
const { createCore } = require('../shared/core.js');
const cols = {};
const store = { list: c => Object.values(cols[c] || {}).map(x => JSON.parse(JSON.stringify(x))),
  get: (c, i) => cols[c] && cols[c][i] ? JSON.parse(JSON.stringify(cols[c][i])) : null,
  put: (c, o) => { (cols[c] = cols[c] || {})[o.id] = JSON.parse(JSON.stringify(o)); },
  remove: (c, i) => { delete (cols[c] || {})[i]; }, lock: fn => fn() };
/* tokeninfo simulado: cada credencial conocida devuelve su perfil */
const TOKENS = {
  'tok-ana': { aud: 'test-client', email: 'Ana.Ruiz@Hospital.mx', email_verified: 'true', hd: 'hospital.mx', exp: String(Math.floor(Date.now() / 1000) + 600) },
  'tok-otro': { aud: 'otra-app', email: 'ana.ruiz@hospital.mx', email_verified: 'true' },
  'tok-nover': { aud: 'test-client', email: 'ana.ruiz@hospital.mx', email_verified: 'false' },
  'tok-exp': { aud: 'test-client', email: 'ana.ruiz@hospital.mx', email_verified: 'true', exp: '1000' },
  'tok-desconocido': { aud: 'test-client', email: 'nadie@hospital.mx', email_verified: 'true' },
  'tok-gmail': { aud: 'test-client', email: 'ana.ruiz@gmail.com', email_verified: 'true' },
};
const httpGet = url => {
  const m = /id_token=([^&]+)/.exec(url); const tok = m ? decodeURIComponent(m[1]) : '';
  const p = TOKENS[tok]; if (!p) return JSON.stringify({ error: 'invalid_token' });
  return JSON.stringify(p);
};
let CLIENT = 'test-client';
const core = createCore(EXAM, { store, sha256: s => crypto.createHash('sha256').update(s).digest('hex'),
  rand: n => crypto.randomBytes(n).toString('hex'), now: () => Date.now(),
  b64: b => Buffer.from(b).toString('base64'),
  pdf: { temario: () => new Uint8Array([37,80,68,70]), constancia: c => PDF.buildConstancia(c),
    acta: d => PDF.buildActa(d), consolidado: d => PDF.buildConsolidado(d) },
  googleClientId: CLIENT, httpGet,
  send: () => ({ ok: true, proveedor: 't', detalle: '' }) });
const api = (a, p = {}, t = '') => core.handle(a, p, t);
let f = 0; const ok = (c, m) => { if (!c) { f++; console.log('X', m); } else console.log('OK', m); };
api('setup', { nombre: 'Coord', usuario: 'admin', password: 'admin123' });
const adm = api('login', { usuario: 'admin', password: 'admin123' }).data.token;
api('createStudent', { apellidos: 'RUIZ PEREZ', nombre: 'ANA', email: 'ana.ruiz@hospital.mx', matricula: 'CIR-01', usuario: 'cir-01', password: 'pw1234', especialidad: 'cirugia' }, adm);
api('createStudent', { apellidos: 'SOTO VEGA', nombre: 'LUIS', email: 'luis.soto@hospital.mx', matricula: 'NEO-01', usuario: 'neo-01', password: 'pw1234', especialidad: 'neonatologia' }, adm);

/* ---- 1) examen comun de 150 ---- */
const cfg = api('loginConfig', {}).data;
ok(cfg.googleClientId === 'test-client', 'loginConfig expone el client id');
ok(cfg.totalReactivos === 150 && cfg.reactivosActivos === 142 && cfg.anulados.length === 8, 'examen comun: 142 de 150 · anulados ' + cfg.anulados.length);
const st0 = api('status', {}).data;
ok(st0.especialidades.every(e => e.items === 142), 'las 5 subespecialidades comparten los mismos 142 reactivos');
const ca = api('login', { usuario: 'cir-01', password: 'pw1234' }).data.token;
api('signConsent', { acepta: true, nombreCompleto: 'ANA RUIZ PEREZ' }, ca);
const at1 = api('startAttempt', {}, ca).data;
const cb = api('login', { usuario: 'neo-01', password: 'pw1234' }).data.token;
api('signConsent', { acepta: true, nombreCompleto: 'LUIS SOTO VEGA' }, cb);
const at2 = api('startAttempt', {}, cb).data;
ok(at1.questions.length === 142 && at2.questions.length === 142, 'ambos alumnos reciben 142 reactivos');
ok(JSON.stringify(at1.questions.map(q => q.n)) === JSON.stringify(at2.questions.map(q => q.n)), 'cirugia y neonatologia reciben el MISMO examen');
const mats = new Set(at1.questions.map(q => q.m));
ok(mats.size >= 8, 'el examen comun abarca todas las disciplinas (' + mats.size + ')');
const ans = {}; at1.questions.forEach(q => ans[q.n] = EXAM.clave[String(q.n)]);
const res = api('submitAttempt', { attemptId: at1.attemptId, respuestas: ans }, ca).data.result;
ok(res.calificacion === 100 && res.aciertos === 142, 'calificacion sobre 142 = 100');

/* ---- 2) acceso con Google ---- */
const g1 = api('googleLogin', { credential: 'tok-ana' });
ok(g1.ok && g1.data.via === 'google' && g1.data.user.matricula === 'CIR-01', 'correo registrado (con mayusculas) inicia sesion');
ok(api('me', {}, g1.data.token).ok, 'la sesion de Google sirve para operar');
ok(api('googleLogin', { credential: 'tok-desconocido' }).ok === false, 'correo no inscrito se rechaza');
const e1 = api('googleLogin', { credential: 'tok-otro' });
ok(e1.ok === false && /aplicación/.test(e1.error), 'aud distinto se rechaza: ' + e1.error);
const e2 = api('googleLogin', { credential: 'tok-nover' });
ok(e2.ok === false && /verificado/.test(e2.error), 'correo no verificado se rechaza: ' + e2.error);
const e3 = api('googleLogin', { credential: 'tok-exp' });
ok(e3.ok === false && /expir/.test(e3.error), 'credencial expirada se rechaza: ' + e3.error);
const e4 = api('googleLogin', { credential: 'no-existe' });
ok(e4.ok === false, 'credencial invalida se rechaza');
ok(api('googleLogin', {}).ok === false, 'sin credencial se rechaza');
api('setDominios', { dominios: ['@hospital.mx'] }, adm);
const g2 = api('googleLogin', { credential: 'tok-gmail' });
ok(g2.ok === false && /dominio/.test(g2.error), 'dominio no autorizado se rechaza: ' + g2.error);
ok(api('googleLogin', { credential: 'tok-ana' }).ok, 'dominio autorizado si entra');
ok(api('login', { usuario: 'cir-01', password: 'pw1234' }).ok, 'la contrasena local sigue funcionando');
console.log(f ? f + ' FALLAS' : 'TEST OK');
process.exit(f ? 1 : 0);
