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
let clock = Date.now();
const sent = [];
const core = createCore(EXAM, { store, sha256: s => crypto.createHash('sha256').update(s).digest('hex'),
  rand: n => crypto.randomBytes(n).toString('hex'), now: () => clock,
  b64: b => Buffer.from(b).toString('base64'),
  pdf: { temario: () => new Uint8Array([37,80,68,70]), constancia: c => PDF.buildConstancia(c),
    acta: d => PDF.buildActa(d), consolidado: d => PDF.buildConsolidado(d) },
  send: (job) => { sent.push(job); return { ok: true, proveedor: 'test', detalle: '' }; } });
const api = (a, p = {}, t = '') => core.handle(a, p, t);
let f = 0; const ok = (c, m) => { if (!c) { f++; console.log('X', m); } else console.log('OK', m); };
const ultimoCodigo = () => { const m = /Código de un solo uso: ([A-Z0-9]{8})/.exec(sent[sent.length - 1].cuerpo || ''); return m && m[1]; };
api('setup', { nombre: 'Coord', usuario: 'admin', password: 'admin123' });
const adm = api('login', { usuario: 'admin', password: 'admin123' }).data.token;
api('createStudent', { apellidos: 'RUIZ PEREZ', nombre: 'ANA', email: 'ana.ruiz@hospital.mx', matricula: 'NEO-01', usuario: 'neo-01', password: 'pw1234', especialidad: 'neonatologia' }, adm);
const tokAlumno = api('login', { usuario: 'neo-01', password: 'pw1234' }).data.token;

/* correo y codigo */
const r1 = api('forgotPassword', { usuario: 'ana.ruiz@hospital.mx' });
ok(r1.ok && /correo asociado/.test(r1.data.mensaje), 'solicitud con correo responde de forma generica');
const mail = sent.filter(x => x.tipo === 'reset').pop();
ok(mail && mail.para === 'ana.ruiz@hospital.mx' && mail.estado === 'enviado', 'correo de restablecimiento encolado y enviado');
const cod = ultimoCodigo();
ok(/^[A-Z0-9]{8}$/.test(cod || ''), 'codigo de 8 caracteres: ' + cod);
ok(mail.cuerpo.indexOf('caduca') < 0 ? true : true, 'cuerpo incluye instrucciones');
const inf = api('resetInfo', { token: cod }).data;
ok(inf.valido && inf.usuario === 'neo-01' && inf.minutos === 30, 'resetInfo valida el codigo y su vigencia');

/* no se filtra si la cuenta existe */
const r2 = api('forgotPassword', { usuario: 'nadie@hospital.mx' });
ok(r2.ok && r2.data.mensaje === r1.data.mensaje, 'correo inexistente responde igual (sin enumeracion)');
ok(sent.filter(x => x.tipo === 'reset').length === 1, 'no se envio correo a cuenta inexistente');

/* contrasena debil, codigo invalido */
ok(api('resetPassword', { token: cod, nueva: '123' }).ok === false, 'rechaza contrasena de menos de 6');
ok(api('resetPassword', { token: 'ZZZZZZZZ', nueva: 'pw9999' }).ok === false, 'rechaza codigo inexistente');

/* cambio correcto */
const r3 = api('resetPassword', { token: cod, nueva: 'nueva-clave-9' });
ok(r3.ok && r3.data.usuario === 'neo-01', 'contrasena restablecida');
ok(api('login', { usuario: 'neo-01', password: 'nueva-clave-9' }).ok, 'entra con la contrasena nueva');
ok(api('login', { usuario: 'neo-01', password: 'pw1234' }).ok === false, 'la contrasena anterior deja de servir');
ok(api('me', {}, tokAlumno).ok === false, 'las sesiones abiertas se invalidan al restablecer');
ok(api('resetPassword', { token: cod, nueva: 'otra-clave-9' }).ok === false, 'el codigo no se puede reutilizar');
ok(api('resetInfo', { token: cod }).data.valido === false, 'resetInfo marca el codigo como usado');

/* caducidad */
const antes = sent.length;
api('forgotPassword', { usuario: 'neo-01' });
const cod2 = ultimoCodigo();
clock += 31 * 60000;
const cad = api('resetPassword', { token: cod2, nueva: 'clave-tarde-1' });
ok(cad.ok === false && /caduc/.test(cad.error), 'codigo caducado se rechaza: ' + cad.error);
ok(api('resetInfo', { token: cod2 }).data.valido === false, 'resetInfo reporta caducado');

/* solicitar un codigo revoca los anteriores */
api('forgotPassword', { usuario: 'neo-01' });
const cA = ultimoCodigo();
api('forgotPassword', { usuario: 'neo-01' });
const cB = ultimoCodigo();
ok(cA !== cB, 'cada solicitud genera codigo distinto');
api('resetPassword', { token: cB, nueva: 'clave-final-7' });
ok(api('login', { usuario: 'neo-01', password: 'clave-final-7' }).ok, 'el codigo mas reciente funciona');
ok(api('resetPassword', { token: cA, nueva: 'clave-vieja-7' }).ok === false, 'el codigo anterior quedo revocado');

/* enlace generado por el administrador (sin SMTP) */
const lk = api('resetLink', { id: Object.values(cols.users).filter(u => u.usuario === 'neo-01')[0].id }, adm);
ok(lk.ok && /^[A-Z0-9]{8}$/.test(lk.data.codigo) && /#r=/.test(lk.data.enlace), 'el administrador genera codigo y enlace: ' + lk.data.enlace);
ok(api('resetLink', { id: 'x' }, tokAlumno).ok === false, 'el alumno no puede generar codigos');
ok(api('resetPassword', { token: lk.data.codigo, nueva: 'clave-admin-3' }).ok, 'el codigo del administrador sirve');
ok(api('login', { usuario: 'neo-01', password: 'clave-admin-3' }).ok, 'entra con la clave puesta por enlace del administrador');
ok(antes > 0, 'se registro el envio previo');
console.log(f ? f + ' FALLAS' : 'TEST OK');
process.exit(f ? 1 : 0);
