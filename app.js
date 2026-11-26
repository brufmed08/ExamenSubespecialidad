(function () {
'use strict';
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function p2(n) { return String(n).padStart(2, '0'); }
function fdt(t) { if (!t) return ''; var d = new Date(t); return p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
function fname() { var d = new Date(); return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes()); }
var tt; function toast(m, bad) { var t = $('#toast'); t.textContent = m; t.className = 'toast on' + (bad ? ' err' : ''); clearTimeout(tt); tt = setTimeout(function () { t.className = 'toast'; }, 3600); }
function loading(on) { $('#loading').classList.toggle('on', !!on); }
function rndPw() { var a = 'abcdefghjkmnpqrstuvwxyz23456789', s = '', b = new Uint32Array(8); crypto.getRandomValues(b); for (var i = 0; i < 8; i++) s += a[b[i] % a.length]; return s; }

var TOKEN = '', ME = null, STATUS = null;
try { TOKEN = sessionStorage.getItem('subsp_tok') || ''; } catch (e) {}
function setTok(t) { TOKEN = t || ''; try { if (t) sessionStorage.setItem('subsp_tok', t); else sessionStorage.removeItem('subsp_tok'); } catch (e) {} }
var IS_GAS = !!(window.google && google.script && google.script.run);
function call(action, params, quiet) {
  if (!quiet) loading(true);
  return new Promise(function (res, rej) {
    function done(o) {
      if (!quiet) loading(false);
      if (o && o.ok) return res(o.data);
      var e = o || { error: 'Error desconocido.' };
      if (e.code === 'AUTH' && action !== 'login') { setTok(''); ME = null; showLogin(); }
      rej(e);
    }
    if (IS_GAS) google.script.run.withSuccessHandler(function (s) { try { done(JSON.parse(s)); } catch (x) { done({ error: 'Respuesta inválida.' }); } })
      .withFailureHandler(function (er) { done({ error: 'Error del servidor: ' + (er && er.message || er) }); }).api(action, params || {}, TOKEN);
    else fetch('api', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify({ action: action, params: params || {} }), cache: 'no-store' })
      .then(function (r) { return r.json(); }).then(done).catch(function () { done({ error: 'Sin conexión con el servidor.', code: 'NET' }); });
  });
}
function fail(e) { toast((e && e.error) || 'Ocurrió un error.', true); }

function show(id) { $$('.view').forEach(function (v) { v.classList.remove('on'); }); $('#v-' + id).classList.add('on'); $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === id); }); window.scrollTo(0, 0); }
var TAB_FULL = [['results', 'Resultados'], ['students', 'Sustentantes'], ['review', 'Reactivos'], ['staff', 'Usuarios'], ['config', 'Especialidades'], ['notifs', 'Bitácora']];
var TAB_ACAD = [['results', 'Resultados'], ['students', 'Sustentantes'], ['review', 'Reactivos']];
var TABS = { admin: TAB_FULL, ensenanza: TAB_FULL, calificador: TAB_FULL, jefe: TAB_ACAD, titular: TAB_ACAD };
var ROLES = { admin: 'Coordinador', ensenanza: 'Jefe de enseñanza', calificador: 'Jefe de enseñanza', jefe: 'Jefe de servicio', titular: 'Titular', alumno: 'Sustentante' };
function isFull() { return ME && (ME.rol === 'admin' || ME.rol === 'ensenanza' || ME.rol === 'calificador'); }
function isAdmin() { return ME && ME.rol === 'admin'; }
function canAdjust() { return ME && (isFull() || ME.rol === 'jefe'); }
function applyRole() {
  var f = isFull();
  ['#r-acta', '#r-exp'].forEach(function (s) { var e = $(s); if (e) e.style.display = f ? '' : 'none'; });
  var rf = $('#rf-go'); if (rf) rf.style.display = isAdmin() ? '' : 'none';
  var ro = $('#rf-only'); if (ro) ro.style.display = isAdmin() ? 'none' : '';
}

function initGoogle() {
  call('loginConfig', {}, true).then(function (cfg) {
    if (!cfg || !cfg.googleClientId) return;
    var slot = $('#g-slot'); if (slot) slot.style.display = 'block';
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = function () {
      if (!window.google || !google.accounts) return;
      google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onGoogleCredential, auto_select: false, cancel_on_tap_outside: true });
      google.accounts.id.renderButton($('#g-btn'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', logo_alignment: 'left', width: 320 });
    };
    document.body.appendChild(s);
  }).catch(function () {});
}
function onGoogleCredential(res) {
  if (!res || !res.credential) return;
  call('googleLogin', { credential: res.credential }).then(function (d) {
    setTok(d.token); enter(d.user);
    toast('Bienvenido, ' + (d.user.nombre || d.user.usuario) + '.');
  }).catch(fail);
}
function authCard(id) {
  ['f-login', 'f-setup', 'f-forgot', 'f-reset'].forEach(function (k) {
    var el = document.getElementById(k); if (el) el.style.display = (k === id ? '' : 'none');
  });
}
function resetFromHash() {
  var m = /#r=([A-Za-z0-9]+)/.exec(location.hash || '');
  if (!m) return false;
  var t = document.getElementById('rs-t'); if (t) t.value = m[1].toUpperCase();
  authCard('f-reset'); return true;
}
function wireReset() {
  var lf = document.getElementById('lg-forgot'), lc = document.getElementById('lg-code');
  if (lf) lf.onclick = function () { authCard('f-forgot'); };
  if (lc) lc.onclick = function () { authCard('f-reset'); };
  ['fg-back', 'rs-back'].forEach(function (id) {
    var b = document.getElementById(id); if (b) b.onclick = function () { authCard('f-login'); };
  });
  var ff = document.getElementById('f-forgot');
  if (ff) ff.onsubmit = function (e) {
    e.preventDefault();
    var msg = document.getElementById('fg-msg');
    msg.className = 'msg'; msg.textContent = 'Enviando…';
    call('forgotPassword', { usuario: document.getElementById('fg-u').value }).then(function (d) {
      msg.className = 'msg ok'; msg.textContent = d.mensaje || 'Revise su correo.';
      authCard('f-reset');
    }).catch(function (er) { msg.className = 'msg'; msg.textContent = (er && er.error) || 'No se pudo enviar el código.'; });
  };
  var fr = document.getElementById('f-reset');
  if (fr) fr.onsubmit = function (e) {
    e.preventDefault();
    var msg = document.getElementById('rs-msg');
    var p1 = document.getElementById('rs-p').value, p2 = document.getElementById('rs-p2').value;
    if (p1 !== p2) { msg.className = 'msg'; msg.textContent = 'Las contraseñas no coinciden.'; return; }
    msg.className = 'msg'; msg.textContent = 'Guardando…';
    call('resetPassword', { token: document.getElementById('rs-t').value, nueva: p1 }).then(function (d) {
      msg.className = 'msg ok'; msg.textContent = 'Contraseña actualizada. Ya puede entrar.';
      toast('Contraseña actualizada para ' + d.usuario + '.');
      if (location.hash) history.replaceState(null, '', location.pathname);
      setTimeout(function () { authCard('f-login'); var u = document.getElementById('lg-u'); if (u) { u.value = d.usuario; u.focus(); } }, 900);
    }).catch(function (er) { msg.className = 'msg'; msg.textContent = (er && er.error) || 'No se pudo cambiar la contraseña.'; });
  };
  resetFromHash();
}
function showLogin() {
  guard.stop(); $('#topbar').style.display = 'none'; show('login');
  call('status', {}, true).then(function (s) {
    STATUS = s;
    $('#f-setup').style.display = s.needsSetup ? '' : 'none';
    $('#f-login').style.display = s.needsSetup ? 'none' : '';
    setTimeout(function () { (s.needsSetup ? $('#su-n') : $('#lg-u')).focus(); }, 60);
  }).catch(function (e) { $('#lg-msg').textContent = e.error || 'No se pudo contactar al servidor.'; });
}
function enter(u) {
  ME = u; $('#topbar').style.display = '';
  $('#who-n').textContent = (u.nombre + ' ' + (u.apellidos || '')).trim();
  $('#who-r').textContent = u.cargo || ROLES[u.rol] || u.rol;
  applyRole();
  $('#tabs').innerHTML = (TABS[u.rol] || []).map(function (t) { return '<button data-v="' + t[0] + '">' + t[1] + '</button>'; }).join('');
  if (!STATUS) call('status', {}, true).then(function (s) { STATUS = s; }).catch(function () {});
  if (u.rol === 'alumno') studentHome(); else openTab(u.rol === 'admin' ? 'results' : 'results');
}
$('#tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) openTab(b.dataset.v); });
function openTab(v) { show(v); if (v === 'results') loadResults(); if (v === 'students') loadStudents(); if (v === 'review') loadReview(); if (v === 'staff') loadStaff(); if (v === 'config') { loadConfig(); loadFolios(); loadDiag(); } if (v === 'notifs') { loadNotifs(); loadConstancias(); loadAudit(); } }

$$('[data-eye]').forEach(function (b) { b.onclick = function () { var i = $('#' + b.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? 'Ver' : 'Ocultar'; }; });
$('#f-login').addEventListener('submit', function (e) {
  e.preventDefault(); $('#lg-msg').textContent = '';
  call('login', { usuario: $('#lg-u').value, password: $('#lg-p').value }).then(function (d) { setTok(d.token); $('#lg-p').value = ''; enter(d.user); })
    .catch(function (er) { $('#lg-msg').textContent = er.error; });
});
$('#f-setup').addEventListener('submit', function (e) {
  e.preventDefault();
  var u = $('#su-u').value, p = $('#su-p').value;
  call('setup', { nombre: $('#su-n').value, apellidos: $('#su-a').value, usuario: u, password: p })
    .then(function () { return call('login', { usuario: u, password: p }); })
    .then(function (d) { setTok(d.token); enter(d.user); toast('Administrador creado. Configure especialidades y destinatarios.'); })
    .catch(function (er) { $('#su-msg').textContent = er.error; });
});
$('#btn-out').onclick = function () { call('logout', {}, true).catch(function () {}); setTok(''); ME = null; EX.active = false; showLogin(); };
$('#btn-pw').onclick = function () {
  modal('Cambiar contraseña', '<form id="f-pw"><div class="field"><label class="f">Contraseña actual</label><input type="password" class="t" id="pw-a" required></div><div class="field"><label class="f">Nueva (mín. 6)</label><input type="password" class="t" id="pw-n" required></div><div class="msg" id="pw-m"></div><button class="btn primary">Guardar</button></form>');
  $('#f-pw').onsubmit = function (e) { e.preventDefault(); call('changePassword', { actual: $('#pw-a').value, nueva: $('#pw-n').value }).then(function () { closeModal(); toast('Contraseña actualizada.'); }).catch(function (er) { $('#pw-m').textContent = er.error; }); };
};
function modal(t, b, wide) { $('#m-title').textContent = t; $('#m-body').innerHTML = b; $('.modal-box').classList.toggle('wide', !!wide); $('#modal').classList.add('on'); }
function closeModal() { $('#modal').classList.remove('on'); $('#m-body').innerHTML = ''; }
$('#m-x').onclick = closeModal;
$('#modal').onclick = function (e) { if (e.target.id === 'modal') closeModal(); };

/* ================= ALUMNO ================= */
var ST = null, EX = { active: false }, SP = null;
function studentHome() {
  guard.stop(); show('shome');
  call('myStatus').then(function (s) {
    ST = s; SP = s.especialidad;
    $('#sh-name').textContent = s.user.apellidos + ', ' + s.user.nombre;
    $('#sh-mat').textContent = 'Matrícula ' + s.user.matricula;
    $('#sh-spec').textContent = s.especialidad.nombre + ' · ' + s.especialidad.items.length + ' reactivos';
    var lad = '';
    for (var i = 1; i <= s.max; i++) {
      var done = s.usados >= i;
      lad += '<b class="' + (done ? (s.resultado && s.resultado.estatus === 'APROBADO' ? 'pass' : 'fail') : (i === s.usados + 1 ? 'now' : '')) + '">Oportunidad ' + i + (done && s.resultado ? ' · ' + s.resultado.calificacion : '') + '</b>';
    }
    $('#sh-ladder').innerHTML = lad;
    var btn = $('#sh-start');
    if (s.resultado) {
      $('#sh-msg').innerHTML = 'Resultado emitido: <b>' + s.resultado.calificacion + '/100 · ' + s.resultado.estatus + '</b>. El resultado es definitivo e inapelable.';
      btn.textContent = 'Ver mi resultado y debriefing';
      btn.onclick = function () { renderResult(s.resultado); };
    } else if (s.restantes <= 0) {
      $('#sh-msg').textContent = 'Sin oportunidades disponibles.'; btn.style.display = 'none';
    } else {
      $('#sh-msg').innerHTML = 'Calificación mínima aprobatoria: <b>' + s.minimo + '/100</b>. Al finalizar verá su resultado de inmediato y deberá firmar el acuerdo de confidencialidad.';
      btn.style.display = ''; btn.textContent = s.enCurso ? 'Continuar examen' : 'Comenzar examen';
      btn.onclick = function () {
        if (!confirm('Se registrará el inicio del examen. El resultado se emitirá al finalizar y no podrá modificarse. ¿Continuar?')) return;
        call('startAttempt').then(beginExam).catch(fail);
      };
    }
    if (!s.consentimiento) showConsent();
  }).catch(fail);
}
function showConsent() {
  call('consentText').then(function (c) {
    $('#cs-meta').textContent = ST.especialidad.nombre + ' · ' + ST.especialidad.items.length + ' reactivos · mínimo aprobatorio ' + ST.minimo + '/100';
    $('#cs-text').innerHTML =
      '<p><b>Evaluación de conocimientos de subespecialidad pediátrica.</b> Al firmar este documento usted declara que ha leído y acepta las condiciones de aplicación de la evaluación.</p>' +
      '<h4>1. Objeto</h4><p>La evaluación mide conocimientos mediante reactivos de opción múltiple seleccionados de PREP® Self-Assessment 2021 (AAP), correspondientes a ' + h(ST.especialidad.nombre) + '.</p>' +
      '<h4>2. Calificación</h4><p>La calificación se expresa en escala de <b>1 a 100</b>, proporcional al número de reactivos correctos, y se considera aprobatoria únicamente si es <b>igual o mayor a ' + ST.minimo + '</b>.</p>' +
      '<h4>3. Emisión automática</h4><p>El resultado se calcula y emite <b>automáticamente</b> al concluir el examen, se muestra de forma inmediata y se envía por correo electrónico y WhatsApp al jefe de servicio y al titular de la especialidad.</p>' +
      '<h4>4. Carácter definitivo e inapelable</h4><p>Usted acepta que, una vez emitido, el resultado <b>es definitivo, inapelable y no puede modificarse, corregirse ni recalificarse</b>, y que no procede recurso alguno contra él.</p>' +
      '<h4>5. Integridad</h4><p>La evaluación se aplica en un entorno controlado; se registran incidentes como salidas de la ventana o intentos de captura de pantalla, que quedan a disposición de la autoridad académica.</p>' +
      '<h4>6. Confidencialidad</h4><p>Al finalizar, usted firmará un acuerdo de confidencialidad en el que se obliga a no divulgar, fotografiar ni reproducir los reactivos.</p>' +
      '<p class="muted" style="font-size:12px">Versión del documento: ' + h(c.version) + ' · ' + fdt(Date.now()) + '</p>';
    $('#cs-name').placeholder = ST.user.nombre + ' ' + ST.user.apellidos;
    show('consent');
    $('#cs-go').onclick = function () {
      if (!$('#cs-ok').checked) { $('#cs-msg').textContent = 'Marque la casilla de aceptación.'; return; }
      if (!$('#cs-name').value.trim()) { $('#cs-msg').textContent = 'Escriba su nombre completo como firma.'; return; }
      call('signConsent', { acepta: true, nombreCompleto: $('#cs-name').value, textoAceptado: $('.legal').innerText.slice(0, 700) })
        .then(function () { toast('Consentimiento firmado.'); studentHome(); }).catch(function (er) { $('#cs-msg').textContent = er.error; });
    };
  }).catch(fail);
}
$('#sh-temario').onclick = function () {
  call('myPdf', { tipo: 'temario' }).then(function (d) { dlb64(d.base64, d.nombre); }).catch(fail);
};

function beginExam(d) {
  EX = { active: true, id: d.attemptId, num: d.num, qs: d.questions, ans: Object.assign({}, d.respuestas || {}), pending: {}, minimo: d.minimo };
  $('#ex-who').textContent = d.alumno.apellidos + ', ' + d.alumno.nombre + ' · ' + d.alumno.matricula + ' · ' + d.especialidad.nombre;
  $('#shield-who').textContent = d.alumno.apellidos + ', ' + d.alumno.nombre + ' · ' + d.alumno.matricula;
  show('exam'); renderExam(); guard.start();
}
function renderExam() {
  var html = '';
  EX.qs.forEach(function (q) {
    var opts = q.options.map(function (o, i) {
      var l = 'abcd'[i], sel = EX.ans[q.n] === l;
      return '<label class="opt' + (sel ? ' sel' : '') + '"><input type="radio" name="q' + q.n + '" value="' + l + '"' + (sel ? ' checked' : '') + '><span class="ol">' + l + '</span><span>' + h(o) + '</span></label>';
    }).join('');
    html += '<div class="q"><div class="qh"><div class="num">' + q.n + '</div><div style="flex:1;min-width:0"><div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:6px">' + h(q.m) + '</div>' +
      '<p class="stem">' + h(q.stem) + '</p><div class="opts">' + opts + '</div></div></div></div>';
  });
  html += '<div class="row" style="justify-content:center;margin:20px 0 50px"><button class="btn primary" id="ex-finish2">Finalizar y ver mi resultado</button></div>';
  $('#ex-body').innerHTML = html;
  $('#ex-finish2').onclick = finishAsk;
  prog();
}
$('#ex-body').addEventListener('change', function (e) {
  if (e.target.type !== 'radio') return;
  var n = e.target.name.slice(1); EX.ans[n] = e.target.value; EX.pending[n] = e.target.value;
  $$('input[name="q' + n + '"]').forEach(function (r) { r.closest('.opt').classList.toggle('sel', r.checked); });
  prog(); saveSoon();
});
function prog() { var c = Object.keys(EX.ans).length, t = EX.qs.length; $('#ex-prog').style.width = (c / t * 100) + '%'; $('#ex-count').textContent = c + ' / ' + t; }
var sv;
function saveSoon() { $('#ex-save').textContent = 'Guardando…'; clearTimeout(sv); sv = setTimeout(flushSave, 1200); }
function flushSave() {
  if (!EX.active) return;
  var b = EX.pending; if (!Object.keys(b).length) { $('#ex-save').textContent = 'Guardado'; return; }
  EX.pending = {};
  call('saveAnswers', { attemptId: EX.id, respuestas: b }, true).then(function () { $('#ex-save').textContent = 'Guardado'; })
    .catch(function (e) { for (var k in b) EX.pending[k] = b[k]; $('#ex-save').textContent = 'Sin guardar'; if (e.code === 'CLOSED') { EX.active = false; guard.stop(); studentHome(); } });
}
function finishAsk() {
  var miss = EX.qs.length - Object.keys(EX.ans).length;
  var msg = (miss ? 'Quedan ' + miss + ' reactivo(s) sin responder. ' : '') + '\n\nAl finalizar se emitirá su calificación definitiva, que NO podrá modificarse ni apelarse. ¿Desea continuar?';
  if (!confirm(msg)) return;
  clearTimeout(sv);
  call('submitAttempt', { attemptId: EX.id, respuestas: EX.ans }).then(function (d) {
    EX.active = false; guard.stop(); renderResult(d.result, d.debrief, d.notificaciones);
  }).catch(function (e) { fail(e); if (e.code === 'CLOSED') { EX.active = false; guard.stop(); studentHome(); } });
}
$('#ex-finish').onclick = finishAsk;

/* ---------- resultado + debriefing + confidencialidad ---------- */
function renderResult(r, deb, notifs) {
  show('result');
  var ok = r.estatus === 'APROBADO';
  var areas = (r.areas || []).map(function (a) {
    var col = a.pct >= 70 ? 'var(--teal)' : 'var(--red)';
    return '<div class="brow"><div class="bn">' + h(a.materia) + '</div><div class="bt"><i style="width:' + a.pct + '%;background:' + col + '"></i></div><div class="bv" style="color:' + col + '">' + a.pct + '</div></div>';
  }).join('');
  var html = '<div class="final"><div><small>Sustentante</small><div style="font-family:var(--disp);font-weight:700;font-size:20px">' + h(ST.user.apellidos + ', ' + ST.user.nombre) + '</div>' +
    '<div style="color:#9dbbc9;font-size:13px">' + h(SP.nombre) + ' · Matrícula ' + h(ST.user.matricula) + '</div></div>' +
    '<div style="text-align:right"><small>Calificación</small><div class="n" style="color:' + (ok ? '#5fd0c9' : '#ff9a8f') + '">' + r.calificacion + '<span style="font-size:18px;color:#9dbbc9">/100</span></div>' +
    '<span class="pill ' + (ok ? 'ok' : 'no') + '">' + r.estatus + '</span> <span class="pill n">' + r.aciertos + '/' + r.total + ' aciertos</span></div></div>' +
    '<div class="grid g-2" style="margin-top:20px"><div class="card pad"><h3 class="h3">Desempeño por materia</h3><div class="bars">' + areas + '</div>' +
    '<div class="note" style="margin-top:14px">Mínimo aprobatorio: <b>' + r.minimo + '</b>. La calificación y este documento son definitivos; el sistema no permite modificarlos.</div></div>' +
    '<div class="card pad"><h3 class="h3">Debriefing</h3><div id="deb"></div></div></div>' +
    '<div class="card pad" id="conf-card" style="margin-top:20px"></div>';
  $('#res-body').innerHTML = html;
  var d = deb;
  if (d) {
    var fu = d.fuertes.length ? d.fuertes.map(function (x) { return '<div class="area good"><h5>' + h(x.materia) + '</h5><div class="pct">' + x.pct + '% · ' + x.ok + '/' + x.total + '</div></div>'; }).join('') : '<p class="muted">Aún no hay materias con 70% o más.</p>';
    var op = d.oportunidades.length ? d.oportunidades.map(function (x) {
      return '<div class="area bad"><h5>' + h(x.materia) + '</h5><div class="pct">' + x.pct + '% · ' + x.ok + '/' + x.total + '</div>' +
        '<ul>' + x.temas.map(function (t) { return '<li>' + h(t) + '</li>'; }).join('') + '</ul>' +
        '<div class="biblio"><b>Bibliografía:</b> ' + x.biblio.map(h).join(' · ') + '</div></div>';
    }).join('') : '<p class="muted">Sin áreas críticas: todas las materias alcanzaron 70% o más.</p>';
    $('#deb').innerHTML = '<p style="margin-top:0"><b>Materias fuertes</b></p><div class="arealist">' + fu + '</div><p style="margin:14px 0 6px"><b>Oportunidades de estudio</b></p><div class="arealist">' + op + '</div>' +
      '<div class="row" style="margin-top:14px"><button class="btn ghost sm" id="dl-tem">Descargar temario PDF</button><button class="btn ghost sm" id="dl-res">Descargar resultado PDF</button></div>';
    $('#dl-tem').onclick = function () { call('myPdf', { tipo: 'temario' }).then(function (x) { dlb64(x.base64, x.nombre); }).catch(fail); };
    $('#dl-res').onclick = function () { call('myPdf', { tipo: 'resultado' }).then(function (x) { dlb64(x.base64, x.nombre); }).catch(fail); };
  } else {
    call('myDebrief').then(function (x) { $('#deb').innerHTML = '<p class="muted">Cargando…</p>'; renderResult(x.resultado, x.debrief); }).catch(fail);
  }
  if (notifs && notifs.length) {
    $('#deb').insertAdjacentHTML('beforeend', '<div style="margin-top:14px">' + notifs.map(function (n) {
      return '<div class="notif ' + (n.estado === 'enviado' ? 'ok' : (n.estado === 'error' ? 'err' : '')) + '">' + h(n.canal) + ' → ' + h(n.para) + ': <b>' + h(n.estado) + '</b>' + (n.detalle ? ' · ' + h(n.detalle) : '') + '</div>';
    }).join('') + '</div>');
  }
  // confidencialidad
  call('myStatus').then(function (s) {
    ST = s;
    if (s.confidencialidad) {
      $('#conf-card').innerHTML = '<h3 class="h3">Acuerdo de confidencialidad</h3><p class="muted" style="margin:0">Firmado. Gracias.</p>';
    } else {
      $('#conf-card').innerHTML = '<div class="docbadge">Paso 3 de 3 · Obligatorio</div><h3 class="h3">Acuerdo de confidencialidad</h3>' +
        '<div class="legal"><p>Me obligo a <b>no divulgar, publicar, fotografiar, grabar, reproducir ni compartir</b> por ningún medio los reactivos, opciones, casos clínicos, imágenes o cualquier contenido del examen que acabo de presentar, ni total ni parcialmente.</p>' +
        '<p>Reconozco que el contenido es propiedad de sus autores y que su divulgación puede constituir una falta académica y profesional, con las consecuencias que determine la institución.</p>' +
        '<p>Esta obligación es indefinida y subsiste después de concluida la evaluación.</p></div>' +
        '<div class="sign"><label class="check"><input type="checkbox" id="cf-ok"><span>Acepto el acuerdo de confidencialidad.</span></label>' +
        '<div class="field" style="margin:8px 0 0"><label class="f">Nombre completo (firma electrónica)</label><input id="cf-name" class="t" placeholder="' + h(ST.user.nombre + ' ' + ST.user.apellidos) + '"></div>' +
        '<div class="msg" id="cf-msg"></div><button class="btn primary" id="cf-go">Firmar acuerdo</button></div>';
      $('#cf-go').onclick = function () {
        if (!$('#cf-ok').checked) { $('#cf-msg').textContent = 'Marque la casilla.'; return; }
        call('signConfidentiality', { acepta: true, nombreCompleto: $('#cf-name').value }).then(function () {
          $('#conf-card').innerHTML = '<h3 class="h3">Acuerdo de confidencialidad</h3><p class="muted" style="margin:0">Firmado y registrado. Gracias.</p>';
          toast('Acuerdo firmado.');
        }).catch(function (er) { $('#cf-msg').textContent = er.error; });
      };
    }
  }).catch(function () {});
}
function dlb64(b64, name) {
  var bin = atob(b64), arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  download(new Blob([arr], { type: 'application/pdf' }), name);
}
function download(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }

/* ================= protección ================= */
var guard = (function () {
  var on = false, tm = null, bt = null, last = {};
  function wmText() { var d = new Date(); return (ST ? ST.user.apellidos + ' ' + ST.user.nombre + ' · ' + ST.user.matricula : '') + ' · ' + p2(d.getDate()) + '/' + p2(d.getMonth() + 1) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function incident(tipo, det) {
    if (!EX.active) return; var n = Date.now(); if (last[tipo] && n - last[tipo] < 4000) return; last[tipo] = n;
    call('logIncident', { attemptId: EX.id, tipo: tipo, detalle: det || '' }, true).catch(function () {});
  }
  function veil(msg, tipo, det) { if (!EX.active) return; document.body.classList.add('veiled'); $('#shield-msg').textContent = msg; $('#shield').classList.add('on'); incident(tipo, det); }
  function draw() {
    var t = h(wmText()), W = innerWidth, H = innerHeight, out = '', row = 0;
    for (var y = -60; y < H + 240; y += 118, row++) for (var x = -300 + (row % 2) * 200; x < W + 200; x += 420) out += '<span style="left:' + x + 'px;top:' + y + 'px">' + t + '</span>';
    $('#wm').innerHTML = out; $('#wm-badge').textContent = wmText();
  }
  function move() { var b = $('#wm-badge'); b.style.left = (20 + Math.random() * Math.max(40, innerWidth - 380)) + 'px'; b.style.top = (90 + Math.random() * Math.max(40, innerHeight - 160)) + 'px'; }
  function onKey(e) {
    var k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (k === 'printscreen' || e.keyCode === 44) { e.preventDefault(); try { navigator.clipboard && navigator.clipboard.writeText('Captura no permitida · ' + wmText()); } catch (x) {} veil('Se detectó un intento de captura de pantalla. Quedó registrado.', 'captura_pantalla', 'Impr Pant'); return false; }
    if (e.metaKey && e.shiftKey && /^[345s]$/.test(k)) { e.preventDefault(); veil('Atajo de captura bloqueado.', 'captura_pantalla', e.key); return false; }
    if (k === 'f12' || (mod && e.shiftKey && /^[ijcs]$/.test(k))) { e.preventDefault(); incident('atajo_teclado', e.key); return false; }
    if (mod && /^[cxvaspu]$/.test(k)) { e.preventDefault(); if (k === 'p') { incident('imprimir', 'Ctrl+P'); toast('La impresión no está permitida.', true); } return false; }
  }
  var ev = [['copy', function (e) { e.preventDefault(); try { e.clipboardData.setData('text/plain', 'Contenido protegido · ' + wmText()); } catch (x) {} incident('copiar', e.type); }],
    ['cut', function (e) { e.preventDefault(); incident('copiar', 'cut'); }], ['paste', function (e) { e.preventDefault(); }],
    ['contextmenu', function (e) { e.preventDefault(); incident('menu_contextual', 'Clic derecho'); }],
    ['selectstart', function (e) { e.preventDefault(); }], ['dragstart', function (e) { e.preventDefault(); }],
    ['keydown', onKey], ['keyup', onKey]];
  function onVis() { if (document.hidden) veil('Salió de la ventana del examen. Quedó registrado.', 'salida_ventana', 'Pestaña oculta'); }
  function onBlur() { veil('La ventana perdió el foco. Quedó registrado.', 'salida_ventana', 'Cambio de ventana'); }
  function onPrint() { incident('imprimir', 'beforeprint'); }
  return {
    start: function () {
      if (on) return; on = true; draw(); move();
      tm = setInterval(draw, 30000); bt = setInterval(move, 6000);
      ev.forEach(function (p) { document.addEventListener(p[0], p[1], true); });
      document.addEventListener('visibilitychange', onVis); addEventListener('blur', onBlur); addEventListener('beforeprint', onPrint); addEventListener('resize', draw);
    },
    stop: function () {
      if (!on) return; on = false; clearInterval(tm); clearInterval(bt);
      ev.forEach(function (p) { document.removeEventListener(p[0], p[1], true); });
      document.removeEventListener('visibilitychange', onVis); removeEventListener('blur', onBlur); removeEventListener('beforeprint', onPrint); removeEventListener('resize', draw);
      $('#wm').innerHTML = ''; $('#shield').classList.remove('on'); document.body.classList.remove('veiled');
    }
  };
})();
$('#shield-back').onclick = function () { $('#shield').classList.remove('on'); document.body.classList.remove('veiled'); };

/* ================= PANEL ================= */
var R = { rows: [], especialidades: {}, config: {} };
function loadResults() {
  call('listResults').then(function (d) {
    R = d;
    var sel = $('#r-spec'), cur = sel.value;
    sel.innerHTML = '<option value="">Todas las especialidades</option>' + Object.keys(d.especialidades).map(function (k) { return '<option value="' + k + '">' + h(d.especialidades[k].nombre) + '</option>'; }).join('');
    sel.value = cur; renderResults();
  }).catch(fail);
}
$('#r-refresh').onclick = loadResults;
['#r-q', '#r-spec'].forEach(function (s) { $(s).oninput = renderResults; $(s).onchange = renderResults; });
function renderResults() {
  var fin = R.rows.filter(function (r) { return r.estado === 'emitido'; });
  var ap = fin.filter(function (r) { return r.estatus === 'APROBADO'; }).length;
  var prom = fin.length ? Math.round(fin.reduce(function (s, r) { return s + r.calificacion; }, 0) / fin.length) : 0;
  var specs = {}; fin.forEach(function (r) { specs[r.especialidad] = 1; });
  $('#r-stats').innerHTML = [[fin.length, 'Resultados emitidos'], [ap, 'Aprobados'], [Object.keys(specs).length, 'Especialidades evaluadas'], [fin.length ? prom : '—', 'Promedio']]
    .map(function (s) { return '<div class="stat"><div class="n">' + s[0] + '</div><div class="l">' + s[1] + '</div></div>'; }).join('');
  var q = $('#r-q').value.toLowerCase(), sp = $('#r-spec').value;
  var rows = R.rows.filter(function (r) {
    if (sp && r.especialidad !== sp) return false;
    if (q && ((r.nombre + ' ' + r.apellidos + ' ' + r.matricula + ' ' + r.especialidadNombre).toLowerCase().indexOf(q) < 0)) return false;
    return true;
  }).sort(function (a, b) { return (b.emitido || 0) - (a.emitido || 0); });
  $('#r-tb').innerHTML = rows.length ? rows.map(function (r) {
    var ok = r.estatus === 'APROBADO', fin = r.estado === 'emitido';
    return '<tr><td class="mono"><b>' + h(r.matricula) + '</b></td><td>' + h(r.apellidos + ', ' + r.nombre) + '</td><td>' + h(r.especialidadNombre) + '</td>' +
      '<td class="mono">' + r.aciertos + '/' + r.total + '</td><td class="mono"><b>' + r.calificacion + '</b></td>' +
      '<td>' + (fin ? '<span class="pill ' + (ok ? 'ok' : 'no') + '">' + r.estatus + '</span>' : '<span class="pill warn">EN CURSO</span>') + '</td>' +
      '<td class="mono">' + fdt(r.emitido) + '</td><td class="act"><button class="btn ghost sm" data-det="' + r.id + '">Detalle</button></td></tr>';
  }).join('') : '<tr><td colspan="8"><div class="empty"><b>Sin resultados</b>Aparecerán aquí en cuanto los sustentantes concluyan su examen.</div></td></tr>';
}
var DET = null;
$('#r-tb').onclick = function (e) {
  var b = e.target.closest('[data-det]'); if (!b) return;
  openDetail(b.dataset.det);
};
function openDetail(id, keepScroll) {
  call('attemptDetail', { id: id }).then(function (d) {
    DET = d;
    var a = d.attempt;
    var html = '<div class="row" style="margin-bottom:12px"><span class="pill n mono">' + h(d.alumno.matricula) + '</span><span class="pill n">' + h(d.especialidad) + '</span><span class="pill n">' + a.calificacion + '/100 · ' + a.aciertos + '/' + a.total + '</span><span class="pill ' + (a.estatus === 'APROBADO' ? 'ok' : 'no') + '">' + a.estatus + '</span>' + (a.ajustes ? '<span class="pill warn">' + a.ajustes + ' dictamen(es) ajustado(s)</span>' : '') + '</div>' +
      '<div class="bars" style="margin-bottom:16px">' + a.areas.map(function (x) { var c = x.pct >= 70 ? 'var(--teal)' : 'var(--red)'; return '<div class="brow"><div class="bn">' + h(x.materia) + '</div><div class="bt"><i style="width:' + x.pct + '%;background:' + c + '"></i></div><div class="bv" style="color:' + c + '">' + x.pct + '</div></div>'; }).join('') + '</div>' +
      '<h3 class="h3">Firmas y consentimientos</h3>' + (d.consentimientos.length ? d.consentimientos.map(function (c) { return '<div class="notif ok">' + h(c.tipo) + ' · ' + fdt(c.fecha) + ' · firma: <b>' + h(c.nombreCompleto) + '</b> · huella ' + h(c.huella.slice(0, 16)) + '…</div>'; }).join('') : '<p class="muted">Sin firmas registradas.</p>') +
      '<h3 class="h3" style="margin-top:16px">Incidencias (' + d.incidencias.length + ')</h3>' + (d.incidencias.length ? d.incidencias.map(function (i) { return '<div class="notif">' + fdt(i.fecha) + ' · ' + h(i.tipo) + ' · ' + h(i.detalle) + '</div>'; }).join('') : '<p class="muted">Sin incidencias.</p>') +
      '<div class="row" style="margin-top:16px;justify-content:space-between"><h3 class="h3" style="margin:0">Respuestas</h3>' + (a.ajustes ? '<button class="btn ghost sm" id="dt-hist">Ver historial de cambios</button>' : '') + '</div>';
    d.preguntas.forEach(function (q) {
      var u = d.respuestas[q.n], k = d.clave[q.n], aj = d.ajustes[q.n];
      var orig = u === k, bien = aj ? aj.dictamen === 'correcta' : orig;
      html += '<div class="q" id="dq-' + q.n + '"><div class="qh"><div class="num">' + q.n + '</div><div style="flex:1;min-width:0"><p class="stem">' + h(q.stem) + '</p><div class="opts">' +
        q.options.map(function (o, i) { var l = 'abcd'[i]; return '<div class="opt' + (l === k ? ' correct' : (l === u ? ' wrong' : '')) + '"><span class="ol">' + l + '</span><span>' + h(o) + '</span></div>'; }).join('') +
        '</div><div class="muted" style="font-size:12px;margin-top:6px">Alumno: <b>' + (u || 'sin responder') + '</b> · Clave: <b>' + k + '</b> · Dictamen: <b style="color:' + (bien ? 'var(--teal)' : 'var(--red)') + '">' + (bien ? '✓ correcta' : '✗ incorrecta') + '</b>' +
        (d.marcas[q.n] ? ' · <span class="pill warn">' + d.marcas[q.n] + ' marca(s) de revisión</span>' : '') + '</div>' +
        (aj ? '<div class="notif" style="margin-top:6px">Dictamen cambiado de <b>' + h(aj.original) + '</b> a <b>' + h(aj.dictamen) + '</b> por ' + h(aj.cargo) + ' (' + h(aj.por) + ') · ' + fdt(aj.fecha) + '<br>Justificación: ' + h(aj.justificacion) + '</div>' : '') +
        '<div class="row" style="margin-top:8px;gap:6px"><button class="btn ghost sm" data-mk="' + q.n + '">Marcar para revisión / opinar</button>' +
        (d.puedeAjustar ? '<button class="btn ghost sm" data-aj="' + q.n + '" data-to="' + (bien ? 'incorrecta' : 'correcta') + '">Cambiar a ' + (bien ? 'incorrecta' : 'correcta') + '</button>' : '') + '</div>' +
        '</div></div></div>';
    });
    var sc = keepScroll ? $('#m-body').scrollTop : 0;
    modal(d.alumno.apellidos + ', ' + d.alumno.nombre, html, true);
    $('#m-body').insertAdjacentHTML('afterbegin', '<p class="note" style="margin-bottom:14px">' + (d.puedeAjustar ? 'Puede cambiar el dictamen de una respuesta (correcta ↔ incorrecta). Cada cambio exige justificación, recalcula la calificación y queda registrado en la bitácora.' : 'Puede marcar reactivos para revisión y dejar su opinión. El cambio de dictamen corresponde al jefe de servicio, enseñanza o la coordinación.') + '</p>');
    if (sc) $('#m-body').scrollTop = sc;
    var hb = $('#dt-hist'); if (hb) hb.onclick = function () { histAjustes(a.id); };
    $('#m-body').onclick = function (ev) {
      var m = ev.target.closest('[data-mk]'); if (m) return markForm(Number(m.dataset.mk), a.id, function () { openDetail(id, true); });
      var j = ev.target.closest('[data-aj]'); if (j) return adjustForm(a.id, Number(j.dataset.aj), j.dataset.to, d, function () { openDetail(id, true); loadResults(); });
    };
  }).catch(fail);
}
/* Formularios en línea dentro de la tarjeta del reactivo */
function inlineBox(n, html) {
  $$('.inl-box').forEach(function (x) { x.remove(); });
  var host = document.getElementById('dq-' + n) || document.getElementById('rq-' + n);
  host.querySelector('.qh > div:last-child').insertAdjacentHTML('beforeend', '<div class="inl-box card pad" style="margin-top:10px;box-shadow:none;border:1px solid var(--line,#dde5ea)">' + html + '</div>');
  return host.querySelector('.inl-box');
}
function markForm(n, attemptId, after) {
  var box = inlineBox(n, '<div class="field"><label class="f">Motivo</label><select class="t" id="mk-mo"><option>Redacción ambigua</option><option>Clave posiblemente incorrecta</option><option>Más de una respuesta válida</option><option>Contenido desactualizado</option><option>Fuera del temario</option><option>Otro</option></select></div>' +
    '<div class="field"><label class="f">Opinión (opcional)</label><textarea class="t" id="mk-op" rows="3" placeholder="Si lo considera, explique su opinión sobre el reactivo"></textarea></div>' +
    '<div class="msg" id="mk-m"></div><div class="row"><button class="btn primary sm" id="mk-go">Marcar reactivo ' + n + '</button><button class="btn ghost sm" id="mk-x">Cancelar</button></div>');
  box.querySelector('#mk-x').onclick = function () { box.remove(); };
  box.querySelector('#mk-go').onclick = function () {
    call('marcarReactivo', { n: n, motivo: $('#mk-mo').value, opinion: $('#mk-op').value, attemptId: attemptId || '' })
      .then(function () { toast('Reactivo ' + n + ' marcado para revisión.'); after && after(); }).catch(function (er) { $('#mk-m').textContent = er.error; });
  };
}
function adjustForm(attemptId, n, to, d, after) {
  var aj = d.ajustes[n];
  var opts = '<option value="' + to + '">Cambiar a ' + to + '</option>' + (aj ? '<option value="original">Restaurar dictamen original (' + h(aj.original) + ')</option>' : '');
  var box = inlineBox(n, '<div class="field"><label class="f">Nuevo dictamen</label><select class="t" id="aj-to">' + opts + '</select></div>' +
    '<div class="field"><label class="f">Justificación del cambio (obligatoria)</label><textarea class="t" id="aj-j" rows="3" placeholder="Explique por qué se modifica el dictamen de esta respuesta"></textarea></div>' +
    '<div class="msg" id="aj-m"></div><div class="row"><button class="btn primary sm" id="aj-go">Aplicar cambio</button><button class="btn ghost sm" id="aj-x">Cancelar</button></div>');
  box.querySelector('#aj-x').onclick = function () { box.remove(); };
  box.querySelector('#aj-go').onclick = function () {
    var j = $('#aj-j').value.trim();
    if (j.length < 15) { $('#aj-m').textContent = 'Escriba la justificación (al menos 15 caracteres).'; return; }
    if (!confirm('Se cambiará el dictamen del reactivo ' + n + ' y se recalculará la calificación. El cambio queda registrado con su nombre y justificación. ¿Continuar?')) return;
    call('ajustarRespuesta', { attemptId: attemptId, n: n, dictamen: $('#aj-to').value, justificacion: j }).then(function (r) {
      toast('Dictamen actualizado. Calificación: ' + r.antes.calificacion + ' → ' + r.attempt.calificacion + ' (' + r.attempt.estatus + ').');
      after && after();
    }).catch(function (er) { $('#aj-m').textContent = er.error; });
  };
}
function histAjustes(attemptId) {
  call('historialAjustes', { attemptId: attemptId }).then(function (d) {
    var box = $('#m-body');
    box.insertAdjacentHTML('afterbegin', '<div class="card pad" style="margin-bottom:14px;box-shadow:none"><h3 class="h3">Historial de cambios de dictamen</h3>' + (d.rows.length ? d.rows.map(function (r) {
      return '<div class="notif">' + fdt(r.fecha) + ' · Reactivo <b>' + r.n + '</b>: ' + h(r.de) + ' → <b>' + h(r.a) + '</b> · ' + h(r.nombre) + ' (' + h(r.cargo) + ')<br>' + h(r.justificacion) + '</div>';
    }).join('') : '<p class="muted">Sin cambios.</p>') + '</div>');
    box.scrollTop = 0;
  }).catch(fail);
}


$('#r-exp').onclick = function () {
  if (!confirm('Se generará un PDF con las cinco actas, cada una con su hoja de firmas de asistencia. ¿Continuar?')) return;
  call('actasPdf', { incluirPendientes: true }).then(function (d) {
    dlb64(d.base64, d.nombre);
    var g = d.resumenGlobal;
    modal('Expediente consolidado generado',
      '<p class="muted" style="margin:0 0 12px">Archivo descargado con las ' + d.actas.length + ' actas.</p>' +
      '<div class="cred">Folio <b>' + h(d.folio) + '</b><br>Huella: <b>' + h(d.sello.slice(0, 28)) + '…</b><br>' +
      'Sustentantes: <b>' + g.total + '</b> · Aprobados: <b>' + g.aprobados + '</b> · No aprobados: <b>' + g.noAprobados + '</b> · Pendientes: <b>' + g.pendientes + '</b>' +
      (g.promedio == null ? '' : ' · Promedio general: <b>' + g.promedio + '</b>') + '</div>' +
      '<div class="note" style="margin-top:12px">' + d.actas.map(function (x) { return h(x.especialidad) + ' · ' + x.resumen.total + ' sustentantes · folio ' + h(x.folio); }).join('<br>') + '</div>' +
      '<div class="row" style="margin-top:14px"><button class="btn primary" id="ex-ok">Cerrar</button></div>');
    $('#ex-ok').onclick = closeModal;
  }).catch(fail);
};

/* ---------- sustentantes ---------- */
var S = [];
var SP = { puedeEditar: false, puedeBorrar: false, alcance: null };
function loadStudents() { call('listStudents').then(function (d) { S = d.rows; SP = d; renderStudents(); }).catch(fail); }
$('#s-q').oninput = renderStudents;
function renderStudents() {
  var q = $('#s-q').value.toLowerCase();
  var rows = S.filter(function (u) { return !q || (u.nombre + ' ' + u.apellidos + ' ' + u.matricula + ' ' + u.email).toLowerCase().indexOf(q) >= 0; });
  $('#s-count').textContent = rows.length + ' sustentantes';
  $('#s-tb').innerHTML = rows.length ? rows.map(function (u) {
    return '<tr><td class="mono"><b>' + h(u.matricula) + '</b></td><td>' + h(u.apellidos + ', ' + u.nombre) + '</td><td>' + h((STATUS.especialidades.filter(function (x) { return x.id === u.especialidad; })[0] || {}).nombre || u.especialidad) + '</td>' +
      '<td>' + h(u.email) + '</td><td class="mono">' + (u.resultado == null ? '—' : u.resultado) + '</td><td>' + (u.estatus ? '<span class="pill ' + (u.estatus === 'APROBADO' ? 'ok' : 'no') + '">' + u.estatus + '</span>' : (u.enCurso ? '<span class="pill warn">EN CURSO</span>' : '<span class="pill n">Pendiente</span>')) + '</td>' +
      '<td class="act">' + (u.prueba ? '<span class="pill warn">Prueba</span> ' : '') + (SP.puedeEditar ? '<button class="btn ghost sm" data-ed="' + u.id + '">Editar</button>' : '') + '</td></tr>';
  }).join('') : '<tr><td colspan="7"><div class="empty"><b>Sin sustentantes</b>Inscríbalos para enviarles su temario.</div></td></tr>';
}
function specOptions(v, only) { return STATUS.especialidades.filter(function (s) { return !only || s.id === only; }).map(function (s) { return '<option value="' + s.id + '"' + (v === s.id ? ' selected' : '') + '>' + h(s.nombre) + '</option>'; }).join(''); }
function studentForm(u) {
  u = u || {};
  return '<form id="f-s"><div class="grid g-2">' +
    '<div class="field"><label class="f">Apellidos</label><input class="t" id="s-a" value="' + h(u.apellidos) + '" required></div>' +
    '<div class="field"><label class="f">Nombre(s)</label><input class="t" id="s-n" value="' + h(u.nombre) + '" required></div>' +
    '<div class="field"><label class="f">Correo electrónico (recibirá su temario)</label><input class="t" id="s-e" type="email" value="' + h(u.email) + '" required></div>' +
    '<div class="field"><label class="f">WhatsApp (opcional)</label><input class="t" id="s-w" value="' + h(u.whatsapp) + '" placeholder="5215512345678"></div>' +
    '<div class="field"><label class="f">Matrícula / folio</label><input class="t mono" id="s-m" value="' + h(u.matricula) + '" placeholder="Si se deja vacío se usa el usuario"></div>' +
    '<div class="field"><label class="f">Contraseña</label><input class="t mono" id="s-p" value="' + (u.id ? '' : rndPw()) + '" placeholder="' + (u.id ? 'Dejar vacío para conservar' : '') + '"></div></div>' +
    '<div class="field"><label class="f">Subespecialidad</label><select class="t" id="s-sp">' + specOptions(u.especialidad, SP.alcance) + '</select></div>' +
    '<div class="msg" id="s-m2"></div><div class="row"><button class="btn primary">' + (u.id ? 'Guardar' : 'Inscribir y enviar temario') + '</button>' + (u.id && SP.puedeBorrar ? '<button type="button" class="btn danger" id="s-del">Eliminar</button>' : '') + '</div></form>';
}
$('#s-new').onclick = function () {
  modal('Inscribir sustentante', studentForm());
  $('#f-s').onsubmit = function (e) {
    e.preventDefault();
    var p = { apellidos: $('#s-a').value, nombre: $('#s-n').value, email: $('#s-e').value, whatsapp: $('#s-w').value, matricula: $('#s-m').value, password: $('#s-p').value, especialidad: $('#s-sp').value, usuario: ($('#s-m').value || $('#s-e').value.split('@')[0]) };
    call('createStudent', p).then(function (d) {
      var html = '<p class="muted">Sustentante inscrito. Entregue estas credenciales:</p><div class="cred">Usuario <b>' + h(d.user.usuario) + '</b> · Contraseña <b>' + h(p.password) + '</b><br>Especialidad: <b>' + h(d.user.especialidad) + '</b> · Correo: ' + h(d.user.email) + '</div>';
      html += (d.notificaciones || []).map(function (n) { return '<div class="notif ' + (n.estado === 'enviado' ? 'ok' : '') + '">Temario por ' + h(n.canal) + ' → ' + h(n.para) + ': <b>' + h(n.estado) + '</b></div>'; }).join('');
      html += '<div class="row" style="margin-top:14px"><button class="btn primary" id="ok1">Listo</button></div>';
      modal('Inscripción registrada', html); $('#ok1').onclick = closeModal; loadStudents();
    }).catch(function (er) { $('#s-m2').textContent = er.error; });
  };
};
$('#s-tb').onclick = function (e) {
  var b = e.target.closest('[data-ed]'); if (!b) return;
  var u = S.filter(function (x) { return x.id === b.dataset.ed; })[0];
  modal('Editar ' + u.matricula, studentForm(u));
  $('#f-s').onsubmit = function (ev) {
    ev.preventDefault();
    var p = { id: u.id, apellidos: $('#s-a').value, nombre: $('#s-n').value, email: $('#s-e').value, whatsapp: $('#s-w').value, matricula: $('#s-m').value, especialidad: $('#s-sp').value };
    if ($('#s-p').value) p.password = $('#s-p').value;
    call('updateUser', p).then(function () { closeModal(); loadStudents(); toast('Datos actualizados.'); }).catch(function (er) { $('#s-m2').textContent = er.error; });
  };
  if ($('#s-del')) $('#s-del').onclick = function () { if (confirm('¿Eliminar a ' + u.apellidos + ', ' + u.nombre + '?' + (u.prueba ? ' Es un sustentante de prueba: se borrará también su examen y sus firmas.' : ''))) call('deleteUser', { id: u.id }).then(function () { closeModal(); loadStudents(); }).catch(function (er) { $('#s-m2').textContent = er.error; }); };
};
$('#s-bulk').onclick = function () {
  modal('Alta masiva', '<p class="muted">Pegue desde Excel: <b>Correo · Apellidos · Nombre(s) · Matrícula · WhatsApp · Especialidad (neonatologia, gastroenterologia, critico, oncologia, cirugia)</b></p>' +
    '<textarea class="t" id="bk" placeholder="ana@hospital.mx\tRUIZ PÉREZ\tANA\tA-001\t5215512345678\tneonatologia"></textarea>' +
    '<div class="msg" id="bk-m"></div><button class="btn primary" id="bk-go">Inscribir</button>');
  $('#bk-go').onclick = function () {
    var lines = $('#bk').value.split(/\r?\n/).map(function (l) { return l.trim() ? l.split(/\t|;|\|/).map(function (c) { return c.trim(); }) : null; }).filter(Boolean);
    if (lines.length && /correo|email/i.test(lines[0][0])) lines.shift();
    var rows = lines.map(function (c) { return { email: c[0], apellidos: c[1], nombre: c[2], matricula: c[3], whatsapp: c[4] || '', especialidad: (c[5] || '').toLowerCase(), usuario: c[3] || String(c[0] || '').split('@')[0], password: rndPw() }; });
    call('importStudents', { rows: rows }).then(function (d) {
      var html = '<p class="muted">Creados: <b>' + d.creados + '</b>' + (d.errores.length ? ' · errores: ' + d.errores.length : '') + '</p>';
      if (d.lista.length) html += '<div class="cred">' + d.lista.map(function (x, i) { return h(x.apellidos + ', ' + x.nombre) + ' — ' + h(x.email) + ' · usuario <b>' + h(x.usuario) + '</b> · contraseña <b>' + h(rows.filter(function (r) { return r.email === x.email; })[0].password) + '</b>'; }).join('<br>') + '</div>';
      if (d.errores.length) html += '<div class="notif err">' + d.errores.map(function (e) { return 'Fila ' + e.fila + ': ' + h(e.error); }).join('<br>') + '</div>';
      html += '<div class="row" style="margin-top:14px"><button class="btn primary" id="ok2">Listo</button></div>';
      modal('Alta masiva', html); $('#ok2').onclick = closeModal; loadStudents();
    }).catch(function (er) { $('#bk-m').textContent = er.error; });
  };
};

/* ---------- configuración ---------- */
function loadConfig() {
  call('getSettings').then(function (s) {
    $('#st-min').value = s.minAprob; $('#st-int').value = s.intentos;
    $('#ch-info').innerHTML = 'Correo: <b>' + h(s.canales.correo) + '</b><br>WhatsApp: <b>' + h(s.canales.whatsapp) + '</b>';
    var g = s.institucion || {};
    $('#cfg-inst').innerHTML = [['titularPediatria', 'Titular de Pediatría'], ['jefeEnsenanza', 'Jefe de Enseñanza']].map(function (x) {
      return '<div class="field"><label class="f">' + x[1] + '</label><input class="t" data-g="' + x[0] + '" value="' + h(g[x[0]]) + '"></div>' +
        '<div class="field"><label class="f">Correo · ' + x[1] + '</label><input class="t" type="email" data-g="' + x[0] + 'Email" value="' + h(g[x[0] + 'Email']) + '"></div>' +
        '<div class="field"><label class="f">WhatsApp · ' + x[1] + '</label><input class="t" data-g="' + x[0] + 'Tel" value="' + h(g[x[0] + 'Tel']) + '" placeholder="5215512345678"></div><div></div>';
    }).join('');
    $('#cfg-specs').innerHTML = s.catalogo.map(function (c) {
      var v = s.especialidades[c.id] || {};
      return '<div class="card pad" style="margin-bottom:14px;box-shadow:none"><h4 style="margin:0 0 10px;font-family:var(--disp)">' + h(c.nombre) + ' <span class="pill n">' + c.items + ' reactivos</span></h4>' +
        '<div class="grid g-2"><div class="field"><label class="f">Jefe de servicio</label><input class="t" data-f="jefe" data-k="' + c.id + '" value="' + h(v.jefe) + '"></div>' +
        '<div class="field"><label class="f">Correo del jefe</label><input class="t" type="email" data-f="jefeEmail" data-k="' + c.id + '" value="' + h(v.jefeEmail) + '"></div>' +
        '<div class="field"><label class="f">WhatsApp del jefe</label><input class="t" data-f="jefeTel" data-k="' + c.id + '" value="' + h(v.jefeTel) + '" placeholder="5215512345678"></div>' +
        '<div class="field"><label class="f">Titular de la especialidad</label><input class="t" data-f="titular" data-k="' + c.id + '" value="' + h(v.titular) + '"></div>' +
        '<div class="field"><label class="f">Correo del titular</label><input class="t" type="email" data-f="titularEmail" data-k="' + c.id + '" value="' + h(v.titularEmail) + '"></div>' +
        '<div class="field"><label class="f">WhatsApp del titular</label><input class="t" data-f="titularTel" data-k="' + c.id + '" value="' + h(v.titularTel) + '"></div></div></div>';
    }).join('');
  }).catch(fail);
}

function loadDiag() {
  if (!isFull()) return;
  call('diagnostico', {}, true).then(function (d) {
    $('#diag-card').style.display = '';
    if (!d.total) {
      $('#diag-info').textContent = 'Sin discrepancias: las ' + 'calificaciones registradas coinciden con el recálculo automático (motor ' + d.motorActual + ').';
      $('#diag-list').innerHTML = '';
      return;
    }
    $('#diag-info').innerHTML = 'Se encontraron <b>' + d.total + '</b> calificaciones que no coinciden con el recálculo a partir de las respuestas guardadas. ' +
      'Ocurre en exámenes calificados con la versión anterior del motor (1.0). Revise y, si procede, aplique la corrección: queda registrada en la bitácora.';
    $('#diag-list').innerHTML = '<div class="tblwrap"><table style="min-width:0"><thead><tr><th>Matrícula</th><th>Alumno</th><th>Especialidad</th><th>Respuestas</th><th>Actual</th><th>Recalculada</th></tr></thead><tbody>' +
      d.rows.map(function (r) {
        return '<tr><td class="mono">' + h(r.matricula) + '</td><td>' + h(r.alumno) + '</td><td>' + h(r.especialidad) + '</td><td class="mono">' + r.contestadas + '/' + r.total + '</td>' +
          '<td class="mono">' + r.actual.calificacion + ' <span class="muted">(' + r.actual.aciertos + ')</span></td>' +
          '<td class="mono"><b>' + r.nuevo.calificacion + '</b> <span class="muted">(' + r.nuevo.aciertos + ')</span></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="row" style="margin-top:14px"><button class="btn primary" id="diag-fix">Recalificar ' + d.total + ' examen(es)</button></div>';
    $('#diag-fix').onclick = function () {
      var motivo = prompt('Motivo de la corrección (queda en la bitácora):', 'Corrección de error del sistema: la clave se comparó con distinción de mayúsculas y el resultado se calculó en 0.');
      if (motivo == null) return;
      if (!confirm('Se recalcularán ' + d.total + ' calificaciones a partir de las respuestas guardadas. La acción queda auditada y no se puede deshacer. ¿Continuar?')) return;
      call('recalificar', { confirma: true, motivo: motivo, ids: d.rows.map(function (r) { return r.id; }) }).then(function (x) {
        var docs = (x.constancias || []).map(function (c) { return h(c.folio) + ' · ' + h(c.especialidad) + ' (' + c.examenes + ')'; });
        toast('Recalificados: ' + x.recalificados + (docs.length ? ' · constancias: ' + docs.join(', ') : ''));
        loadDiag(); loadResults(); loadFolios(); loadConstancias();
      }).catch(fail);
    };
  }).catch(function () {});
}


function loadFolios() {
  call('folios', {}, true).then(function (d) {
    $('#folio-tb').innerHTML = d.rows.map(function (r) {
      return '<tr><td>' + h(r.etiqueta) + '</td><td class="mono">' + h(r.prefijo) + '</td><td class="mono">' + r.usados + '</td><td class="mono"><b>' + h(r.siguiente) + '</b></td></tr>';
    }).join('');
    loadActasReg();
    var sel = $('#rf-esp');
    if (STATUS && !sel.options.length) sel.innerHTML = '<option value="">Todas las subespecialidades</option>' + STATUS.especialidades.map(function (s) { return '<option value="' + s.id + '">' + h(s.nombre) + '</option>'; }).join('');
  }).catch(function () {});
}
function loadActasReg() {
  call('actasEmitidas', {}, true).then(function (d) {
    var tb = $('#actas-tb'); if (!tb) return;
    tb.innerHTML = d.rows.length ? d.rows.map(function (r) {
      return '<tr><td class="mono"><b>' + h(r.folio) + '</b></td><td>' + h(r.especialidad) + '</td><td class="mono">' + h(r.fecha) + '</td>' +
        '<td class="mono" style="font-size:11px">' + h(r.sello) + '</td>' +
        '<td>' + (r.reimpresiones ? '<span class="pill n">Reimpresión</span>' : '<span class="pill ok">Original</span>') + '</td>' +
        '<td class="mono">' + r.reimpresiones + '</td><td class="mono">' + h(r.ultimaReimpresion || '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="7"><div class="empty"><b>Sin actas emitidas</b>Se registran al emitir el acta de cada subespecialidad.</div></td></tr>';
  }).catch(function () {});
}

function loadConstancias() {
  call('listConstancias', {}, true).then(function (d) {
    $('#k-tb').innerHTML = d.rows.length ? d.rows.map(function (k) {
      return '<tr><td class="mono"><b>' + h(k.folio) + '</b></td><td class="mono">' + fdt(k.fecha) + '</td><td>' + h(k.especialidadNombre) + '</td><td class="mono">' + k.examenes + '</td><td style="white-space:normal;max-width:300px">' + h(k.motivo) + '</td><td>' + h(k.usuario) + '</td>' +
        '<td class="act"><button class="btn ghost sm" data-k="' + k.id + '">Descargar</button></td></tr>';
    }).join('') : '<tr><td colspan="7"><div class="empty"><b>Sin constancias</b>Se emiten al recalificar calificaciones por un defecto del sistema.</div></td></tr>';
    $('#k-tb').onclick = function (e) {
      var b = e.target.closest('[data-k]'); if (!b) return;
      call('constanciaPdf', { id: b.dataset.k }).then(function (x) { dlb64(x.base64, x.nombre); }).catch(fail);
    };
  }).catch(function () {});
}
$('#rf-go').onclick = function () {
  var t = $('#rf-tipo').value, e = $('#rf-esp').value;
  if (!confirm('Se reiniciará la numeración de los folios seleccionados y volverá a 0001. Los documentos ya emitidos conservan su folio, por lo que podrían repetirse números. ¿Continuar?')) return;
  call('resetFolios', { confirma: true, tipo: t, especialidad: e }).then(function (x) { toast('Numeración reiniciada (' + x.reiniciados + ' contadores). Los folios ya emitidos se conservan en el registro de actas.'); loadFolios(); }).catch(fail);
};

$('#f-gen').onsubmit = function (e) {
  e.preventDefault();
  call('saveSettings', { minAprob: $('#st-min').value, intentos: $('#st-int').value }).then(function () { $('#st-msg').className = 'msg ok'; $('#st-msg').textContent = 'Reglas guardadas.'; }).catch(function (er) { $('#st-msg').className = 'msg'; $('#st-msg').textContent = er.error; });
};
$('#cfg-save').onclick = function () {
  var out = {};
  $$('#cfg-specs [data-k]').forEach(function (i) { var k = i.dataset.k; out[k] = out[k] || {}; out[k][i.dataset.f] = i.value; });
  var inst = {}; $$('#cfg-inst [data-g]').forEach(function (i) { inst[i.dataset.g] = i.value; });
  call('saveSettings', { especialidades: out, institucion: inst }).then(function () { $('#cfg-msg').className = 'msg ok'; $('#cfg-msg').textContent = 'Destinatarios guardados.'; }).catch(function (er) { $('#cfg-msg').textContent = er.error; });
};

/* ---------- bitácora ---------- */
function loadNotifs() {
  call('listNotifications').then(function (d) {
    $('#n-tb').innerHTML = d.rows.length ? d.rows.map(function (n) {
      return '<tr><td class="mono">' + fdt(n.creado) + '</td><td>' + h(n.canal) + '</td><td>' + h(n.nombre ? n.nombre + ' · ' : '') + h(n.para) + '</td><td>' + h(n.tipo) + '</td>' +
        '<td><span class="pill ' + (n.estado === 'enviado' ? 'ok' : (n.estado === 'error' ? 'no' : 'n')) + '">' + h(n.estado) + '</span></td><td style="white-space:normal;max-width:340px">' + h(n.detalle) + '</td>' +
        '<td class="act">' + (isFull() && n.estado !== 'enviado' ? '<button class="btn ghost sm" data-rs="' + n.id + '">Reenviar</button>' : '') + '</td></tr>';
    }).join('') : '<tr><td colspan="7"><div class="empty"><b>Sin envíos</b>Se registrarán al inscribir alumnos y al emitir resultados.</div></td></tr>';
  }).catch(fail);
  call('listConsents').then(function (d) {
    $('#c-tb').innerHTML = d.rows.length ? d.rows.map(function (c) {
      return '<tr><td class="mono">' + fdt(c.fecha) + '</td><td>' + h(c.tipo) + '</td><td>' + h(c.nombre) + '</td><td class="mono">' + h(c.matricula) + '</td><td>' + h(c.especialidad) + '</td><td>' + h(c.firma) + '</td><td class="mono" style="font-size:11px">' + h(c.huella.slice(0, 18)) + '…</td></tr>';
    }).join('') : '<tr><td colspan="7"><div class="empty"><b>Sin firmas</b></div></td></tr>';
  }).catch(fail);
}
$('#n-refresh').onclick = loadNotifs;
$('#n-tb').onclick = function (e) {
  var b = e.target.closest('[data-rs]'); if (!b) return;
  call('resend', { id: b.dataset.rs }).then(function (r) { toast('Reenvío: ' + r.estado + (r.detalle ? ' · ' + r.detalle : '')); loadNotifs(); }).catch(fail);
};


$('#r-acta').onclick = function () {
  var list = (R.especialidades && Object.keys(R.especialidades).length) ? R.especialidades
    : (STATUS ? STATUS.especialidades.reduce(function (o, s) { o[s.id] = s; return o; }, {}) : {});
  var ids = Object.keys(list);
  if (!ids.length) { toast('No hay especialidades disponibles.', true); return; }
  modal('Acta por subespecialidad',
    '<p class="muted" style="margin:0 0 14px">Genera el acta para expediente: relación de sustentantes con calificación, firma electrónica registrada, resumen y espacios de firma de las autoridades.</p>' +
    '<div class="field"><label class="f">Subespecialidad</label><select class="t" id="ac-sp">' +
    ids.map(function (k) { return '<option value="' + k + '">' + h(list[k].nombre) + '</option>'; }).join('') + '</select></div>' +
    '<label class="check sm" style="margin-bottom:14px"><input type="checkbox" id="ac-pend" checked> <span>Incluir sustentantes con examen pendiente</span></label>' +
    '<div class="msg" id="ac-m"></div><button class="btn primary" id="ac-go">Generar acta PDF</button>');
  $('#ac-go').onclick = function () {
    $('#ac-m').textContent = '';
    call('actaPdf', { especialidad: $('#ac-sp').value, incluirPendientes: $('#ac-pend').checked }).then(function (d) {
      dlb64(d.base64, d.nombre);
      var r = d.resumen;
      $('#m-body').innerHTML = '<p class="muted" style="margin:0 0 12px">Acta generada y descargada.</p><div class="cred">Folio <b>' + h(d.folio) + '</b><br>Sello digital SHA-256: <b>' + h(d.sello.slice(0, 28)) + '…</b><br>' +
        'Sustentantes: <b>' + r.total + '</b> · Aprobados: <b>' + r.aprobados + '</b> · No aprobados: <b>' + r.noAprobados + '</b> · Pendientes: <b>' + r.pendientes + '</b>' +
        (r.promedio == null ? '' : ' · Promedio: <b>' + r.promedio + '</b>') + '</div>' +
        '<div class="row" style="margin-top:14px"><button class="btn primary" id="ac-ok">Cerrar</button></div>';
      $('#ac-ok').onclick = closeModal;
    }).catch(function (e) { $('#ac-m').textContent = e.error; });
  };
};

/* ---------- reactivos: revisión académica ---------- */
var RV = { preguntas: [] };
function loadReview() { call('examReview').then(function (d) { RV = d; renderReview(); }).catch(fail); }
$('#rv-refresh').onclick = loadReview;
$('#rv-q').oninput = renderReview; $('#rv-f').onchange = renderReview;
function renderReview() {
  var q = $('#rv-q').value.toLowerCase().trim(), f = $('#rv-f').value;
  var rows = RV.preguntas.filter(function (p) {
    if (f === 'marcados' && !p.revisiones.length) return false;
    if (f === 'abiertas' && !p.revisiones.some(function (r) { return r.estado === 'abierta'; })) return false;
    if (q && String(p.n) !== q && (p.m + ' ' + p.stem).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  $('#rv-count').textContent = rows.length + ' reactivos · ' + RV.preguntas.filter(function (p) { return p.revisiones.length; }).length + ' marcados';
  $('#rv-list').innerHTML = rows.length ? rows.map(function (p) {
    var pct = p.evaluados ? Math.round(p.aciertos / p.evaluados * 100) : null;
    var revs = p.revisiones.map(function (r) {
      return '<div class="notif' + (r.estado === 'atendida' ? ' ok' : '') + '" style="margin-top:6px"><b>' + h(r.motivo) + '</b> · ' + h(r.nombre) + ' (' + h(r.cargo) + ') · ' + fdt(r.fecha) +
        ' · <span class="pill ' + (r.estado === 'atendida' ? 'ok' : 'warn') + '">' + h(r.estado) + '</span>' +
        (r.opinion ? '<br>' + h(r.opinion) : '') +
        (r.respuesta ? '<br><span class="muted">Respuesta de ' + h(r.atendidaPor) + ' (' + h(r.atendidaCargo) + '): ' + h(r.respuesta) + '</span>' : '') +
        '<div class="row" style="margin-top:6px;gap:6px">' +
        (RV.puedeAtender ? '<button class="btn ghost sm" data-at="' + r.id + '" data-st="' + (r.estado === 'atendida' ? 'abierta' : 'atendida') + '">' + (r.estado === 'atendida' ? 'Reabrir' : 'Marcar como atendida') + '</button>' : '') +
        (RV.puedeBorrar ? '<button class="btn danger sm" data-rd="' + r.id + '">Eliminar</button>' : '') + '</div></div>';
    }).join('');
    return '<div class="q" id="rq-' + p.n + '"><div class="qh"><div class="num">' + p.n + '</div><div style="flex:1;min-width:0">' +
      '<div class="row" style="gap:6px;margin-bottom:6px"><span class="pill n">' + h(p.m) + '</span>' + (pct == null ? '' : '<span class="pill ' + (pct >= 50 ? 'ok' : 'no') + '">' + pct + '% de aciertos (' + p.aciertos + '/' + p.evaluados + ')</span>') +
      (p.revisiones.length ? '<span class="pill warn">' + p.revisiones.length + ' marca(s)</span>' : '') + '</div>' +
      '<p class="stem">' + h(p.stem) + '</p><div class="opts">' +
      p.options.map(function (o, i) { var l = 'abcd'[i]; return '<div class="opt' + (l === p.clave ? ' correct' : '') + '"><span class="ol">' + l + '</span><span>' + h(o) + '</span></div>'; }).join('') +
      '</div><div class="muted" style="font-size:12px;margin-top:6px">Clave: <b>' + h(p.clave) + '</b></div>' + revs +
      '<div class="row" style="margin-top:8px"><button class="btn ghost sm" data-mk="' + p.n + '">Marcar para revisión / opinar</button></div>' +
      '</div></div></div>';
  }).join('') : '<div class="empty"><b>Sin reactivos</b>No hay reactivos que coincidan con el filtro.</div>';
}
$('#rv-list').onclick = function (e) {
  var m = e.target.closest('[data-mk]'); if (m) return markForm(Number(m.dataset.mk), '', loadReview);
  var a = e.target.closest('[data-at]');
  if (a) {
    var resp = a.dataset.st === 'atendida' ? prompt('Respuesta o acuerdo (opcional):', '') : '';
    if (resp === null) return;
    return call('atenderRevision', { id: a.dataset.at, estado: a.dataset.st, respuesta: resp }).then(function () { toast('Revisión actualizada.'); loadReview(); }).catch(fail);
  }
  var d = e.target.closest('[data-rd]');
  if (d && confirm('¿Eliminar esta marca de revisión? Esta acción no se puede deshacer.')) call('borrarRevision', { id: d.dataset.rd }).then(function () { toast('Marca eliminada.'); loadReview(); }).catch(fail);
};

/* ---------- usuarios del personal ---------- */
var STF = { rows: [] };
var ROLE_INFO = [
  ['titular_ped', 'Titular de Pediatría', 'Uno para todo el hospital. Revisa exámenes y resultados de todas las subespecialidades, marca reactivos para revisión y opina, e inscribe sustentantes.'],
  ['titular', 'Titular de subespecialidad', 'Revisa exámenes y resultados de su subespecialidad, marca reactivos para revisión y opina, e inscribe sustentantes.'],
  ['jefe', 'Jefe de servicio', 'Inscribe sustentantes, ve resultados de su subespecialidad, marca reactivos y opina, y cambia el dictamen correcta ↔ incorrecta de una respuesta, siempre con justificación.'],
  ['ensenanza', 'Jefe de Enseñanza', 'Todos los accesos del coordinador, excepto borrar información.'],
  ['admin', 'Coordinador', 'Acceso total. Es el único rol que puede borrar información.']
];
function loadStaff() {
  $('#u-roles').innerHTML = ROLE_INFO.filter(function (r) { return r[0] !== 'admin' || isAdmin(); }).map(function (r) { return '<div class="card pad" style="box-shadow:none"><b>' + h(r[1]) + '</b><p class="muted" style="font-size:13px;margin:6px 0 0">' + h(r[2]) + '</p></div>'; }).join('');
  call('listStaff').then(function (d) { STF = d; renderStaff(); }).catch(fail);
}
function renderStaff() {
  var order = { admin: 0, ensenanza: 1, calificador: 1, titular: 2, jefe: 3 };
  var rows = STF.rows.slice().sort(function (a, b) { return (order[a.rol] - order[b.rol]) || (a.cargo || '').localeCompare(b.cargo || ''); });
  $('#u-tb').innerHTML = rows.map(function (u) {
    return '<tr><td class="mono"><b>' + h(u.usuario) + '</b></td><td>' + h((u.nombre + ' ' + u.apellidos).trim()) + '</td><td>' + h(u.cargo) + '</td><td>' + h(u.email) + '</td>' +
      '<td>' + (u.activo ? '<span class="pill ok">Activo</span>' : '<span class="pill no">Inactivo</span>') + '</td><td class="mono">' + (u.ultimoAcceso ? fdt(u.ultimoAcceso) : '—') + '</td>' +
      '<td class="act">' + (u.id === ME.id || (u.rol === 'admin' && !isAdmin()) ? '' : '<button class="btn ghost sm" data-ue="' + u.id + '">Editar</button>') + '</td></tr>';
  }).join('');
}
function roleKey(u) { return u.rol === 'titular' && (!u.especialidad || u.especialidad === 'pediatria') ? 'titular_ped' : (u.rol === 'calificador' ? 'ensenanza' : u.rol); }
function staffForm(u) {
  u = u || {};
  var rk = u.id ? roleKey(u) : 'titular';
  return '<form id="f-u"><div class="grid g-2">' +
    '<div class="field"><label class="f">Tipo de usuario</label><select class="t" id="u-rol">' + ROLE_INFO.filter(function (r) { return r[0] !== 'admin' || isAdmin(); }).map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === rk ? ' selected' : '') + '>' + h(r[1]) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field" id="u-spw"><label class="f">Subespecialidad</label><select class="t" id="u-sp">' + specOptions(u.especialidad) + '</select></div>' +
    '<div class="field"><label class="f">Nombre(s)</label><input class="t" id="u-n" value="' + h(u.nombre) + '" required placeholder="Dr. / Dra. …"></div>' +
    '<div class="field"><label class="f">Apellidos</label><input class="t" id="u-a" value="' + h(u.apellidos) + '"></div>' +
    '<div class="field"><label class="f">Correo electrónico</label><input class="t" id="u-e" type="email" value="' + h(u.email) + '" placeholder="Para acceso con Google y avisos"></div>' +
    '<div class="field"><label class="f">WhatsApp (opcional)</label><input class="t" id="u-w" value="' + h(u.whatsapp) + '" placeholder="5215512345678"></div>' +
    (u.id ? '' : '<div class="field"><label class="f">Usuario</label><input class="t mono" id="u-u" required placeholder="ej. titular.neo"></div>') +
    '<div class="field"><label class="f">Contraseña</label><input class="t mono" id="u-p" value="' + (u.id ? '' : rndPw()) + '" placeholder="' + (u.id ? 'Dejar vacío para conservar' : '') + '"></div></div>' +
    (u.id ? '<label class="check sm" style="margin-bottom:12px"><input type="checkbox" id="u-act"' + (u.activo ? ' checked' : '') + '> <span>Usuario activo (puede iniciar sesión)</span></label>' : '') +
    '<p class="note" id="u-desc" style="margin:0 0 12px"></p>' +
    '<div class="msg" id="u-m"></div><div class="row"><button class="btn primary">' + (u.id ? 'Guardar' : 'Dar de alta') + '</button>' + (u.id && STF.puedeBorrar ? '<button type="button" class="btn danger" id="u-del">Eliminar</button>' : '') + '</div></form>';
}
function wireStaffForm() {
  function sync() {
    var r = $('#u-rol').value;
    $('#u-spw').style.display = (r === 'titular' || r === 'jefe') ? '' : 'none';
    $('#u-desc').textContent = (ROLE_INFO.filter(function (x) { return x[0] === r; })[0] || [])[2] || '';
  }
  $('#u-rol').onchange = sync; sync();
}
function staffParams() {
  var r = $('#u-rol').value, p = { nombre: $('#u-n').value, apellidos: $('#u-a').value, email: $('#u-e').value, whatsapp: $('#u-w').value };
  if (r === 'titular_ped') { p.rol = 'titular'; p.especialidad = 'pediatria'; }
  else { p.rol = r; p.especialidad = (r === 'titular' || r === 'jefe') ? $('#u-sp').value : ''; }
  return p;
}
$('#u-new').onclick = function () {
  modal('Dar de alta usuario', staffForm()); wireStaffForm();
  $('#f-u').onsubmit = function (e) {
    e.preventDefault();
    var p = staffParams(); p.usuario = $('#u-u').value; p.password = $('#u-p').value;
    call('createStaff', p).then(function (d) {
      modal('Usuario creado', '<p class="muted">Entregue estas credenciales a ' + h(d.user.nombre) + ':</p><div class="cred">Cargo <b>' + h(d.user.cargo) + '</b><br>Usuario <b>' + h(d.user.usuario) + '</b> · Contraseña <b>' + h(p.password) + '</b></div>' +
        '<p class="note" style="margin-top:12px">Si el puesto estaba vacío en «Especialidades», se registró como destinatario de resultados y firma de actas.</p><div class="row" style="margin-top:14px"><button class="btn primary" id="u-ok">Listo</button></div>');
      $('#u-ok').onclick = closeModal; loadStaff();
    }).catch(function (er) { $('#u-m').textContent = er.error; });
  };
};
$('#u-tb').onclick = function (e) {
  var b = e.target.closest('[data-ue]'); if (!b) return;
  var u = STF.rows.filter(function (x) { return x.id === b.dataset.ue; })[0];
  modal('Editar ' + u.usuario, staffForm(u)); wireStaffForm();
  $('#f-u').onsubmit = function (ev) {
    ev.preventDefault();
    var p = staffParams(); p.id = u.id; p.activo = $('#u-act').checked;
    if ($('#u-p').value) p.password = $('#u-p').value;
    call('updateUser', p).then(function () { closeModal(); loadStaff(); toast('Usuario actualizado.'); }).catch(function (er) { $('#u-m').textContent = er.error; });
  };
  if ($('#u-del')) $('#u-del').onclick = function () {
    if (confirm('¿Eliminar al usuario ' + u.usuario + '? Para conservar su historial puede desactivarlo en su lugar.')) call('deleteUser', { id: u.id }).then(function () { closeModal(); loadStaff(); toast('Usuario eliminado.'); }).catch(function (er) { $('#u-m').textContent = er.error; });
  };
};

/* ---------- bitácora de cambios ---------- */
var AU_LBL = { ajuste_respuesta: 'Cambio de dictamen', reactivo_marcado: 'Reactivo marcado', revision_atendida: 'Revisión atendida', revision_borrada: 'Revisión eliminada',
  alta_sustentante: 'Alta de sustentante', alta_masiva: 'Alta masiva', alta_personal: 'Alta de personal', usuario_modificado: 'Usuario modificado', usuario_eliminado: 'Usuario eliminado',
  configuracion: 'Configuración', acta_emitida: 'Acta emitida', acta_reimpresa: 'Acta reimpresa', recalificacion: 'Recalificación', constancia_emitida: 'Constancia emitida',
  reinicio_folios: 'Reinicio de folios', acceso_google: 'Acceso con Google', password_restablecida: 'Contraseña restablecida', reset_link_generado: 'Código de restablecimiento', dominios_google: 'Dominios de Google' };
function loadAudit() {
  call('listAudit', {}, true).then(function (d) {
    $('#au-tb').innerHTML = d.rows.length ? d.rows.map(function (a) {
      var det = a.tipo === 'ajuste_respuesta' ? 'Matrícula ' + (a.matricula || '') + ' · reactivo ' + a.reactivo + ': ' + a.de + ' → ' + a.a + ' · calificación ' + a.antes.calificacion + ' → ' + a.despues.calificacion + ' · ' + a.justificacion
        : (a.objetivo ? a.objetivo + (a.rolObjetivo ? ' (' + a.rolObjetivo + ')' : '') : (a.alumno || a.folio || (a.reactivo ? 'Reactivo ' + a.reactivo : '') || ''));
      return '<tr><td class="mono">' + fdt(a.fecha) + '</td><td>' + h(AU_LBL[a.tipo] || a.tipo) + '</td><td>' + h(a.usuario || '') + (a.cargo ? ' · ' + h(a.cargo) : '') + '</td><td style="white-space:normal;max-width:420px">' + h(det) + '</td></tr>';
    }).join('') : '<tr><td colspan="4"><div class="empty"><b>Sin movimientos</b></div></td></tr>';
  }).catch(function () {});
}

/* ---------- Excel ---------- */
$('#r-xlsx').onclick = function () {
  var rows = [['Matrícula', 'Apellidos', 'Nombre(s)', 'Correo', 'Especialidad', 'Reactivos', 'Aciertos', 'Calificación', 'Estatus', 'Mínimo', 'Emitido']];
  R.rows.filter(function (r) { return r.estado === 'emitido'; }).forEach(function (r) {
    rows.push([r.matricula, r.apellidos, r.nombre, r.email, r.especialidadNombre, r.total, r.aciertos, r.calificacion, r.estatus, r.minimo, fdt(r.emitido)]);
  });
  download(xlsx([{ name: 'Resultados', rows: rows, widths: [14, 24, 24, 30, 34, 10, 10, 13, 14, 9, 17] }]), 'Resultados_subespecialidades_' + fname() + '.xlsx');
  toast('Excel descargado.');
};
var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u) { var c = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function enc(s) { return new TextEncoder().encode(s); }
function xlsx(sheets) {
  var parts = [], cen = [], off = 0;
  var u16 = function (n) { return [n & 255, n >> 8 & 255]; }, u32 = function (n) { return [n & 255, n >> 8 & 255, n >> 16 & 255, n >>> 24 & 255]; };
  function add(name, data) {
    var nm = enc(name), c = crc32(data);
    var lh = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(c), u32(data.length), u32(data.length), u16(nm.length), u16(0));
    parts.push(new Uint8Array(lh), nm, data); cen.push({ nm: nm, c: c, l: data.length, o: off }); off += lh.length + nm.length + data.length;
  }
  function xe(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function col(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  add('[Content_Types].xml', enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'));
  add('_rels/.rels', enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'));
  add('xl/workbook.xml', enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map(function (s, i) { return '<sheet name="' + xe(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>'));
  add('xl/_rels/workbook.xml.rels', enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'));
  add('xl/styles.xml', enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0C2130"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>'));
  sheets.forEach(function (s, i) {
    var body = '';
    s.rows.forEach(function (r, ri) {
      var rn = ri + 1;
      body += '<row r="' + rn + '">' + r.map(function (v, ci) {
        var ref = col(ci) + rn, st = rn === 1 ? ' s="1"' : '';
        if (v == null || v === '') return '<c r="' + ref + '"' + st + '/>';
        if (typeof v === 'number') return '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>';
        return '<c r="' + ref + '" t="inlineStr"' + st + '><is><t xml:space="preserve">' + xe(v) + '</t></is></c>';
      }).join('') + '</row>';
    });
    var cols = '<cols>' + (s.widths || []).map(function (w, j) { return '<col min="' + (j + 1) + '" max="' + (j + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>';
    add('xl/worksheets/sheet' + (i + 1) + '.xml', enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + cols + '<sheetData>' + body + '</sheetData></worksheet>'));
  });
  var cd = [], cs = 0;
  cen.forEach(function (e) { var hd = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(e.c), u32(e.l), u32(e.l), u16(e.nm.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(e.o)); cd.push(new Uint8Array(hd), e.nm); cs += hd.length + e.nm.length; });
  var end = [].concat(u32(0x06054b50), u16(0), u16(0), u16(cen.length), u16(cen.length), u32(cs), u32(off), u16(0));
  return new Blob(parts.concat(cd, [new Uint8Array(end)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ================= inicio ================= */
if (TOKEN) call('me').then(function (d) { enter(d.user); }).catch(function () { showLogin(); initGoogle(); wireReset(); }); else { showLogin(); initGoogle(); wireReset(); }
})();
