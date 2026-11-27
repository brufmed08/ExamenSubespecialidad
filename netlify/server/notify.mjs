/* Envío de correo (SMTP sin dependencias) y WhatsApp (CallMeBot / Meta). */
import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

/* Configuración SMTP. Para Gmail basta con SMTP_USER (la cuenta @gmail.com) y SMTP_PASS
   (contraseña de aplicación de 16 caracteres); host y puerto se deducen automáticamente. */
function smtpSettings() {
  const user = String(process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const gmail = /@(gmail|googlemail)\.com$/i.test(user);
  const host = String(process.env.SMTP_HOST || (gmail || user ? 'smtp.gmail.com' : '')).trim();
  const port = +(process.env.SMTP_PORT || 465);
  const secure = port === 465 || process.env.SMTP_SECURE === '1';
  const fromAddr = (String(process.env.SMTP_FROM || '').match(/<([^>]+)>/) || [])[1] || String(process.env.SMTP_FROM || '').trim() || user;
  const fromName = process.env.SMTP_FROM_NAME || 'Evaluación de Subespecialidades';
  return { user, pass, host, port, secure, fromAddr, fromName };
}

export function smtpConfigured() { const c = smtpSettings(); return !!(c.host && c.user && c.pass); }

const b64 = v => Buffer.from(v).toString('base64');
const wrap = s => s.replace(/.{1,76}/g, '$&\r\n');
const encWord = s => '=?UTF-8?B?' + b64(s) + '?=';

export function sendMail({ to, subject, text, pdf, pdfName }) {
  return new Promise(resolve => {
    const c = smtpSettings();
    if (!smtpConfigured()) return resolve({ ok: false, proveedor: 'simulado', detalle: 'SMTP no configurado (modo simulación)' });
    to = String(to || '').trim();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) return resolve({ ok: false, proveedor: 'smtp', detalle: 'Correo destinatario inválido' });
    const { host, port, secure, fromAddr } = c;
    const bnd = 'r' + crypto.randomBytes(8).toString('hex');
    const safeName = String(pdfName || 'documento.pdf').replace(/["\r\n]/g, '');
    let msg = `From: ${encWord(c.fromName)} <${fromAddr}>\r\nTo: <${to}>\r\nSubject: ${encWord(subject || '')}\r\n` +
      `Date: ${new Date().toUTCString()}\r\nMessage-ID: <${bnd}@${fromAddr.split('@')[1] || 'local'}>\r\nMIME-Version: 1.0\r\n` +
      `Content-Type: multipart/mixed; boundary="${bnd}"\r\n\r\n` +
      `--${bnd}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(b64(text || ''))}`;
    if (pdf) msg += `--${bnd}\r\nContent-Type: application/pdf; name="${safeName}"\r\nContent-Disposition: attachment; filename="${safeName}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(b64(pdf))}`;
    msg += `--${bnd}--\r\n`;

    let sock = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    let buf = '', step = 0, done = false, upgraded = false, seen = '';
    const timer = setTimeout(() => fin({ ok: false, proveedor: 'smtp', detalle: 'Tiempo de espera agotado al conectar con ' + host }), 20000);
    function fin(r) { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch (e) {} resolve(r); }
    const w = l => sock.write(l + '\r\n');
    function onData(d) {
      if (done) return;
      buf += d;
      const lines = buf.split('\r\n'); buf = lines.pop();
      for (const line of lines) {
        const code = line.slice(0, 3), last = line[3] !== '-';
        if (step === 0 && code === '220') { w('EHLO ' + (fromAddr.split('@')[1] || 'localhost')); step = 1; }
        else if (step === 1 && code === '250') {
          seen += line + '\n';
          if (!last) continue;
          if (!secure && !upgraded && /STARTTLS/i.test(seen)) { w('STARTTLS'); step = 2; }
          else { w('AUTH PLAIN ' + b64('\0' + c.user + '\0' + c.pass)); step = 4; }
        }
        else if (step === 2 && code === '220') {
          upgraded = true; buf = ''; step = 3;
          sock.removeListener('data', onData);
          const s2 = tls.connect({ socket: sock, servername: host }, () => { sock = s2; seen = ''; w('EHLO ' + (fromAddr.split('@')[1] || 'localhost')); step = 1; });
          s2.setEncoding('utf8'); s2.on('data', onData);
          s2.on('error', e => fin({ ok: false, proveedor: 'smtp', detalle: e.message }));
          return;
        }
        else if (step === 4 && code === '235') { w('MAIL FROM:<' + fromAddr + '>'); step = 5; }
        else if (step === 4 && /^5\d\d/.test(code)) {
          return fin({ ok: false, proveedor: 'smtp', detalle: /smtp\.gmail\.com/i.test(host)
            ? 'Gmail rechazó las credenciales: use una contraseña de aplicación (requiere verificación en dos pasos activa).'
            : 'Credenciales rechazadas: ' + line.slice(0, 120) });
        }
        else if (step === 5 && code === '250') { w('RCPT TO:<' + to + '>'); step = 6; }
        else if (step === 6 && /^25[01]/.test(code)) { w('DATA'); step = 7; }
        else if (step === 7 && code === '354') { sock.write(msg); w('.'); step = 8; }
        else if (step === 8 && code === '250') { w('QUIT'); fin({ ok: true, proveedor: 'smtp', detalle: 'Enviado a ' + to }); }
        else if (/^[45]\d\d/.test(code) && last && step >= 4) fin({ ok: false, proveedor: 'smtp', detalle: line.slice(0, 160) });
      }
    }
    sock.setEncoding('utf8');
    sock.on('data', onData);
    sock.on('error', e => fin({ ok: false, proveedor: 'smtp', detalle: e.message }));
  });
}

export async function sendWhatsApp({ to, text }) {
  const prov = process.env.WA_PROVIDER || '';
  const num = String(to || '').replace(/[^\d]/g, '');
  if (!prov || !num) return { ok: false, proveedor: 'simulado', detalle: 'WhatsApp no configurado (modo simulación)' };
  try {
    if (prov === 'callmebot') {
      const u = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent('+' + num)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(process.env.WA_KEY || '')}`;
      const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); const t = await r.text();
      return { ok: r.ok, proveedor: 'callmebot', detalle: (r.ok ? 'Enviado' : 'HTTP ' + r.status) + ' ' + t.slice(0, 120) };
    }
    if (prov === 'meta') {
      const r = await fetch(`https://graph.facebook.com/v20.0/${process.env.WA_PHONE_ID}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.WA_TOKEN },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: num, type: 'text', text: { body: text } }),
        signal: AbortSignal.timeout(15000)
      });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, proveedor: 'meta', detalle: r.ok ? 'Enviado' : JSON.stringify(j).slice(0, 160) };
    }
    return { ok: false, proveedor: prov, detalle: 'Proveedor desconocido' };
  } catch (e) { return { ok: false, proveedor: prov, detalle: e.message }; }
}
