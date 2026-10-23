'use strict';

// Caricamento dei giochi dalla pagina /giochi/. Salva i file .html in DATA_DIR, una cartella
// condivisa che nginx serve (sola lettura) su /giochi/caricati/. Senza GIOCHI_PASSWORD il
// caricamento resta spento.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const PASSWORD = process.env.GIOCHI_PASSWORD || '';
const MAX_SIZE = 3 * 1024 * 1024;
const MAX_FILES = 200;
const SESSION_MS = 12 * 60 * 60 * 1000;
const NAME = /^[a-z0-9][a-z0-9._-]{0,78}\.html$/;

// Il segreto delle sessioni sta solo in memoria: la cartella dei dati è pubblica via nginx.
// Dopo un riavvio serve rientrare con la password.
const secret = crypto.randomBytes(32);

try {
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch {
  console.error(`La cartella ${DATA_DIR} non è scrivibile: il caricamento non funzionerà`);
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      // Oltre il limite si scarta il resto e si risponde a fine invio (nginx comunque
      // non lascia passare più di 4 MB)
      if (size <= limit) chunks.push(c);
    });
    req.on('end', () => {
      if (size > limit) reject(httpError(413, `File troppo grande (massimo ${limit / 1024 / 1024} MB)`));
      else resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

// ── Sessione ──
function sign(value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function isAuthed(req) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)giochi=([0-9]+)\.([0-9a-f]{64})/);
  if (!m || Number(m[1]) < Date.now()) return false;
  const expected = Buffer.from(sign(m[1]), 'hex');
  return crypto.timingSafeEqual(expected, Buffer.from(m[2], 'hex'));
}

function cookie(req, value, clear) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `giochi=${value}; Path=/giochi/; HttpOnly; SameSite=Strict${secure}${clear ? '; Max-Age=0' : ''}`;
}

function passwordMatches(given) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

let failures = 0;
let lockedUntil = 0;

// ── Nomi dei file ──
function cleanName(raw) {
  const base = path.basename(String(raw || ''))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.htm$/, '.html')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '');
  if (!NAME.test(base) || base.includes('..')) {
    throw httpError(400, 'Nome del file non valido: serve un file .html');
  }
  return base;
}

function listGames() {
  return fs.readdirSync(DATA_DIR).filter((n) => NAME.test(n));
}

// ── Richieste ──
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /giochi/api/session') {
    return sendJson(res, 200, { enabled: Boolean(PASSWORD), auth: Boolean(PASSWORD) && isAuthed(req) });
  }

  if (!PASSWORD) throw httpError(503, 'Caricamento non attivo: manca GIOCHI_PASSWORD sul Pi');

  // Le modifiche devono arrivare dalla pagina dei giochi (un modulo di un altro sito non
  // può aggiungere questa intestazione)
  if (req.method !== 'GET' && req.headers['x-giochi'] !== '1') throw httpError(403, 'Richiesta non valida');

  if (route === 'POST /giochi/api/login') {
    if (Date.now() < lockedUntil) throw httpError(429, 'Troppi tentativi, riprova tra un minuto');
    let body;
    try {
      body = JSON.parse((await readBody(req, 1024)).toString('utf8'));
    } catch (e) {
      throw e.status ? e : httpError(400, 'Richiesta non valida');
    }
    if (typeof body.password === 'string' && body.password.length <= 200 && passwordMatches(body.password)) {
      failures = 0;
      const exp = String(Date.now() + SESSION_MS);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, `${exp}.${sign(exp)}`) });
    }
    failures += 1;
    if (failures >= 5) {
      failures = 0;
      lockedUntil = Date.now() + 60 * 1000;
    }
    throw httpError(401, 'Password errata');
  }

  if (route === 'POST /giochi/api/logout') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', true) });
  }

  if (!isAuthed(req)) throw httpError(401, 'Serve la password');

  if (route === 'POST /giochi/api/upload') {
    const name = cleanName(url.searchParams.get('name'));
    const file = path.join(DATA_DIR, name);
    const exists = fs.existsSync(file);
    if (exists && url.searchParams.get('replace') !== '1') {
      throw httpError(409, `Esiste già un gioco chiamato ${name}`);
    }
    if (!exists && listGames().length >= MAX_FILES) throw httpError(507, 'Troppi giochi caricati: eliminane qualcuno');
    const buf = await readBody(req, MAX_SIZE);
    const text = buf.toString('utf8');
    if (!buf.length || text.includes('\u0000') || !/<(!doctype|html|head|body|script|div|canvas)/i.test(text)) {
      throw httpError(400, 'Il file non sembra una pagina html');
    }
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
    return sendJson(res, exists ? 200 : 201, { name });
  }

  const del = url.pathname.match(/^\/giochi\/api\/files\/([^/]+)$/);
  if (del && req.method === 'DELETE') {
    const name = cleanName(decodeURIComponent(del[1]));
    const file = path.join(DATA_DIR, name);
    if (!fs.existsSync(file)) throw httpError(404, 'Gioco non trovato');
    fs.unlinkSync(file);
    return sendJson(res, 200, { ok: true });
  }

  throw httpError(404, 'Non trovato');
}

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (e) {
    if (!e.status) console.error(e);
    if (res.headersSent) return res.end();
    sendJson(res, e.status || 500, { error: e.status ? e.message : 'Errore interno' });
  }
});
server.headersTimeout = 10 * 1000;
server.requestTimeout = 60 * 1000;

server.listen(PORT, () => {
  console.log(`Caricamento giochi sulla porta ${PORT}`);
  if (!PASSWORD) console.log('GIOCHI_PASSWORD non impostata: caricamento spento');
});
