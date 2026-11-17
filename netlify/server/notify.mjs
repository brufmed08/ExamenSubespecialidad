/* Envío de correo (SMTP sin dependencias) y WhatsApp (CallMeBot / Meta). */
import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

export function smtpConfigured() { return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS); }

export function sendMail({ to, subject, text, pdf, pdfName }) {
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
    let buf = '', step = 0, done = false, upgraded = false;
    const timer = setTimeout(() => fin({ ok: false, proveedor: 'smtp', detalle: 'Tiempo de espera agotado' }), 15000);
    function fin(r) { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch (e) {} resolve(r); }
    const w = l => sock.write(l + '\r\n');
    const auth = () => {
      const u = Buffer.from(process.env.SMTP_USER).toString('base64'), p = Buffer.from(process.env.SMTP_PASS).toString('base64');
      w('AUTH LOGIN'); setTimeout(() => w(u), 120); setTimeout(() => w(p), 240);
    };
    function onData(d) {
      buf += d;
      const lines = buf.split('\r\n'); buf = lines.pop();
      for (const line of lines) {
        const code = line.slice(0, 3);
        if (step === 0 && code === '220') { w('EHLO sistema.local'); step = 1; }
        else if (step === 1 && /^250 /.test(line)) {
          if (!secure && !upgraded && /STARTTLS/i.test(seen)) { w('STARTTLS'); step = 2; }
          else { auth(); step = 4; }
        }
        else if (step === 1 && /^250-/.test(line)) { seen += line + '\n'; }
        else if (step === 2 && code === '220') {
          upgraded = true; buf = '';
          const s2 = tls.connect({ socket: sock, servername: host }, () => { sock = s2; sock.setEncoding('utf8'); sock.on('data', onData); seen = ''; w('EHLO sistema.local'); step = 1; });
          s2.on('error', e => fin({ ok: false, proveedor: 'smtp', detalle: e.message }));
          return;
        }
        else if (step === 4 && code === '235') { w('MAIL FROM:<' + from + '>'); step = 5; }
        else if (step === 4 && code === '535') fin({ ok: false, proveedor: 'smtp', detalle: 'Credenciales rechazadas' });
        else if (step === 5 && code === '250') { w('RCPT TO:<' + to + '>'); step = 6; }
        else if (step === 6 && /^25[01]/.test(code)) { w('DATA'); step = 7; }
        else if (step === 7 && code === '354') { sock.write(msg); w('.'); step = 8; }
        else if (step === 8 && code === '250') { w('QUIT'); fin({ ok: true, proveedor: 'smtp', detalle: 'Enviado a ' + to }); }
        else if (/^5\d\d/.test(code) && step >= 4) fin({ ok: false, proveedor: 'smtp', detalle: line.slice(0, 160) });
      }
    }
    let seen = '';
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
