/* =====================================================================
   NÚCLEO · Examen de subespecialidades pediátricas
   Solo servidor. La clave nunca viaja al navegador.
   ===================================================================== */
var CFG = { MIN_APROB: 60, INTENTOS: 1, SESION_HORAS: 8, MINUTOS: 0 };

function createCore(EXAM, ctx) {
  var LESSONS = {}; // materias por examen
  function err(m, c) { var e = new Error(m); e.code = c || 'ERROR'; e.userError = true; return e; }
  function N(s) { return String(s == null ? '' : s).trim(); }
  function U(s) { return N(s).toLowerCase(); }
  function now() { return ctx.now(); }
  function settings() { return ctx.store.get('settings', 'main') || {}; }
  function specialties() { return EXAM.especialidades; }
  function spec(id) { var s = specialties()[id]; if (!s) throw err('Especialidad no válida.'); return s; }
  /* Todos los sustentantes, de cualquier subespecialidad, responden el mismo examen completo. */
  function anulados() { return (EXAM.comun && EXAM.comun.anulados) || [44, 110, 121, 122, 134, 141, 144, 148]; }
  function totalOficial() { return (EXAM.comun && EXAM.comun.total) || 150; }
  function itemsAll() {
    return Object.keys(EXAM.preguntas).map(Number).sort(function (a, b) { return a - b; });
  }
  function materiaDe(n) {
    var g = (EXAM.materiasItems || {})[String(n)];
    if (g) return g;
    var sp = specialties(), ks = Object.keys(sp), m;
    for (var i = 0; i < ks.length; i++) { m = sp[ks[i]].materias[String(n)]; if (m) return m; }
    return 'General';
  }
  function questionsOf(id) { spec(id); return itemsAll().map(function (n) { var q = EXAM.preguntas[String(n)]; return { n: n, m: materiaDe(n), stem: q.stem, options: q.options }; }); }
  function pass() { var st = settings(); return st.minAprob && st.minAprob > 0 ? st.minAprob : CFG.MIN_APROB; }
  function maxInt() { var st = settings(); return st.intentos > 0 ? st.intentos : CFG.INTENTOS; }

  function publicUser(u) {
    return { id: u.id, usuario: u.usuario, rol: u.rol, nombre: u.nombre, apellidos: u.apellidos || '', email: u.email || '',
      whatsapp: u.whatsapp || '', especialidad: u.especialidad || '', matricula: u.matricula || '', activo: u.activo !== false, consentimiento: !!u.consentimiento,
      cargo: cargoDe(u), alcance: u.rol === 'alumno' ? u.especialidad || '' : alcance(u), prueba: !!u.prueba, ultimoAcceso: u.ultimoAcceso || null };
  }
  function hashPw(pw, salt) { var h = salt + '|' + pw; for (var i = 0; i < 250; i++) h = ctx.sha256(h + '|' + salt); return h; }
  function byName(usuario) { var un = U(usuario), a = ctx.store.list('users'); for (var i = 0; i < a.length; i++) if (a[i].usuario === un) return a[i]; return null; }
  function session(token) {
    if (!token) throw err('Inicie sesión.', 'AUTH');
    var s = ctx.store.get('sessions', token);
    if (!s || s.expira < now()) { if (s) ctx.store.remove('sessions', token); throw err('Su sesión expiró.', 'AUTH'); }
    var u = ctx.store.get('users', s.userId);
    if (!u || u.activo === false) throw err('Usuario no disponible.', 'AUTH');
    return u;
  }
  function need(u, roles) { if (roles.indexOf(u.rol) < 0) throw err('No tiene permiso para esta acción.', 'FORBIDDEN'); }
  /* Roles del personal:
     admin       Coordinador: todo, incluido borrar información (único rol que puede borrar).
     ensenanza   Jefe de enseñanza: todo igual que el coordinador, excepto borrar.
     calificador (heredado) se trata igual que enseñanza.
     jefe        Jefe de servicio (de una subespecialidad): inscribe sustentantes, ve resultados,
                 marca reactivos para revisión y opina, y cambia el dictamen correcta/incorrecta
                 de una respuesta con justificación.
     titular     Titular de subespecialidad (o de Pediatría si especialidad = 'pediatria', con
                 alcance a todas): revisa exámenes y resultados, marca reactivos y opina,
                 inscribe sustentantes. */
  var FULL = ['admin', 'ensenanza', 'calificador'];
  var STAFF = ['admin', 'ensenanza', 'calificador', 'jefe', 'titular'];
  var ROLES_PERSONAL = ['admin', 'ensenanza', 'jefe', 'titular'];
  function full(u) { return FULL.indexOf(u.rol) >= 0; }
  /* null = todas las subespecialidades; texto = solo esa subespecialidad */
  function alcance(u) {
    if (full(u)) return null;
    if (u.rol === 'titular' && (!u.especialidad || u.especialidad === 'pediatria')) return null;
    return u.especialidad || '__ninguna__';
  }
  function enAlcance(u, espId) { var a = alcance(u); return a === null || a === espId; }
  function cargoDe(u) {
    if (u.rol === 'admin') return 'Coordinador(a)';
    if (u.rol === 'ensenanza' || u.rol === 'calificador') return 'Jefe(a) de enseñanza';
    if (u.rol === 'jefe') return 'Jefe(a) de servicio · ' + ((specialties()[u.especialidad] || {}).nombre || '');
    if (u.rol === 'titular') return u.especialidad && u.especialidad !== 'pediatria' ? 'Titular · ' + ((specialties()[u.especialidad] || {}).nombre || '') : 'Titular de Pediatría';
    return 'Sustentante';
  }
  function audit(o) { o.id = 'au_' + ctx.rand(8); o.fecha = now(); ctx.store.put('audit', o); }

  function makeUser(p, rol) {
    var usuario = U(p.usuario), pw = N(p.password);
    if (!/^[a-z0-9._\-@]{1,40}$/.test(usuario)) throw err('Usuario inválido (solo letras, números, punto, guion o @).');
    if (pw.length < 6) throw err('La contraseña debe tener al menos 6 caracteres.');
    if (!N(p.nombre)) throw err('Capture el nombre.');
    if (byName(usuario)) throw err('El usuario "' + usuario + '" ya existe.');
    var u = { id: 'u_' + ctx.rand(8), usuario: usuario, rol: rol, nombre: N(p.nombre), apellidos: N(p.apellidos), email: U(p.email),
      whatsapp: N(p.whatsapp), matricula: N(p.matricula), activo: true, creado: now(), fallos: 0 };
    if (rol === 'alumno') {
      if (!u.apellidos) throw err('Capture los apellidos.');
      if (!u.email || u.email.indexOf('@') < 1) throw err('Capture un correo electrónico válido: ahí se enviará su temario.');
      u.especialidad = N(p.especialidad); spec(u.especialidad);
      if (!u.matricula) u.matricula = usuario.toUpperCase();
      if (p.prueba === true) u.prueba = true;
    }
    if (rol === 'jefe') { u.especialidad = N(p.especialidad); spec(u.especialidad); }
    if (rol === 'titular') { u.especialidad = N(p.especialidad) || 'pediatria'; if (u.especialidad !== 'pediatria') spec(u.especialidad); }
    u.salt = ctx.rand(12); u.hash = hashPw(pw, u.salt);
    ctx.store.put('users', u); return u;
  }

  var A = {};
  A.status = function () {
    var adm = ctx.store.list('users').filter(function (u) { return u.rol === 'admin'; });
    return { needsSetup: !adm.length, especialidades: Object.keys(specialties()).map(function (k) { return { id: k, nombre: specialties()[k].nombre, items: itemsAll().length }; }),
      examen: { total: totalOficial(), activos: itemsAll().length, anulados: anulados(), comun: true },
      minAprob: pass(), intentos: maxInt(), config: { proveedorCorreo: ctx.canalCorreo ? ctx.canalCorreo() : 'simulado', proveedorWhatsApp: ctx.canalWhatsapp ? ctx.canalWhatsapp() : 'simulado' } };
  };
  A.setup = function (p) {
    return ctx.store.lock(function () {
      if (!A.status().needsSetup) throw err('El sistema ya fue configurado.');
      var u = makeUser(p, 'admin'); return { ok: true, usuario: u.usuario };
    });
  };
  A.login = function (p) {
    return ctx.store.lock(function () {
      var u = byName(p.usuario), bad = err('Usuario o contraseña incorrectos.', 'LOGIN');
      if (!u) throw bad;
      if (u.activo === false) throw err('Usuario desactivado. Consulte a su coordinador.', 'LOGIN');
      if (u.bloqueo && u.bloqueo > now()) throw err('Demasiados intentos. Espere ' + Math.ceil((u.bloqueo - now()) / 60000) + ' min.', 'LOGIN');
      if (hashPw(N(p.password), u.salt) !== u.hash) {
        u.fallos = (u.fallos || 0) + 1;
        if (u.fallos >= 5) { u.bloqueo = now() + 10 * 60000; u.fallos = 0; }
        ctx.store.put('users', u); throw bad;
      }
      u.fallos = 0; u.bloqueo = 0; u.ultimoAcceso = now(); ctx.store.put('users', u);
      var tok = ctx.rand(24);
      ctx.store.put('sessions', { id: tok, userId: u.id, creada: now(), expira: now() + CFG.SESION_HORAS * 3600000 });
      return { token: tok, user: publicUser(u) };
    });
  };
  /* ---------- acceso con correo de Google ---------- */
  function dominiosDe() {
    var r = ctx.store.get('cfg', 'dominios_google');
    if (r && r.lista) return r.lista;
    return (settings().dominiosGoogle || []);
  }
  A.setDominios = function (p, t) {
    var u = session(t); need(u, FULL);
    var lista = ((p && p.dominios) || []).map(function (d) {
      return String(d).replace(/^@/, '').toLowerCase().trim();
    }).filter(Boolean);
    ctx.store.put('cfg', { id: 'dominios_google', lista: lista, actualizado: now(), usuario: u.usuario });
    ctx.store.put('audit', { id: 'au_' + ctx.rand(8), tipo: 'dominios_google', dominios: lista, usuario: u.usuario, fecha: now() });
    return { dominios: lista };
  };
  A.loginConfig = function () {
    return { googleClientId: ctx.googleClientId || '',
      dominios: dominiosDe(),
      motor: MOTOR, totalReactivos: totalOficial(), reactivosActivos: itemsAll().length, anulados: anulados() };
  };
  A.googleLogin = function (p) {
    return ctx.store.lock(function () {
      if (!ctx.googleClientId) throw err('El acceso con Google no está configurado. Falta GOOGLE_CLIENT_ID en el servidor.', 'GOOGLE');
      if (!ctx.httpGet) throw err('El servidor no puede validar credenciales de Google.', 'GOOGLE');
      if (!p || !p.credential) throw err('No se recibió la credencial de Google.', 'GOOGLE');
      var raw;
      try { raw = ctx.httpGet('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(p.credential))); }
      catch (e) { throw err('No se pudo validar la credencial con Google. Intente de nuevo.', 'GOOGLE'); }
      var g; try { g = JSON.parse(raw); } catch (e) { throw err('Respuesta inválida de Google.', 'GOOGLE'); }
      if (g.error || g.error_description) throw err('La credencial de Google no es válida o expiró.', 'GOOGLE');
      if (String(g.aud) !== String(ctx.googleClientId)) throw err('La credencial no corresponde a esta aplicación.', 'GOOGLE');
      if (String(g.email_verified) !== 'true') throw err('Su correo de Google no está verificado.', 'GOOGLE');
      if (g.exp && Number(g.exp) * 1000 < now()) throw err('La credencial de Google expiró.', 'GOOGLE');
      var email = String(g.email || '').toLowerCase().trim();
      if (!email || email.indexOf('@') < 1) throw err('La credencial no contiene un correo válido.', 'GOOGLE');
      var dom = dominiosDe();
      var permitido = !dom.length || dom.some(function (d) {
        d = String(d).replace(/^@/, '').toLowerCase(); return email.slice(-(d.length + 1)) === '@' + d;
      });
      if (!permitido) throw err('El dominio de su correo (' + email.split('@')[1] + ') no está autorizado para este examen.', 'GOOGLE');
      var u = null;
      ctx.store.list('users').forEach(function (x) {
        if (u) return;
        var em = String(x.email || '').toLowerCase().trim();
        if (em && em === email) u = x;
        else if (!em && String(x.usuario || '').toLowerCase() === email) u = x;
      });
      if (!u) throw err('Su correo ' + email + ' no está inscrito. Solicite su alta al coordinador de la evaluación.', 'GOOGLE');
      if (u.activo === false) throw err('Su cuenta está desactivada. Consulte a su coordinador.', 'LOGIN');
      u.ultimoAcceso = now(); u.accesoGoogle = { email: email, dominio: g.hd || email.split('@')[1], fecha: now() };
      ctx.store.put('users', u);
      var tok = ctx.rand(24);
      ctx.store.put('sessions', { id: tok, userId: u.id, expira: now() + 12 * 60 * 60 * 1000 });
      ctx.store.put('audit', { id: 'au_' + ctx.rand(8), tipo: 'acceso_google', usuario: u.usuario, email: email, fecha: now() });
      return { token: tok, user: publicUser(u), via: 'google' };
    });
  };
  /* ---------- restablecimiento de contraseña por correo ---------- */
  var RESET_MIN = 30, RESET_TOPE = 5, ALFA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function tokHash(t) { return ctx.sha256('reset|' + String(t)); }
  function codigoReset() {
    var out = '', b = ctx.randBytes ? ctx.randBytes(8) : null;
    for (var i = 0; i < 8; i++) {
      var n = b ? b[i] : parseInt(ctx.rand(2), 16);
      out += ALFA.charAt(n % ALFA.length);
    }
    return out;
  }
  function enlaceReset(codigo) {
    var base = String(settings().urlBase || ctx.urlBase || '').replace(/\/+$/, '');
    return { codigo: codigo, enlace: (base ? base + '/' : '') + '#r=' + codigo, base: base };
  }
  function buscaReset(codigo) {
    var th = tokHash(N(codigo).toUpperCase().trim()), r = null;
    ctx.store.list('resets').forEach(function (x) { if (!r && x.th === th) r = x; });
    return r;
  }
  A.forgotPassword = function (p) {
    return ctx.store.lock(function () {
      var generico = { ok: true, mensaje: 'Si el dato corresponde a una cuenta registrada, enviamos un código al correo asociado. Caduca en ' + RESET_MIN + ' minutos.' };
      var id = N(p.usuario || p.email).toLowerCase().trim();
      if (!id) return generico;
      var u = null;
      ctx.store.list('users').forEach(function (x) {
        if (u) return;
        var em = String(x.email || '').toLowerCase().trim();
        if (String(x.usuario || '').toLowerCase() === id || (em && em === id)) u = x;
      });
      if (!u || u.activo === false || !u.email) return generico;
      var hora = now() - 3600000;
      var rec = ctx.store.list('resets').filter(function (x) { return x.userId === u.id && x.creado > hora; });
      if (rec.length >= RESET_TOPE) return generico;
      var q = enlaceReset(codigoReset());
      ctx.store.put('resets', { id: 'rs_' + ctx.rand(8), userId: u.id, th: tokHash(q.codigo),
        creado: now(), expira: now() + RESET_MIN * 60000, usado: false });
      var texto = 'Hola ' + u.nombre + ':\n\nSe solicitó restablecer la contraseña del sistema de evaluación de ' +
        'subespecialidades pediátricas para la cuenta ' + u.usuario + '.\n\nCódigo de un solo uso: ' + q.codigo +
        (q.base ? '\nEnlace directo: ' + q.enlace : '\nAbra el sistema, elija «Ya tengo un código» y escriba el código.') +
        '\n\nCaduca en ' + RESET_MIN + ' minutos y sirve una sola vez. Si usted no lo solicitó, ignore este mensaje: ' +
        'su contraseña actual sigue vigente y no se modificó nada.\n\nCoordinación de la evaluación';
      deliver(enqueue({ canal: 'correo', para: u.email, nombre: u.nombre, tipo: 'reset', codigo: q.codigo,
        asunto: 'Restablecer contraseña · Evaluación de subespecialidades', cuerpo: texto }), { tipo: 'reset', usuario: u.usuario });
      return generico;
    });
  };
  A.resetInfo = function (p) {
    var r = buscaReset(p.token);
    if (!r || r.usado || r.expira < now()) return { valido: false };
    var u = ctx.store.get('users', r.userId) || {};
    return { valido: true, usuario: u.usuario, nombre: u.nombre, expira: r.expira, minutos: Math.max(1, Math.round((r.expira - now()) / 60000)) };
  };
  A.resetPassword = function (p) {
    return ctx.store.lock(function () {
      var nueva = N(p.nueva);
      if (nueva.length < 6) throw err('La nueva contraseña debe tener al menos 6 caracteres.');
      var r = buscaReset(p.token);
      if (!r || r.usado) throw err('El código no es válido o ya fue utilizado. Solicite uno nuevo.');
      if (r.expira < now()) throw err('El código caducó. Solicite uno nuevo.');
      var u = ctx.store.get('users', r.userId);
      if (!u || u.activo === false) throw err('La cuenta no está disponible.');
      u.salt = ctx.rand(12); u.hash = hashPw(nueva, u.salt); u.fallos = 0; u.bloqueo = 0; u.ultimoCambio = now();
      ctx.store.put('users', u);
      r.usado = true; r.usadoEn = now(); ctx.store.put('resets', r);
      ctx.store.list('resets').forEach(function (x) { if (x.userId === u.id && !x.usado) { x.usado = true; x.revocado = now(); ctx.store.put('resets', x); } });
      ctx.store.list('sessions').forEach(function (s) { if (s.userId === u.id) ctx.store.remove('sessions', s.id); });
      ctx.store.put('audit', { id: 'au_' + ctx.rand(8), tipo: 'password_restablecida', usuario: u.usuario, fecha: now() });
      deliver(enqueue({ canal: 'correo', para: u.email || '', nombre: u.nombre, tipo: 'reset_hecho',
        asunto: 'Su contraseña fue restablecida', cuerpo: 'La contraseña de la cuenta ' + u.usuario + ' se restableció el ' + fdt(now()) + '. Si no reconoce esta acción, avise de inmediato al coordinador.' }), { tipo: 'reset_hecho' });
      return { ok: true, usuario: u.usuario };
    });
  };
  A.resetLink = function (p, t) {
    return ctx.store.lock(function () {
      var me = session(t); need(me, FULL);
      var u = ctx.store.get('users', p.id); if (!u) throw err('Usuario no encontrado.');
      if (u.rol === 'admin' && me.rol !== 'admin') throw err('Solo el coordinador puede restablecer la contraseña de otro coordinador.', 'FORBIDDEN');
      var q = enlaceReset(codigoReset());
      ctx.store.put('resets', { id: 'rs_' + ctx.rand(8), userId: u.id, th: tokHash(q.codigo), creado: now(),
        expira: now() + RESET_MIN * 60000, usado: false, generadoPor: me.usuario });
      ctx.store.put('audit', { id: 'au_' + ctx.rand(8), tipo: 'reset_link_generado', usuario: u.usuario, por: me.usuario, fecha: now() });
      return { usuario: u.usuario, correo: u.email || '', codigo: q.codigo, enlace: q.enlace, minutos: RESET_MIN };
    });
  };
  A.logout = function (p, t) { if (t) ctx.store.remove('sessions', t); return { ok: true }; };
  A.me = function (p, t) { return { user: publicUser(session(t)) }; };
  A.changePassword = function (p, t) {
    var u = session(t);
    if (hashPw(N(p.actual), u.salt) !== u.hash) throw err('La contraseña actual no es correcta.');
    if (N(p.nueva).length < 6) throw err('La nueva contraseña debe tener al menos 6 caracteres.');
    u.salt = ctx.rand(12); u.hash = hashPw(N(p.nueva), u.salt); ctx.store.put('users', u); return { ok: true };
  };

  /* ---------- consentimiento ---------- */
  A.consentText = function (p, t) {
    session(t); var st = settings();
    return { version: st.consentVersion || '2026-1', minimo: pass(), especialidades: specialties() };
  };
  A.signConsent = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, ['alumno']);
      if (p.acepta !== true) throw err('Debe aceptar el consentimiento para continuar.');
      if (!N(p.nombreCompleto)) throw err('Escriba su nombre completo como firma.');
      if (U(N(p.nombreCompleto)).replace(/\s+/g, ' ') !== U(u.nombre + ' ' + u.apellidos).replace(/\s+/g, ' ') &&
          U(N(p.nombreCompleto)).replace(/\s+/g, ' ') !== U(u.apellidos + ' ' + u.nombre).replace(/\s+/g, ' '))
        throw err('El nombre escrito no coincide con el de su registro: ' + u.nombre + ' ' + u.apellidos + '.');
      var rec = { id: 'c_' + ctx.rand(8), userId: u.id, tipo: 'consentimiento', nombreCompleto: N(p.nombreCompleto), version: (settings().consentVersion || '2026-1'),
        fecha: now(), huella: ctx.sha256(u.id + '|' + N(p.nombreCompleto) + '|' + now()), texto: p.textoAceptado || '' };
      ctx.store.put('consents', rec);
      u.consentimiento = true; u.consentimientoFecha = now(); ctx.store.put('users', u);
      return { ok: true, fecha: rec.fecha };
    });
  };
  A.signConfidentiality = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, ['alumno']);
      if (p.acepta !== true) throw err('Debe firmar el acuerdo de confidencialidad.');
      if (!N(p.nombreCompleto)) throw err('Escriba su nombre completo como firma.');
      var rec = { id: 'c_' + ctx.rand(8), userId: u.id, tipo: 'confidencialidad', nombreCompleto: N(p.nombreCompleto), version: '2026-1', fecha: now(),
        huella: ctx.sha256(u.id + '|conf|' + N(p.nombreCompleto) + '|' + now()) };
      ctx.store.put('consents', rec);
      u.confidencialidad = true; u.confidencialidadFecha = now(); ctx.store.put('users', u);
      return { ok: true, fecha: rec.fecha };
    });
  };

  /* ---------- calificación ---------- */
  var MOTOR = '1.1';
  function correctaOriginal(respuestas, n) { var r = respuestas[String(n)]; return !!(r && String(r).toLowerCase() === EXAM.clave[String(n)]); }
  /* ajustes: dictámenes del jefe de servicio / enseñanza / coordinador que sustituyen la comparación con la clave */
  function scoreOf(respuestas, espId, minimo, ajustes) {
    var sp = spec(espId), mats = {}, ok = 0, tot = 0; ajustes = ajustes || {};
    itemsAll().forEach(function (n) {
      var m = materiaDe(n);
      mats[m] = mats[m] || { ok: 0, total: 0 }; mats[m].total++; tot++;
      var aj = ajustes[String(n)];
      var bien = aj ? aj.dictamen === 'correcta' : correctaOriginal(respuestas, n);
      if (bien) { mats[m].ok++; ok++; }
    });
    var areas = Object.keys(mats).map(function (m) { var o = mats[m]; return { materia: m, ok: o.ok, total: o.total, pct: Math.round(o.ok / o.total * 100) }; })
      .sort(function (x, y) { return y.pct - x.pct; });
    var cal = Math.max(1, Math.round(ok / tot * 100));
    return { aciertos: ok, total: tot, calificacion: cal, estatus: cal >= minimo ? 'APROBADO' : 'NO APROBADO',
      areas: areas, fuertes: areas.filter(function (x) { return x.pct >= 70; }),
      oportunidades: areas.filter(function (x) { return x.pct < 70; }).sort(function (x, y) { return x.pct - y.pct; }) };
  }
  function grade(a) {
    var s = scoreOf(a.respuestas || {}, a.especialidad, pass(), a.ajustes);
    a.aciertos = s.aciertos; a.total = s.total; a.calificacion = s.calificacion; a.estatus = s.estatus;
    a.areas = s.areas; a.fuertes = s.fuertes; a.oportunidades = s.oportunidades;
    a.estado = 'emitido'; a.emitido = now(); a.minimo = pass(); a.motor = MOTOR;
    return a;
  }
  function view(a) {
    return { id: a.id, num: a.num, estado: a.estado, inicio: a.inicio, emitido: a.emitido || null, aciertos: a.aciertos, total: a.total,
      calificacion: a.calificacion, estatus: a.estatus, minimo: a.minimo, areas: a.areas, fuertes: a.fuertes, oportunidades: a.oportunidades,
      contestadas: Object.keys(a.respuestas || {}).length, especialidad: a.especialidad, motor: a.motor || '1.0', recalificado: a.recalificado || null,
      ajustes: Object.keys(a.ajustes || {}).length };
  }
  function attemptsOf(uid) { return ctx.store.list('attempts').filter(function (a) { return a.userId === uid; }).sort(function (x, y) { return x.num - y.num; }); }
  function closed(a) { return a.estado === 'emitido'; }

  A.myStatus = function (p, t) {
    var u = session(t); need(u, ['alumno']);
    var at = attemptsOf(u.id);
    return { user: publicUser(u), especialidad: spec(u.especialidad), max: maxInt(), usados: at.length, restantes: Math.max(0, maxInt() - at.length),
      consentimiento: !!u.consentimiento, confidencialidad: !!u.confidencialidad, consentimientoFecha: u.consentimientoFecha || null,
      enCurso: at.filter(function (a) { return a.estado === 'en_curso'; })[0] ? { id: at.filter(function (a) { return a.estado === 'en_curso'; })[0].id, num: at.filter(function (a) { return a.estado === 'en_curso'; })[0].num, inicio: at.filter(function (a) { return a.estado === 'en_curso'; })[0].inicio } : null,
      resultado: at.filter(closed)[0] ? view(at.filter(closed)[0]) : null, minimo: pass() };
  };

  A.startAttempt = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, ['alumno']);
      if (!u.consentimiento) throw err('Debe firmar el consentimiento antes de iniciar el examen.', 'CONSENT');
      var at = attemptsOf(u.id);
      var a = at.filter(function (x) { return x.estado === 'en_curso'; })[0];
      if (!a) {
        if (at.length >= maxInt()) throw err('Ya utilizó sus ' + maxInt() + ' oportunidad(es).', 'LIMIT');
        a = { id: 'a_' + ctx.rand(8), userId: u.id, num: at.length + 1, especialidad: u.especialidad, estado: 'en_curso', inicio: now(),
          respuestas: {}, incidencias: 0, consentimiento: u.consentimientoFecha };
        ctx.store.put('attempts', a);
      }
      return { attemptId: a.id, num: a.num, max: maxInt(), inicio: a.inicio, servidor: now(), respuestas: a.respuestas,
        especialidad: { id: u.especialidad, nombre: spec(u.especialidad).nombre },
        alumno: { nombre: u.nombre, apellidos: u.apellidos, matricula: u.matricula, email: u.email },
        questions: questionsOf(u.especialidad), minimo: pass() };
    });
  };
  function own(u, id) {
    var a = ctx.store.get('attempts', id);
    if (!a || a.userId !== u.id) throw err('Intento no encontrado.');
    if (closed(a)) throw err('Este resultado ya fue emitido y no puede modificarse.', 'CLOSED');
    return a;
  }
  function clean(ans) { var o = {}; if (!ans || typeof ans !== 'object') return o; for (var k in ans) if (EXAM.preguntas[k] && /^[abcd]$/.test(ans[k])) o[k] = ans[k]; return o; }
  A.saveAnswers = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, ['alumno']); var a = own(u, p.attemptId);
      var an = clean(p.respuestas); for (var k in an) a.respuestas[k] = an[k];
      ctx.store.put('attempts', a); return { ok: true, guardadas: Object.keys(a.respuestas).length };
    });
  };
  A.submitAttempt = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, ['alumno']); var a = own(u, p.attemptId);
      var an = clean(p.respuestas); for (var k in an) a.respuestas[k] = an[k];
      grade(a); ctx.store.put('attempts', a);
      var jobs = notifyResult(u, a);
      return { result: view(a), debrief: debrief(a), notificaciones: jobs, restantes: Math.max(0, maxInt() - attemptsOf(u.id).length) };
    });
  };
  function debrief(a) {
    var sp = spec(a.especialidad);
    var est = {};
    a.oportunidades.forEach(function (o) { est[o.materia] = STUDY[o.materia] || { temas: [], biblio: [] }; });
    return { especialidad: sp.nombre, calificacion: a.calificacion, minimo: a.minimo, aciertos: a.aciertos, total: a.total,
      fuertes: a.fuertes, oportunidades: a.oportunidades.map(function (o) { return { materia: o.materia, pct: o.pct, ok: o.ok, total: o.total, temas: (STUDY[o.materia] || {}).temas || [], biblio: (STUDY[o.materia] || {}).biblio || [] }; }),
      mensaje: a.estatus === 'APROBADO'
        ? 'Acreditó el examen con ' + a.calificacion + '/100 (mínimo ' + a.minimo + '). Conserve las áreas con menor puntaje como plan de actualización continua.'
        : 'No acreditó: obtuvo ' + a.calificacion + '/100 y se requieren ' + a.minimo + '. El resultado es definitivo; abajo encontrará los temas y la bibliografía para su preparación.' };
  }

  /* ---------- notificaciones ---------- */
  function canal() { return { correo: ctx.canalCorreo ? ctx.canalCorreo() : 'simulado', whatsapp: ctx.canalWhatsapp ? ctx.canalWhatsapp() : 'simulado' }; }
  function institucion() {
    var g = settings().institucion || {};
    return { titularPediatria: g.titularPediatria || '', titularPediatriaEmail: g.titularPediatriaEmail || '', titularPediatriaTel: g.titularPediatriaTel || '',
      jefeEnsenanza: g.jefeEnsenanza || '', jefeEnsenanzaEmail: g.jefeEnsenanzaEmail || '', jefeEnsenanzaTel: g.jefeEnsenanzaTel || '' };
  }
  function destino(sp) {
    var cfgS = (settings().especialidades || {})[sp] || {};
    return { jefe: cfgS.jefe || '', jefeEmail: cfgS.jefeEmail || '', jefeTel: cfgS.jefeTel || '',
      titular: cfgS.titular || '', titularEmail: cfgS.titularEmail || '', titularTel: cfgS.titularTel || '' };
  }
  function enqueue(o) {
    var job = { id: 'n_' + ctx.rand(8), creado: now(), estado: 'pendiente', proveedor: '', detalle: '', intentos: 0 };
    for (var k in o) job[k] = o[k];
    ctx.store.put('notifications', job);
    return job;
  }
  function deliver(job, payload) {
    try {
      var r = ctx.send ? ctx.send(job, payload) : { ok: false, detalle: 'Canal no configurado' };
      job.estado = r.ok ? 'enviado' : 'error'; job.proveedor = r.proveedor || canal()[job.canal] || 'simulado'; job.detalle = r.detalle || '';
      job.enviado = now(); job.intentos = (job.intentos || 0) + 1;
    } catch (e) { job.estado = 'error'; job.detalle = String(e && e.message || e); }
    ctx.store.put('notifications', job);
    return job;
  }
  function notifyResult(u, a) {
    var d = destino(a.especialidad), sp = spec(a.especialidad).nombre, out = [];
    var resumen = u.apellidos + ', ' + u.nombre + ' · ' + sp + ' · ' + a.calificacion + '/100 · ' + a.estatus +
      ' (aciertos ' + a.aciertos + '/' + a.total + ', mínimo ' + a.minimo + ')';
    var g = institucion();
    var dests = [['jefe de servicio', d.jefe, d.jefeEmail, d.jefeTel], ['titular de la especialidad', d.titular, d.titularEmail, d.titularTel],
      ['titular de pediatría', g.titularPediatria, g.titularPediatriaEmail, g.titularPediatriaTel], ['jefe de enseñanza', g.jefeEnsenanza, g.jefeEnsenanzaEmail, g.jefeEnsenanzaTel]];
    var vistos = {};
    dests = dests.filter(function (x) { var k = (x[2] || '') + '|' + (x[3] || ''); if (k === '|' || vistos[k]) return false; vistos[k] = 1; return true; });
    dests.forEach(function (x) {
      if (x[2]) out.push(deliver(enqueue({ canal: 'correo', para: x[2], nombre: x[1], asunto: 'Resultado de examen · ' + sp + ' · ' + u.apellidos, tipo: 'resultado', intento: a.id, folio: u.matricula, cuerpo: resumen }), { tipo: 'resultado', alumno: u, intento: a }));
      if (x[3]) out.push(deliver(enqueue({ canal: 'whatsapp', para: x[3], nombre: x[1], asunto: 'Resultado', tipo: 'resultado', intento: a.id, folio: u.matricula, cuerpo: resumen }), { tipo: 'resultado', alumno: u, intento: a }));
    });
    if (u.email) out.push(deliver(enqueue({ canal: 'correo', para: u.email, nombre: u.nombre, asunto: 'Su resultado del examen · ' + sp, tipo: 'resultado_alumno', intento: a.id, folio: u.matricula, cuerpo: resumen }), { tipo: 'resultado', alumno: u, intento: a }));
    return out.map(function (j) { return { canal: j.canal, para: j.para, estado: j.estado, detalle: j.detalle }; });
  }
  function notifyEnrollment(u) {
    var sp = spec(u.especialidad).nombre, d = destino(u.especialidad);
    var job = enqueue({ canal: 'correo', para: u.email, nombre: u.nombre, asunto: 'Temario de estudio · ' + sp, tipo: 'temario', folio: u.matricula,
      cuerpo: 'Temario y bibliografía para ' + sp });
    var j = deliver(job, { tipo: 'temario', alumno: u });
    ctx.store.put('users', u);
    return [{ canal: j.canal, para: j.para, estado: j.estado, detalle: j.detalle }];
  }

  /* ---------- alumno: PDFs y debrief ---------- */
  A.myDebrief = function (p, t) {
    var u = session(t); need(u, ['alumno']);
    var a = attemptsOf(u.id).filter(closed)[0];
    if (!a) throw err('Aún no tiene resultado.');
    return { debrief: debrief(a), resultado: view(a) };
  };
  A.myPdf = function (p, t) {
    var u = session(t); need(u, ['alumno']);
    if (p.tipo === 'temario') return { base64: ctx.b64(ctx.pdf.temario(u)), nombre: 'Temario_' + u.especialidad + '.pdf' };
    var a = attemptsOf(u.id).filter(closed)[0];
    if (!a) throw err('Aún no tiene resultado.');
    return { base64: ctx.b64(ctx.pdf.constancia(u, a)), nombre: 'Resultado_' + u.matricula + '.pdf' };
  };

  /* ---------- personal ---------- */
  A.listResults = function (p, t) {
    var u = session(t); need(u, STAFF);
    var users = {}; ctx.store.list('users').forEach(function (x) { users[x.id] = x; });
    var rows = ctx.store.list('attempts').filter(function (a) { return enAlcance(u, a.especialidad); }).map(function (a) {
      var s = users[a.userId] || {}, r = view(a);
      r.userId = a.userId; r.nombre = s.nombre || ''; r.apellidos = s.apellidos || ''; r.matricula = s.matricula || '';
      r.email = s.email || ''; r.especialidadNombre = spec(a.especialidad).nombre;
      return r;
    });
    var esps = {}, al = alcance(u);
    Object.keys(specialties()).forEach(function (k) { if (al === null || al === k) esps[k] = specialties()[k]; });
    return { rows: rows, minAprob: pass(), especialidades: esps,
      config: full(u) ? (settings().especialidades || {}) : {} };
  };
  function revisionesDe(n) {
    return ctx.store.list('revisiones').filter(function (r) { return n == null || String(r.n) === String(n); })
      .sort(function (a, b) { return a.fecha - b.fecha; });
  }
  A.attemptDetail = function (p, t) {
    var u = session(t); need(u, STAFF);
    var a = ctx.store.get('attempts', p.id); if (!a) throw err('Intento no encontrado.');
    if (!enAlcance(u, a.especialidad)) throw err('Este examen no corresponde a su subespecialidad.', 'FORBIDDEN');
    var owner = ctx.store.get('users', a.userId) || {};
    var marcas = {};
    revisionesDe().forEach(function (r) { marcas[r.n] = (marcas[r.n] || 0) + 1; });
    return { attempt: view(a), alumno: { nombre: owner.nombre, apellidos: owner.apellidos, matricula: owner.matricula, email: owner.email },
      respuestas: a.respuestas, clave: EXAM.clave, preguntas: questionsOf(a.especialidad), especialidad: spec(a.especialidad).nombre,
      ajustes: a.ajustes || {}, marcas: marcas,
      puedeAjustar: closed(a) && (full(u) || (u.rol === 'jefe' && u.especialidad === a.especialidad)),
      consentimientos: ctx.store.list('consents').filter(function (c) { return c.userId === a.userId; }),
      incidencias: ctx.store.list('incidents').filter(function (i) { return i.attemptId === a.id; }) };
  };
  /* Cambio de dictamen de una respuesta (correcta ↔ incorrecta), siempre con justificación. */
  A.ajustarRespuesta = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, ['admin', 'ensenanza', 'calificador', 'jefe']);
      var a = ctx.store.get('attempts', p.attemptId); if (!a) throw err('Intento no encontrado.');
      if (!closed(a)) throw err('Solo se puede ajustar un examen ya emitido.');
      if (u.rol === 'jefe' && u.especialidad !== a.especialidad) throw err('Solo puede ajustar exámenes de su subespecialidad.', 'FORBIDDEN');
      var n = String(p.n);
      if (!EXAM.preguntas[n]) throw err('Reactivo no válido.');
      var just = N(p.justificacion);
      if (just.length < 15) throw err('Escriba la justificación del cambio (al menos 15 caracteres).');
      var orig = correctaOriginal(a.respuestas || {}, n) ? 'correcta' : 'incorrecta';
      a.ajustes = a.ajustes || {};
      var previo = a.ajustes[n] ? a.ajustes[n].dictamen : orig;
      var dictamen = p.dictamen === 'original' ? orig : (p.dictamen === 'correcta' ? 'correcta' : (p.dictamen === 'incorrecta' ? 'incorrecta' : ''));
      if (!dictamen) throw err('Indique si la respuesta queda como correcta o incorrecta.');
      if (dictamen === previo) throw err('La respuesta ya está registrada como ' + dictamen + '.');
      var antes = { aciertos: a.aciertos, calificacion: a.calificacion, estatus: a.estatus };
      var hist = (a.ajustes[n] && a.ajustes[n].historial) || [];
      hist.push({ de: previo, a: dictamen, justificacion: just, por: u.usuario, nombre: (u.nombre + ' ' + (u.apellidos || '')).trim(), cargo: cargoDe(u), fecha: now() });
      if (dictamen === orig) { a.ajustes[n] = { dictamen: dictamen, original: orig, revertido: true, historial: hist, justificacion: just, por: u.usuario, cargo: cargoDe(u), fecha: now() }; }
      else a.ajustes[n] = { dictamen: dictamen, original: orig, historial: hist, justificacion: just, por: u.usuario, cargo: cargoDe(u), fecha: now() };
      if (a.ajustes[n].revertido) { var h2 = a.ajustes[n].historial; delete a.ajustes[n]; a.ajustesHistorial = a.ajustesHistorial || {}; a.ajustesHistorial[n] = h2; }
      var s = scoreOf(a.respuestas || {}, a.especialidad, a.minimo || pass(), a.ajustes);
      a.aciertos = s.aciertos; a.total = s.total; a.calificacion = s.calificacion; a.estatus = s.estatus;
      a.areas = s.areas; a.fuertes = s.fuertes; a.oportunidades = s.oportunidades;
      ctx.store.put('attempts', a);
      var dueno = ctx.store.get('users', a.userId) || {};
      audit({ tipo: 'ajuste_respuesta', attemptId: a.id, matricula: dueno.matricula || '', reactivo: Number(n), de: previo, a: dictamen,
        justificacion: just, antes: antes, despues: { aciertos: a.aciertos, calificacion: a.calificacion, estatus: a.estatus }, usuario: u.usuario, cargo: cargoDe(u) });
      return { ok: true, attempt: view(a), ajustes: a.ajustes, antes: antes };
    });
  };
  A.historialAjustes = function (p, t) {
    var u = session(t); need(u, STAFF);
    var a = ctx.store.get('attempts', p.attemptId); if (!a) throw err('Intento no encontrado.');
    if (!enAlcance(u, a.especialidad)) throw err('Este examen no corresponde a su subespecialidad.', 'FORBIDDEN');
    var out = [];
    function add(map) { Object.keys(map || {}).forEach(function (n) { ((map[n] && map[n].historial) || map[n] || []).forEach(function (h) { out.push({ n: Number(n), de: h.de, a: h.a, justificacion: h.justificacion, nombre: h.nombre, cargo: h.cargo, fecha: h.fecha }); }); }); }
    add(a.ajustes); add(a.ajustesHistorial);
    return { rows: out.sort(function (x, y) { return x.fecha - y.fecha; }) };
  };

  /* ---------- revisión de reactivos: marcas y opiniones ---------- */
  A.examReview = function (p, t) {
    var u = session(t); need(u, STAFF);
    var revs = revisionesDe(), by = {};
    revs.forEach(function (r) { (by[r.n] = by[r.n] || []).push(r); });
    var ems = ctx.store.list('attempts').filter(function (a) { return closed(a) && enAlcance(u, a.especialidad); });
    return { preguntas: itemsAll().map(function (n) {
      var q = EXAM.preguntas[String(n)], k = EXAM.clave[String(n)];
      var ok = ems.filter(function (a) { var aj = (a.ajustes || {})[String(n)]; return aj ? aj.dictamen === 'correcta' : correctaOriginal(a.respuestas || {}, n); }).length;
      return { n: n, m: materiaDe(n), stem: q.stem, options: q.options, clave: k, revisiones: by[n] || [],
        aciertos: ok, evaluados: ems.length };
    }), anulados: anulados(), puedeAtender: full(u), puedeBorrar: u.rol === 'admin' };
  };
  A.marcarReactivo = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, STAFF);
      var n = String(p.n); if (!EXAM.preguntas[n]) throw err('Reactivo no válido.');
      var op = N(p.opinion).slice(0, 2000);
      var motivo = N(p.motivo).slice(0, 80) || 'Revisión';
      var r = { id: 'rv_' + ctx.rand(8), n: Number(n), motivo: motivo, opinion: op, attemptId: N(p.attemptId) || '',
        userId: u.id, usuario: u.usuario, nombre: (u.nombre + ' ' + (u.apellidos || '')).trim(), cargo: cargoDe(u), rol: u.rol,
        fecha: now(), estado: 'abierta' };
      ctx.store.put('revisiones', r);
      audit({ tipo: 'reactivo_marcado', reactivo: r.n, revision: r.id, usuario: u.usuario });
      return { revision: r };
    });
  };
  A.atenderRevision = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, FULL);
      var r = ctx.store.get('revisiones', p.id); if (!r) throw err('Revisión no encontrada.');
      r.estado = p.estado === 'abierta' ? 'abierta' : 'atendida';
      r.respuesta = N(p.respuesta).slice(0, 2000); r.atendidaPor = (u.nombre + ' ' + (u.apellidos || '')).trim(); r.atendidaCargo = cargoDe(u); r.atendidaFecha = now();
      ctx.store.put('revisiones', r);
      audit({ tipo: 'revision_atendida', revision: r.id, reactivo: r.n, estado: r.estado, usuario: u.usuario });
      return { revision: r };
    });
  };
  A.borrarRevision = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, ['admin']);
      var r = ctx.store.get('revisiones', p.id); if (!r) throw err('Revisión no encontrada.');
      ctx.store.remove('revisiones', r.id);
      audit({ tipo: 'revision_borrada', revision: r.id, reactivo: r.n, usuario: u.usuario });
      return { ok: true };
    });
  };

  A.logIncident = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, ['alumno']);
      var a = ctx.store.get('attempts', p.attemptId); if (!a || a.userId !== u.id) return { ok: false };
      ctx.store.put('incidents', { id: 'i_' + ctx.rand(8), attemptId: a.id, userId: u.id, alumno: u.apellidos + ', ' + u.nombre, matricula: u.matricula,
        num: a.num, tipo: N(p.tipo).slice(0, 40), detalle: N(p.detalle).slice(0, 200), fecha: now() });
      return { ok: true };
    });
  };
  A.listStudents = function (p, t) {
    var u = session(t); need(u, STAFF);
    var at = ctx.store.list('attempts');
    return { puedeEditar: full(u), puedeBorrar: u.rol === 'admin', alcance: alcance(u),
      rows: ctx.store.list('users').filter(function (x) { return x.rol === 'alumno' && enAlcance(u, x.especialidad); }).map(function (x) {
      var mine = at.filter(function (a) { return a.userId === x.id; }), fin = mine.filter(closed);
      var pu = publicUser(x); pu.usados = mine.length; pu.resultado = fin[0] ? fin[0].calificacion : null; pu.estatus = fin[0] ? fin[0].estatus : '';
      pu.enCurso = mine.some(function (a) { return a.estado === 'en_curso'; }); return pu;
    }) };
  };
  /* Jefes de servicio y titulares de subespecialidad solo inscriben en su propia subespecialidad. */
  function espPermitida(u, r) {
    var al = alcance(u);
    if (al === null) return r;
    if (r.especialidad && r.especialidad !== al) throw err('Solo puede inscribir sustentantes de ' + spec(al).nombre + '.', 'FORBIDDEN');
    r.especialidad = al; return r;
  }
  A.createStudent = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, STAFF);
      var r = {}; for (var k in p) r[k] = p[k]; delete r.prueba;
      var n = makeUser(espPermitida(u, r), 'alumno');
      n.inscritoPor = u.usuario; ctx.store.put('users', n);
      audit({ tipo: 'alta_sustentante', alumno: n.usuario, especialidad: n.especialidad, usuario: u.usuario });
      var env = notifyEnrollment(n);
      return { user: publicUser(n), notificaciones: env };
    });
  };
  A.importStudents = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, STAFF);
      var ok = [], errs = [];
      (p.rows || []).slice(0, 300).forEach(function (r0, i) {
        try {
          var r = {}; for (var k in r0) r[k] = r0[k]; delete r.prueba;
          var n = makeUser(espPermitida(u, r), 'alumno'); n.inscritoPor = u.usuario; ctx.store.put('users', n);
          notifyEnrollment(n); ok.push(publicUser(n));
        }
        catch (e) { errs.push({ fila: i + 1, usuario: r0.usuario || r0.email || '', error: e.message }); }
      });
      if (ok.length) audit({ tipo: 'alta_masiva', creados: ok.length, usuario: u.usuario });
      return { creados: ok.length, errores: errs, lista: ok };
    });
  };
  A.updateUser = function (p, t) {
    return ctx.store.lock(function () {
      var me = session(t); need(me, FULL);
      var u = ctx.store.get('users', p.id); if (!u) throw err('Usuario no encontrado.');
      if (u.rol === 'admin' && me.rol !== 'admin') throw err('Solo el coordinador puede modificar a otro coordinador.', 'FORBIDDEN');
      ['nombre', 'apellidos', 'whatsapp', 'matricula'].forEach(function (k) { if (p[k] != null) u[k] = N(p[k]); });
      if (p.email != null) u.email = U(p.email);
      if (p.rol != null && u.rol !== 'alumno' && p.rol !== u.rol) {
        if (ROLES_PERSONAL.indexOf(p.rol) < 0) throw err('Rol no válido.');
        if ((p.rol === 'admin' || u.rol === 'admin') && me.rol !== 'admin') throw err('Solo el coordinador puede asignar o quitar el rol de coordinador.', 'FORBIDDEN');
        if (u.id === me.id) throw err('No puede cambiar su propio rol.');
        u.rol = p.rol;
      }
      var ne = p.especialidad != null ? N(p.especialidad) : null;
      if (u.rol === 'alumno' && ne) { spec(ne); u.especialidad = ne; }
      if (u.rol === 'jefe') { if (ne) u.especialidad = ne; spec(u.especialidad); }
      if (u.rol === 'titular') { if (ne != null) u.especialidad = ne || 'pediatria'; if (!u.especialidad) u.especialidad = 'pediatria'; if (u.especialidad !== 'pediatria') spec(u.especialidad); }
      if (u.rol === 'admin' || u.rol === 'ensenanza' || u.rol === 'calificador') u.especialidad = '';
      if (p.activo != null) { if (u.id === me.id) throw err('No puede desactivar su propio usuario.'); u.activo = !!p.activo; }
      if (p.password) { if (N(p.password).length < 6) throw err('La contraseña debe tener al menos 6 caracteres.'); u.salt = ctx.rand(12); u.hash = hashPw(N(p.password), u.salt); }
      ctx.store.put('users', u);
      audit({ tipo: 'usuario_modificado', objetivo: u.usuario, usuario: me.usuario });
      return { user: publicUser(u) };
    });
  };
  /* Solo el coordinador (admin) puede borrar información. */
  A.deleteUser = function (p, t) {
    return ctx.store.lock(function () {
      var me = session(t); need(me, ['admin']);
      var u = ctx.store.get('users', p.id); if (!u) throw err('Usuario no encontrado.');
      if (u.id === me.id) throw err('No puede eliminar su propio usuario.');
      var mine = attemptsOf(u.id);
      if (mine.length && !u.prueba) throw err('El alumno ya tiene examen; no puede eliminarse (integridad del registro). Solo los sustentantes de prueba se eliminan con su historial.');
      if (u.prueba) {
        var ids = mine.map(function (a) { return a.id; });
        mine.forEach(function (a) { ctx.store.remove('attempts', a.id); });
        ['consents', 'incidents'].forEach(function (c) { ctx.store.list(c).forEach(function (x) { if (x.userId === u.id) ctx.store.remove(c, x.id); }); });
        ctx.store.list('notifications').forEach(function (x) { if ((x.intento && ids.indexOf(x.intento) >= 0) || (x.folio && x.folio === u.matricula && (x.tipo === 'temario' || x.tipo === 'resultado' || x.tipo === 'resultado_alumno'))) ctx.store.remove('notifications', x.id); });
        ctx.store.list('revisiones').forEach(function (x) { if (x.attemptId && ids.indexOf(x.attemptId) >= 0) ctx.store.remove('revisiones', x.id); });
      }
      ctx.store.list('sessions').forEach(function (s) { if (s.userId === u.id) ctx.store.remove('sessions', s.id); });
      ctx.store.remove('users', u.id);
      audit({ tipo: 'usuario_eliminado', objetivo: u.usuario, rolObjetivo: u.rol, prueba: !!u.prueba, usuario: me.usuario });
      return { ok: true };
    });
  };
  A.listStaff = function (p, t) {
    var u = session(t); need(u, FULL);
    return { puedeBorrar: u.rol === 'admin', esCoordinador: u.rol === 'admin',
      rows: ctx.store.list('users').filter(function (x) { return x.rol !== 'alumno'; }).map(publicUser) };
  };
  /* Al dar de alta a un titular o jefe, sus datos se copian como destinatarios si el puesto está vacío. */
  function autollenar(n) {
    var st = settings(); st.id = 'main';
    var nombre = (n.nombre + ' ' + (n.apellidos || '')).trim(), cambio = false;
    function fill(o, pre) { if (!o[pre]) { o[pre] = nombre; o[pre + 'Email'] = o[pre + 'Email'] || n.email || ''; o[pre + 'Tel'] = o[pre + 'Tel'] || n.whatsapp || ''; cambio = true; } }
    if (n.rol === 'ensenanza') { st.institucion = st.institucion || {}; fill(st.institucion, 'jefeEnsenanza'); }
    else if (n.rol === 'titular' && n.especialidad === 'pediatria') { st.institucion = st.institucion || {}; fill(st.institucion, 'titularPediatria'); }
    else if (n.rol === 'titular' || n.rol === 'jefe') {
      st.especialidades = st.especialidades || {}; st.especialidades[n.especialidad] = st.especialidades[n.especialidad] || {};
      fill(st.especialidades[n.especialidad], n.rol === 'jefe' ? 'jefe' : 'titular');
    }
    if (cambio) ctx.store.put('settings', st);
  }
  A.createStaff = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, FULL);
      var rol = p.rol === 'calificador' ? 'ensenanza' : p.rol;
      if (ROLES_PERSONAL.indexOf(rol) < 0) throw err('Seleccione el tipo de usuario.');
      if (rol === 'admin' && u.rol !== 'admin') throw err('Solo el coordinador puede dar de alta a otro coordinador.', 'FORBIDDEN');
      var n = makeUser(p, rol);
      n.creadoPor = u.usuario; ctx.store.put('users', n);
      autollenar(n);
      audit({ tipo: 'alta_personal', objetivo: n.usuario, rolObjetivo: n.rol, especialidad: n.especialidad || '', usuario: u.usuario });
      return { user: publicUser(n) };
    });
  };
  A.listConsents = function (p, t) {
    var u = session(t); need(u, FULL);
    var us = {}; ctx.store.list('users').forEach(function (x) { us[x.id] = x; });
    return { rows: ctx.store.list('consents').sort(function (a, b) { return b.fecha - a.fecha; }).map(function (c) {
      var o = us[c.userId] || {}; return { id: c.id, tipo: c.tipo, nombre: o.apellidos ? o.apellidos + ', ' + o.nombre : c.nombreCompleto, firma: c.nombreCompleto,
        matricula: o.matricula || '', especialidad: o.especialidad ? spec(o.especialidad).nombre : '', fecha: c.fecha, huella: c.huella };
    }) };
  };
  A.listNotifications = function (p, t) {
    var u = session(t); need(u, FULL);
    return { rows: ctx.store.list('notifications').sort(function (a, b) { return b.creado - a.creado; }).slice(0, 500), canales: canal() };
  };
  A.listAudit = function (p, t) {
    var u = session(t); need(u, FULL);
    return { rows: ctx.store.list('audit').sort(function (a, b) { return b.fecha - a.fecha; }).slice(0, 300) };
  };
  A.resend = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, FULL);
      var j = ctx.store.get('notifications', p.id); if (!j) throw err('Notificación no encontrada.');
      var a = j.intento ? ctx.store.get('attempts', j.intento) : null, al = a ? ctx.store.get('users', a.userId) : ctx.store.get('users', p.userId);
      var payload = j.tipo === 'temario' ? { tipo: 'temario', alumno: al } : { tipo: 'resultado', alumno: al, intento: a };
      var r = deliver(j, payload);
      return { estado: r.estado, detalle: r.detalle };
    });
  };
  A.getSettings = function (p, t) {
    var u = session(t); need(u, FULL);
    var st = settings();
    return { minAprob: pass(), intentos: maxInt(), consentVersion: st.consentVersion || '2026-1',
      especialidades: st.especialidades || {}, institucion: institucion(), canales: canal(),
      catalogo: Object.keys(specialties()).map(function (k) { return { id: k, nombre: specialties()[k].nombre, items: itemsAll().length }; }),
      examen: { total: totalOficial(), activos: itemsAll().length, anulados: anulados() } };
  };
  A.saveSettings = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, FULL);
      var st = settings(); st.id = 'main';
      if (p.minAprob != null) { var m = parseInt(p.minAprob, 10); if (!(m >= 1 && m <= 100)) throw err('La calificación mínima debe estar entre 1 y 100.'); st.minAprob = m; }
      if (p.intentos != null) { var i = parseInt(p.intentos, 10); if (!(i >= 1 && i <= 5)) throw err('Oportunidades: entre 1 y 5.'); st.intentos = i; }
      if (p.especialidades) {
        var out = {};
        Object.keys(p.especialidades).forEach(function (k) {
          if (!specialties()[k]) return;
          var s = p.especialidades[k] || {};
          out[k] = { jefe: N(s.jefe), jefeEmail: U(s.jefeEmail), jefeTel: N(s.jefeTel), titular: N(s.titular), titularEmail: U(s.titularEmail), titularTel: N(s.titularTel) };
        });
        st.especialidades = out;
      }
      if (p.institucion) {
        var g = p.institucion;
        st.institucion = { titularPediatria: N(g.titularPediatria), titularPediatriaEmail: U(g.titularPediatriaEmail), titularPediatriaTel: N(g.titularPediatriaTel),
          jefeEnsenanza: N(g.jefeEnsenanza), jefeEnsenanzaEmail: U(g.jefeEnsenanzaEmail), jefeEnsenanzaTel: N(g.jefeEnsenanzaTel) };
      }
      if (p.consentVersion) st.consentVersion = N(p.consentVersion);
      ctx.store.put('settings', st);
      audit({ tipo: 'configuracion', usuario: u.usuario });
      return { ok: true };
    });
  };
  /* ---------- actas por subespecialidad ---------- */
  var SLUG = { neonatologia: 'Neonatologia', gastroenterologia: 'Gastroenterologia', critico: 'PacienteCritico', oncologia: 'Oncologia', cirugia: 'Cirugia' };
  var ORDEN = ['neonatologia', 'gastroenterologia', 'critico', 'oncologia', 'cirugia'];
  function f2(n) { return (n < 10 ? '0' : '') + n; }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  function anio() { return new Date(ctx.now()).getFullYear(); }
  var PRE = { acta: 'ACT', expediente: 'EXP', constancia: 'COR' };
  var TLBL = { acta: 'Acta de evaluación', expediente: 'Expediente consolidado', constancia: 'Constancia de corrección' };
  function prefijo(kind, espId) {
    return PRE[kind] + (espId ? '-' + (SLUG[espId] || 'ESP').slice(0, 6).toUpperCase() : '');
  }
  function nextFolio(kind, espId) {
    var y = anio();
    var pre = prefijo(kind, espId);
    var key = 'F_' + kind + '_' + (espId || 'G') + '_' + y;
    var rec = ctx.store.get('counters', key) || { id: key, kind: kind, espId: espId || '', anio: y, n: 0 };
    rec.n = (rec.n || 0) + 1; rec.actualizado = ctx.now();
    ctx.store.put('counters', rec);
    return { folio: pre + '-' + y + '-' + pad(rec.n, 4), consecutivo: rec.n, prefijo: pre, anio: y };
  }
  A.folios = function (p, t) {
    var u = session(t); need(u, FULL);
    var y = anio();
    function item(kind, espId, etiqueta) {
      var key = 'F_' + kind + '_' + (espId || 'G') + '_' + y;
      var rec = ctx.store.get('counters', key);
      var pre = prefijo(kind, espId);
      var n = rec ? rec.n : 0;
      return { tipo: kind, especialidad: espId || '', etiqueta: etiqueta, prefijo: pre, usados: n,
        siguiente: pre + '-' + y + '-' + pad(n + 1, 4), ultimo: n ? pre + '-' + y + '-' + pad(n, 4) : '' };
    }
    var out = [];
    ORDEN.forEach(function (id) { out.push(item('acta', id, 'Acta · ' + spec(id).nombre)); });
    out.push(item('expediente', '', 'Expediente consolidado'));
    ORDEN.forEach(function (id) { out.push(item('constancia', id, 'Constancia de corrección · ' + spec(id).nombre)); });
    return { anio: y, rows: out };
  };
  A.resetFolios = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, ['admin']);
      if (p.confirma !== true) throw err('Debe confirmar el reinicio de la numeración.');
      var tipo = p.tipo || 'todo', esp = p.especialidad || '';
      var y = anio(), borrados = [], filas = [];
      ctx.store.list('counters').forEach(function (r) {
        if (r.anio !== y) return;
        if (tipo !== 'todo' && r.kind !== tipo) return;
        if (esp && r.espId !== esp) return;
        var pre = prefijo(r.kind, r.espId);
        filas.push({ tipo: r.kind, etiqueta: TLBL[r.kind] || r.kind, espId: r.espId || '',
          especialidad: r.espId ? spec(r.espId).nombre : 'Todas (serie global)',
          folioAnterior: pre + '-' + y + '-' + pad(r.n, 4), folioInicial: pre + '-' + y + '-0001' });
        borrados.push(r.id); ctx.store.remove('counters', r.id);
      });
      /* hoja de corte: asienta el último folio emitido y el folio inicial de la nueva serie */
      var corte = null;
      if (filas.length) {
        corte = { id: 'ct_' + ctx.rand(8), anio: y, fecha: now(), usuario: u.usuario,
          alcance: tipo, especialidad: esp || '', rows: filas };
        ctx.store.put('cortes', corte);
      }
      ctx.store.put('audit', { id: 'au_' + ctx.rand(8), tipo: 'reinicio_folios', tipoDoc: tipo, especialidad: esp,
        borrados: borrados, corte: corte ? corte.id : '', usuario: u.usuario, fecha: now() });
      return { reiniciados: borrados.length, alcance: tipo, especialidad: esp,
        corte: corte ? corte.id : '', corteFolios: filas.map(function (x) { return x.folioAnterior + ' → ' + x.folioInicial; }),
        rows: filas };
    });
  };

  A.cortes = function (p, t) {
    var u = session(t); need(u, FULL);
    var y = anio();
    var rows = ctx.store.list('cortes').filter(function (c) { return !c.anio || c.anio === y; })
      .sort(function (a, b) { return a.fecha - b.fecha; });
    return { anio: y, total: rows.length, rows: rows.map(function (c) {
      return { id: c.id, fecha: fdt(c.fecha), usuario: c.usuario, alcance: c.alcance, especialidad: c.especialidad || '', rows: c.rows || [] };
    }) };
  };
  /* cortes que afectan a las subespecialidades incluidas en el expediente */
  function cortesDe(ids) {
    var y = anio(), out = [];
    ctx.store.list('cortes').forEach(function (c) {
      if (c.anio && c.anio !== y) return;
      var rows = (c.rows || []).filter(function (r) {
        if (!r.espId) return true;                          /* serie global (expediente) */
        return ids.indexOf(r.espId) >= 0;
      });
      if (rows.length) out.push({ id: c.id, fecha: fdt(c.fecha), usuario: c.usuario, alcance: c.alcance, rows: rows });
    });
    return out.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  }

  function fdt(ts) { var d = new Date(ts); return f2(d.getDate()) + '/' + f2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + f2(d.getHours()) + ':' + f2(d.getMinutes()); }
  function fechaHoy() { var d = new Date(ctx.now()); return f2(d.getDate()) + '/' + f2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + f2(d.getHours()) + ':' + f2(d.getMinutes()); }
  function ymd() { var d = new Date(ctx.now()); return '' + d.getFullYear() + f2(d.getMonth() + 1) + f2(d.getDate()); }

  /* Registro de actas emitidas: el folio y la fecha se fijan en la primera emisión y se
     reutilizan en toda reimpresión del mismo contenido. */
  function actaDoc(espId, incluirPendientes, u, opts) {
    var contar = !(opts && opts.contar === false);
    var sp = spec(espId), st = settings();
    var users = ctx.store.list('users').filter(function (x) { return x.rol === 'alumno' && x.especialidad === espId; });
    var at = ctx.store.list('attempts'), cons = ctx.store.list('consents');
    var rows = users.map(function (x) {
      var mine = at.filter(function (a) { return a.userId === x.id && a.estado === 'emitido'; });
      var a = mine[0] || null;
      var cs = cons.filter(function (c) { return c.userId === x.id; });
      var c1 = cs.filter(function (c) { return c.tipo === 'consentimiento'; })[0];
      var c2 = cs.filter(function (c) { return c.tipo === 'confidencialidad'; })[0];
      return { matricula: x.matricula || x.usuario, nombre: x.apellidos + ', ' + x.nombre,
        aciertos: a ? a.aciertos : null, total: a ? a.total : itemsAll().length,
        calificacion: a ? a.calificacion : null, estatus: a ? a.estatus : 'PENDIENTE',
        consent: !!c1, confid: !!c2, firma: (c1 || c2 || {}).nombreCompleto || '' };
    }).sort(function (x, y) { return x.nombre.localeCompare(y.nombre); });
    var fin = rows.filter(function (r) { return r.calificacion != null; });
    var aprob = fin.filter(function (r) { return r.estatus === 'APROBADO'; }).length;
    var prom = fin.length ? Math.round(fin.reduce(function (s, r) { return s + r.calificacion; }, 0) / fin.length) : null;
    var cfgS = (st.especialidades || {})[espId] || {};
    var resumen = { total: rows.length, aprobados: aprob, noAprobados: fin.length - aprob,
      pendientes: rows.length - fin.length, promedio: prom, reactivos: itemsAll().length };
    /* huella de contenido: sustentantes + subespecialidad + mínimo aprobatorio (sin fecha) */
    var ck = ctx.sha256(JSON.stringify({ e: espId, m: pass(), r: rows }));
    var reg = null;
    ctx.store.list('actas_emitidas').forEach(function (x) { if (!reg && x.ck === ck) reg = x; });
    var folio, fechaTxt, sello, tipo, fechaReimp = '';
    if (reg) {
      folio = reg.folio; fechaTxt = reg.fechaTxt; sello = reg.sello;
      tipo = 'reimpresion';
      if (contar) {
        reg.reimpresiones = (reg.reimpresiones || 0) + 1; reg.ultimaReimpresion = ctx.now();
        fechaReimp = fdt(reg.ultimaReimpresion);
        ctx.store.put('audit', { id: 'au_' + ctx.rand(8), tipo: 'acta_reimpresa', folio: folio, especialidad: espId,
          reimpresiones: reg.reimpresiones, usuario: (u && u.usuario) || '', fecha: ctx.now() });
      } else {
        reg.reproducciones = (reg.reproducciones || 0) + 1;
        reg.ultimaReproduccion = ctx.now();
      }
      ctx.store.put('actas_emitidas', reg);
    } else {
      var fol = nextFolio('acta', espId);
      folio = fol.folio; fechaTxt = fechaHoy();
      sello = ctx.sha256(JSON.stringify({ e: espId, r: rows, f: folio })).slice(0, 40);
      reg = { id: 'ae_' + ctx.rand(8), espId: espId, especialidad: sp.nombre, folio: folio, fecha: ctx.now(),
        fechaTxt: fechaTxt, sello: sello, selloFull: ctx.sha256(JSON.stringify({ e: espId, r: rows, f: folio })),
        ck: ck, limite: pass(), incluirPendientes: !!incluirPendientes, reimpresiones: 0,
        ultimaReimpresion: null, usuario: (u && u.usuario) || '' };
      ctx.store.put('actas_emitidas', reg);
      tipo = 'original';
      ctx.store.put('audit', { id: 'au_' + ctx.rand(8), tipo: 'acta_emitida', folio: folio, especialidad: espId,
        usuario: (u && u.usuario) || '', fecha: ctx.now() });
    }
    var firmas = [
      { nombre: cfgS.titular || '________________________', cargo: 'Titular de la subespecialidad de ' + sp.nombre, detalle: 'Nombre, firma y sello' },
      { nombre: cfgS.jefe || '________________________', cargo: 'Jefe de servicio', detalle: 'Nombre, firma y sello' },
      { nombre: institucion().titularPediatria || '________________________', cargo: 'Titular de Pediatría', detalle: 'Nombre, firma y sello' },
      { nombre: institucion().jefeEnsenanza || '________________________', cargo: 'Jefe(a) de enseñanza e investigación', detalle: 'Nombre, firma y sello' },
      { nombre: '________________________', cargo: 'Coordinador(a) de la evaluación', detalle: 'Nombre, firma y sello' }
    ];
    var corr = ctx.store.list('constancias').filter(function (x) { return x.especialidad === espId; })
      .sort(function (a, b) { return a.fecha - b.fecha; })
      .map(function (x) { return { folio: x.folio, fecha: fdt(x.fecha), motivo: x.motivo, usuario: x.usuario,
        especialidadNombre: sp.nombre, minimo: pass(), rows: x.rows }; });
    var d = { especialidad: sp.nombre, fecha: fechaTxt, actaFolio: folio, sello: sello, minimo: pass(),
      rows: rows, resumen: resumen, firmas: firmas, incluirPendientes: incluirPendientes, constancias: corr,
      reimpresion: tipo === 'reimpresion' ? { fecha: fechaReimp, veces: reg.reimpresiones } : null };
    return { espId: espId, id: reg.id, folio: folio, sello: sello, fecha: fechaTxt, tipo: tipo,
      reimpresiones: reg.reimpresiones || 0, fechaReimpresion: fechaReimp, resumen: resumen, constancias: corr, d: d };
  }

  function registroActas(ids) {
    return ctx.store.list('actas_emitidas')
      .filter(function (x) { return !ids || ids.indexOf(x.espId) >= 0; })
      .sort(function (a, b) { return a.fecha - b.fecha; })
      .map(function (x) {
        var r = x.reimpresiones || 0;
        return { id: x.id, folio: x.folio, espId: x.espId, especialidad: x.especialidad,
          fecha: x.fechaTxt, sello: x.sello, reimpresiones: r,
          ultimaReimpresion: x.ultimaReimpresion ? fdt(x.ultimaReimpresion) : '',
          reproducciones: x.reproducciones || 0,
          estado: r ? 'Original · con reimpresiones' : 'Original',
          emitidoPor: x.usuario || '' };
      });
  }
  A.actasEmitidas = function (p, t) {
    var u = session(t); need(u, FULL);
    var rows = registroActas();
    return { total: rows.length, originales: rows.length,
      reimpresas: rows.filter(function (r) { return r.reimpresiones > 0; }).length,
      reimpresiones: rows.reduce(function (s, r) { return s + r.reimpresiones; }, 0), rows: rows };
  };

  function asistenciaRows(ids) {
    var out = [];
    ctx.store.list('users').filter(function (x) { return x.rol === 'alumno' && ids.indexOf(x.especialidad) >= 0; })
      .forEach(function (x) { out.push({ nombre: x.apellidos + ', ' + x.nombre, matricula: x.matricula || x.usuario, especialidad: spec(x.especialidad).nombre }); });
    out.sort(function (a, b) { return a.especialidad === b.especialidad ? a.nombre.localeCompare(b.nombre) : a.especialidad.localeCompare(b.especialidad); });
    return out;
  }
  function constancias(ids) {
    return ctx.store.list('constancias').filter(function (x) { return ids.indexOf(x.especialidad) >= 0; })
      .sort(function (a, b) { return a.fecha - b.fecha; })
      .map(function (x) { return { folio: x.folio, fecha: fdt(x.fecha), motivo: x.motivo, usuario: x.usuario,
        especialidadNombre: spec(x.especialidad).nombre, minimo: pass(), rows: x.rows, descripcion: x.descripcion }; });
  }
  A.listConstancias = function (p, t) {
    var u = session(t); need(u, FULL);
    return { rows: ctx.store.list('constancias').sort(function (a, b) { return b.fecha - a.fecha; }).map(function (x) {
      return { id: x.id, folio: x.folio, fecha: x.fecha, especialidad: x.especialidad,
        especialidadNombre: spec(x.especialidad).nombre, motivo: x.motivo, usuario: x.usuario, examenes: x.rows.length,
        bajaron: x.rows.filter(function (r) { return r.despues.calificacion < r.antes.calificacion; }).length };
    }) };
  };
  A.constanciaPdf = function (p, t) {
    var u = session(t); need(u, FULL);
    var x = ctx.store.get('constancias', p.id);
    if (!x) throw err('Constancia no encontrada.');
    var cp = { folio: x.folio, fecha: fdt(x.fecha), motivo: x.motivo, usuario: x.usuario,
      especialidadNombre: spec(x.especialidad).nombre, minimo: pass(), rows: x.rows, descripcion: x.descripcion };
    var gen = ctx.pdf.constanciaDoc || ctx.pdf.constancia;
    return { base64: ctx.b64(gen(cp)), nombre: 'Constancia_' + x.folio + '.pdf', folio: x.folio };
  };

  A.actaPdf = function (p, t) {
    var u = session(t); need(u, FULL);
    var x = actaDoc(p.especialidad, p.incluirPendientes !== false, u);
    return { base64: ctx.b64(ctx.pdf.acta(x.d)),
      nombre: 'Acta_' + x.folio + (x.tipo === 'reimpresion' ? '_reimpresion' : '') + '.pdf',
      folio: x.folio, sello: x.sello, resumen: x.resumen, fecha: x.fecha, tipo: x.tipo,
      reimpresiones: x.reimpresiones, fechaReimpresion: x.fechaReimpresion,
      constancias: x.constancias.map(function (c) { return c.folio; }) };
  };

  A.actasPdf = function (p, t) {
    var u = session(t); need(u, FULL);
    var ids = (p.especialidades && p.especialidades.length) ? p.especialidades : ORDEN;
    ids.forEach(function (id) { spec(id); });
    var list = ids.map(function (id) { return actaDoc(id, p.incluirPendientes !== false, u, { contar: false }); });
    var g = { total: 0, aprobados: 0, noAprobados: 0, pendientes: 0, promedio: null };
    var num = 0, den = 0;
    list.forEach(function (x) {
      g.total += x.resumen.total; g.aprobados += x.resumen.aprobados;
      g.noAprobados += x.resumen.noAprobados; g.pendientes += x.resumen.pendientes;
      var ev = x.resumen.total - x.resumen.pendientes;
      if (x.resumen.promedio != null) { num += x.resumen.promedio * ev; den += ev; }
    });
    g.promedio = den ? Math.round(num / den) : null;
    var fol = nextFolio('expediente', ''), folio = fol.folio;
    var sello = ctx.sha256(list.map(function (x) { return x.sello; }).join('|') + '|' + folio);
    var ag = { folio: folio, fecha: fechaHoy(), rows: asistenciaRows(ids) };
    var corr = constancias(ids);
    var ct = cortesDe(ids);
    var rg = registroActas(ids);
    var datos = { fecha: fechaHoy(), folio: folio, sello: sello.slice(0, 40), minimo: pass(),
      actas: list.map(function (x) { return x.d; }), resumenGlobal: g, asistenciaGeneral: ag,
      constancias: corr, cortes: ct, registroActas: rg };
    var pdf = ctx.pdf.consolidado(datos);
    return { base64: ctx.b64(pdf), nombre: 'Expediente_' + folio + '.pdf', folio: folio, sello: sello.slice(0, 40),
      fecha: fechaHoy(), resumenGlobal: g, asistencia: ag.rows.length, cortes: ct.length, registro: rg.length,
      reimpresiones: rg.reduce(function (s2, r) { return s2 + r.reimpresiones; }, 0),
      datos: p.conDatos === true ? datos : undefined,
      actas: list.map(function (x) { return { especialidad: x.d.especialidad, folio: x.folio, resumen: x.resumen,
        tipo: x.tipo, reimpresiones: x.reimpresiones }; }),
      constancias: corr.map(function (c) { return c.folio; }) };
  };

  /* ---------- diagnóstico y recalificación (corrección de errores del sistema) ---------- */
  A.diagnostico = function (p, t) {
    var u = session(t); need(u, FULL);
    var users = {}; ctx.store.list('users').forEach(function (x) { users[x.id] = x; });
    var rows = ctx.store.list('attempts').filter(function (a) { return a.estado === 'emitido'; }).map(function (a) {
      var s = scoreOf(a.respuestas || {}, a.especialidad, pass(), a.ajustes);
      var usr = users[a.userId] || {};
      return { id: a.id, matricula: usr.matricula || '', alumno: usr.apellidos ? usr.apellidos + ', ' + usr.nombre : '',
        especialidad: a.especialidad, contestadas: Object.keys(a.respuestas || {}).length, total: s.total,
        actual: { aciertos: a.aciertos, calificacion: a.calificacion, estatus: a.estatus },
        nuevo: { aciertos: s.aciertos, calificacion: s.calificacion, estatus: s.estatus },
        motor: a.motor || '1.0', emitido: a.emitido, difiere: s.aciertos !== a.aciertos };
    }).filter(function (r) { return r.difiere; });
    return { rows: rows, total: rows.length, motorActual: MOTOR, auditados: ctx.store.list('audit').filter(function (x) { return x.tipo === 'recalificacion'; }).length };
  };

  A.recalificar = function (p, t) {
    return ctx.store.lock(function () {
      var u = session(t); need(u, FULL);
      if (p.confirma !== true) throw err('Debe confirmar la recalificación.');
      var motivo = N(p.motivo) || 'Corrección de error del sistema en el cálculo de la calificación';
      var descripcion = N(p.descripcion) || 'El sistema comparaba la clave de respuestas distinguiendo mayúsculas de minúsculas, por lo que las respuestas correctas no se reconocían y el cálculo resultaba en la calificación mínima. Se normalizó la comparación y se recalcularon las calificaciones a partir de las respuestas registradas por cada sustentante, sin modificarlas.';
      var ids = (p.ids && p.ids.length) ? p.ids : null;
      var out = [];
      ctx.store.list('attempts').forEach(function (a) {
        if (a.estado !== 'emitido') return;
        if (ids && ids.indexOf(a.id) < 0) return;
        var s = scoreOf(a.respuestas || {}, a.especialidad, pass(), a.ajustes);
        if (s.aciertos === a.aciertos) return;
        var antes = { aciertos: a.aciertos, calificacion: a.calificacion, estatus: a.estatus, motor: a.motor || '1.0' };
        a.aciertos = s.aciertos; a.total = s.total; a.calificacion = s.calificacion; a.estatus = s.estatus;
        a.areas = s.areas; a.fuertes = s.fuertes; a.oportunidades = s.oportunidades; a.motor = MOTOR;
        a.recalificado = { fecha: now(), motivo: motivo, antes: antes, por: u.usuario };
        ctx.store.put('attempts', a);
        ctx.store.put('audit', { id: 'au_' + ctx.rand(8), tipo: 'recalificacion', attemptId: a.id, antes: antes,
          despues: { aciertos: a.aciertos, calificacion: a.calificacion, estatus: a.estatus, motor: MOTOR },
          motivo: motivo, usuario: u.usuario, fecha: now() });
        var dueno = ctx.store.get('users', a.userId) || {};
        out.push({ id: a.id, especialidad: a.especialidad, total: a.total,
          matricula: dueno.matricula || dueno.usuario || '', alumno: dueno.apellidos ? dueno.apellidos + ', ' + dueno.nombre : '',
          antes: antes, despues: { aciertos: a.aciertos, calificacion: a.calificacion, estatus: a.estatus } });
      });
      var docs = [];
      if (out.length) {
        var grupos = {};
        out.forEach(function (r) { (grupos[r.especialidad] = grupos[r.especialidad] || []).push(r); });
        Object.keys(grupos).forEach(function (espId) {
          var fol = nextFolio('constancia', espId);
          var rows = grupos[espId].map(function (r) { return { attemptId: r.id, matricula: r.matricula, nombre: r.alumno, total: r.total,
            antes: r.antes, despues: r.despues }; });
          var doc = { id: 'k_' + ctx.rand(8), folio: fol.folio, fecha: now(), especialidad: espId, motivo: motivo, usuario: u.usuario,
            rows: rows, descripcion: descripcion };
          ctx.store.put('constancias', doc);
          docs.push({ folio: doc.folio, especialidad: spec(espId).nombre, examenes: rows.length });
        });
        ctx.store.put('audit', { id: 'au_' + ctx.rand(8), tipo: 'constancia_emitida', documentos: docs.map(function (d) { return d.folio; }), usuario: u.usuario, fecha: now() });
      }
      return { recalificados: out.length, detalle: out, constancias: docs };
    });
  };

  function handle(action, params, token) {
    if (!Object.prototype.hasOwnProperty.call(A, action)) return { ok: false, error: 'Acción no válida.', code: 'BAD_ACTION' };
    try { return { ok: true, data: A[action](params || {}, token || '') }; }
    catch (e) { return { ok: false, error: e.userError ? e.message : 'Error interno del servidor.', code: e.code || 'ERROR', debug: e.userError ? undefined : String(e && e.stack || e) }; }
  }
  return { handle: handle, config: CFG };
}

/* Temas y bibliografía por materia (para el temario y el debriefing) */
var STUDY = {
  'Neonatología': { temas: ['Transición fetal–neonatal y reanimación', 'Ictericia neonatal y hemólisis', 'Sepsis neonatal temprana y tardía', 'Prematuro: nutrición, apnea y displasia broncopulmonar', 'Hipoglucemia y alteraciones metabólicas del recién nacido'],
    biblio: ['Nelson Textbook of Pediatrics, 22a ed. Elsevier, 2025 (cap. Neonatología)', 'AAP. Textbook of Neonatal Resuscitation (NRP), 8a ed. 2021', 'AAP Red Book 2024–2027, secciones de infecciones neonatales'] },
  'Medicina crítica': { temas: ['Choque en pediatría: reconocimiento y reanimación con líquidos', 'Ventilación mecánica y SDRA pediátrico', 'Sepsis y disfunción multiorgánica', 'Sedación, analgesia y bloqueo neuromuscular', 'Monitoreo hemodinámico y soporte vasoactivo'],
    biblio: ['Nelson Textbook of Pediatrics, 22a ed. (cap. Cuidados críticos)', 'AAP PREP Self-Assessment 2021, sección Critical Care', 'Surviving Sepsis Campaign. Pediatric Sepsis Guidelines, 2020'] },
  'Urgencias pediátricas': { temas: ['Evaluación inicial del paciente grave (triángulo de evaluación pediátrica)', 'Crisis asmática y obstrucción de vía aérea', 'Deshidratación y choque hipovolémico', 'Traumatismo craneoencefálico y politrauma', 'Intoxicaciones frecuentes'],
    biblio: ['Nelson Textbook of Pediatrics, 22a ed. (cap. Urgencias)', 'AAP. APLS: The Pediatric Emergency Medicine Resource, 6a ed.', 'Fleisher & Ludwig\'s Textbook of Pediatric Emergency Medicine, 8a ed.'] },
  'Líquidos y electrolitos': { temas: ['Requerimientos hídricos y cálculo de soluciones', 'Hiponatremia e hipernatremia', 'Hipopotasemia e hiperpotasemia', 'Acidosis y alcalosis: interpretación gasométrica'],
    biblio: ['Nelson Textbook of Pediatrics, 22a ed. (cap. Líquidos y electrolitos)', 'AAP PREP Self-Assessment 2021, sección Fluid & Electrolytes'] },
  'Neumología': { temas: ['Asma: clasificación, control y escalamiento', 'Bronquiolitis y sibilancias del lactante', 'Neumonía y derrame pleural', 'Fibrosis quística y pruebas de función pulmonar'],
    biblio: ['Nelson Textbook of Pediatrics, 22a ed. (cap. Neumología)', 'GINA. Global Strategy for Asthma Management, edición vigente', 'AAP. Bronchiolitis Clinical Practice Guideline, Pediatrics 2014'] },
  'Farmacología y toxicología': { temas: ['Farmacocinética en pediatría y dosificación por peso', 'Antibióticos: elección empírica y ajuste', 'Intoxicaciones: carbón activado y antídotos', 'Reacciones adversas y farmacovigilancia'],
    biblio: ['Nelson Textbook of Pediatrics, 22a ed. (cap. Farmacología)', 'AAP. Pediatric & Neonatal Dosage Handbook, edición vigente', 'Dart RC. Medical Toxicology, 4a ed.'] },
  'Gastroenterología y nutrición': { temas: ['Diarrea aguda y deshidratación', 'Reflujo gastroesofágico y enfermedad por reflujo', 'Enfermedad celíaca y alergia a proteína de leche de vaca', 'Dolor abdominal recurrente y estreñimiento', 'Valoración nutricional y apoyo enteral'],
    biblio: ['Nelson Textbook of Pediatrics, 22a ed. (cap. Gastroenterología)', 'NASPGHAN. Guías de reflujo, celiaquía y estreñimiento', 'AAP PREP Self-Assessment 2021, sección Gastroenterology'] },
  'Errores innatos del metabolismo': { temas: ['Tamiz neonatal ampliado', 'Hiperamonemia y encefalopatía metabólica', 'Errores del ciclo de la urea y acidemias orgánicas', 'Tratamiento agudo del paciente metabólico'],
    biblio: ['Nelson Textbook of Pediatrics, 22a ed. (cap. Metabolismo)', 'Saudubray JM. Inborn Metabolic Diseases, 7a ed.', 'AAP Newborn Screening Guidelines'] },
  'Hematología y oncología': { temas: ['Anemia ferropénica y anemias hemolíticas', 'Trombocitopenia y trastornos de la coagulación', 'Leucemia linfoblástica aguda: sospecha y abordaje inicial', 'Tumores sólidos pediátricos más frecuentes', 'Urgencias oncológicas: síndrome de lisis tumoral y neutropenia febril'],
    biblio: ['Nelson Textbook of Pediatrics, 22a ed. (cap. Hematología/Oncología)', 'AAP PREP Self-Assessment 2021, sección Hematology/Oncology', 'Pizzo & Poplack\'s Principles and Practice of Pediatric Oncology, 8a ed.'] },
  'Genética': { temas: ['Herencia mendeliana y árbol genealógico', 'Síndromes cromosómicos frecuentes', 'Asesoramiento genético y estudios moleculares', 'Predisposición hereditaria al cáncer'],
    biblio: ['Nelson Textbook of Pediatrics, 22a ed. (cap. Genética)', 'Nussbaum RL. Thompson & Thompson Genetics and Genomics in Medicine, 9a ed.'] },
  'Ortopedia': { temas: ['Evaluación de la marcha y displasia del desarrollo de la cadera', 'Dolor de cadera: sinovitis transitoria vs. Perthes', 'Fracturas frecuentes y abuso físico', 'Escoliosis y alteraciones posturales'],
    biblio: ['Nelson Textbook of Pediatrics, 22a ed. (cap. Ortopedia)', 'AAOS. Orthopaedic Knowledge Update: Pediatrics', 'AAP PREP Self-Assessment 2021, sección Orthopaedics'] }
};
if (typeof module !== 'undefined') module.exports = { createCore: createCore, STUDY: STUDY };
