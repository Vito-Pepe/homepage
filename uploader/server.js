'use strict';

// Servizio dei giochi.
// Porta privata (PORT, raggiunta solo da nginx su /giochi/api/): caricamento ed eliminazione dei
//   giochi e gestione dei link pubblici, con la password GIOCHI_PASSWORD.
// Porta pubblica (PUBLIC_PORT, pubblicata con il funnel di Tailscale): restituisce solo il gioco
//   che corrisponde a un codice valido, in sandbox. Nient'altro.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_PORT = Number(process.env.PUBLIC_PORT) || 3001;
// Giochi caricati dalla pagina: cartella condivisa che nginx serve su /giochi/caricati/
const DATA_DIR = process.env.DATA_DIR || '/data';
// Giochi della repo (app/giochi/files/), in sola lettura
const REPO_DIR = process.env.REPO_DIR || '/repo';
// Stato privato (codici dei link): NON va nella cartella dei giochi, che nginx rende elencabile
const STATE_DIR = process.env.STATE_DIR || '/state';
const LINKS_FILE = path.join(STATE_DIR, 'links.json');
const PASSWORD = process.env.GIOCHI_PASSWORD || '';
// Indirizzo con cui i genitori raggiungono la porta pubblica (es. https://.../g)
const PUBLIC_URL = /^https?:\/\/[^\s?#]+$/.test(String(process.env.GIOCHI_PUBLIC_URL || '').replace(/\/+$/, ''))
  ? String(process.env.GIOCHI_PUBLIC_URL).replace(/\/+$/, '')
  : '';

const MAX_SIZE = 3 * 1024 * 1024;
const MAX_FILES = 200;
const SESSION_MS = 12 * 60 * 60 * 1000;
const NAME = /^[a-z0-9][a-z0-9._-]{0,78}\.html$/;
const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const SOURCES = { files: REPO_DIR, caricati: DATA_DIR };

// Il segreto delle sessioni sta solo in memoria: dopo un riavvio serve rientrare con la password.
const secret = crypto.randomBytes(32);

for (const dir of [DATA_DIR, STATE_DIR]) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    console.error(`La cartella ${dir} non è scrivibile`);
  }
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

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
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
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\.htm$/, '.html')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '');
  if (!NAME.test(base) || base.includes('..')) {
    throw httpError(400, 'Nome del file non valido: serve un file .html');
  }
  return base;
}

function listUploaded() {
  return fs.readdirSync(DATA_DIR).filter((n) => NAME.test(n));
}

// Tutti i giochi: quelli della repo (nomi liberi, letti dalla cartella) e quelli caricati.
function allGames() {
  const out = [];
  for (const [source, dir] of Object.entries(SOURCES)) {
    let names = [];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && /\.html?$/i.test(d.name) && !d.name.startsWith('.'))
        .map((d) => d.name);
    } catch {
      // cartella assente: nessun gioco da quella fonte
    }
    names.forEach((file) => out.push({ source, file }));
  }
  return out;
}

// ── Link pubblici ──
// links.json: { "files/memory-esempio.html": "<codice>", "caricati/x.html": "<codice>" }
let links = {};
try {
  links = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
} catch {
  links = {};
}

function newToken() {
  return crypto.randomBytes(16).toString('base64url');
}

// Ogni gioco presente riceve un codice; i codici dei giochi spariti vengono tolti.
function syncLinks() {
  const games = allGames();
  const keys = new Set(games.map((g) => `${g.source}/${g.file}`));
  let changed = false;
  for (const key of keys) {
    if (!links[key]) {
      links[key] = newToken();
      changed = true;
    }
  }
  for (const key of Object.keys(links)) {
    if (!keys.has(key)) {
      delete links[key];
      changed = true;
    }
  }
  if (changed) {
    try {
      writeAtomic(LINKS_FILE, JSON.stringify(links, null, 1));
    } catch (e) {
      console.error('Impossibile salvare i link:', e.message);
    }
  }
  return games;
}

function urlFor(token) {
  return PUBLIC_URL ? `${PUBLIC_URL}/${token}` : '';
}

function linkList() {
  return syncLinks().map(({ source, file }) => {
    const token = links[`${source}/${file}`];
    return { source, file, token, url: urlFor(token) };
  });
}

function findByToken(token) {
  if (!TOKEN.test(token)) return null;
  const key = Object.keys(links).find((k) => links[k] === token);
  if (!key) return null;
  const slash = key.indexOf('/');
  const dir = SOURCES[key.slice(0, slash)];
  const file = key.slice(slash + 1);
  if (!dir || file.includes('/') || file.includes('\\') || file.startsWith('.')) return null;
  return path.join(dir, file);
}

// ── Porta privata (dietro nginx) ──
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
    if (!exists && listUploaded().length >= MAX_FILES) throw httpError(507, 'Troppi giochi caricati: eliminane qualcuno');
    const buf = await readBody(req, MAX_SIZE);
    const text = buf.toString('utf8');
    if (!buf.length || text.includes('\u0000') || !/<(!doctype|html|head|body|script|div|canvas)/i.test(text)) {
      throw httpError(400, 'Il file non sembra una pagina html');
    }
    writeAtomic(file, buf);
    syncLinks();
    return sendJson(res, exists ? 200 : 201, { name, url: urlFor(links[`caricati/${name}`]) });
  }

  const del = url.pathname.match(/^\/giochi\/api\/files\/([^/]+)$/);
  if (del && req.method === 'DELETE') {
    const name = cleanName(decodeURIComponent(del[1]));
    const file = path.join(DATA_DIR, name);
    if (!fs.existsSync(file)) throw httpError(404, 'Gioco non trovato');
    fs.unlinkSync(file);
    syncLinks();
    return sendJson(res, 200, { ok: true });
  }

  if (route === 'GET /giochi/api/links') {
    return sendJson(res, 200, { publicUrl: PUBLIC_URL, links: linkList() });
  }

  if (route === 'POST /giochi/api/links/rotate') {
    let body;
    try {
      body = JSON.parse((await readBody(req, 1024)).toString('utf8'));
    } catch (e) {
      throw e.status ? e : httpError(400, 'Richiesta non valida');
    }
    syncLinks();
    const key = `${body.source}/${body.file}`;
    if (!SOURCES[body.source] || typeof body.file !== 'string' || !links[key]) {
      throw httpError(404, 'Gioco non trovato');
    }
    links[key] = newToken();
    writeAtomic(LINKS_FILE, JSON.stringify(links, null, 1));
    return sendJson(res, 200, { publicUrl: PUBLIC_URL, links: linkList() });
  }

  throw httpError(404, 'Non trovato');
}

// ── Porta pubblica ──
// Risponde solo a /<codice> (o /g/<codice>, a seconda di come l'ingresso inoltra il percorso).
// Sandbox: il gioco gira in un'origine isolata, senza accesso a cookie o dati del sito.
const SANDBOX = 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock';

function handlePublic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Metodo non consentito');
  const url = new URL(req.url, 'http://localhost');
  const m = url.pathname.match(/^\/(?:g\/)?([A-Za-z0-9_-]{22})\/?$/);
  const file = m ? findByToken(m[1]) : null;
  let data;
  try {
    data = file ? fs.readFileSync(file) : null;
  } catch {
    data = null;
  }
  if (!data) {
    res.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end('<!DOCTYPE html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Gioco non trovato</title><body style="font-family:sans-serif;text-align:center;padding:3rem 1rem;background:#764ba2;color:#fff"><h1>Ops!</h1><p>Questo gioco non c\'è più. Chiedi un nuovo link alla logopedista.</p></body></html>');
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': SANDBOX,
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.end(req.method === 'HEAD' ? undefined : data);
}

// ── Avvio ──
function makeServer(handler) {
  const server = http.createServer(async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      if (!e.status) console.error(e);
      if (res.headersSent) return res.end();
      sendJson(res, e.status || 500, { error: e.status ? e.message : 'Errore interno' });
    }
  });
  server.headersTimeout = 10 * 1000;
  server.requestTimeout = 60 * 1000;
  return server;
}

syncLinks();

makeServer(handle).listen(PORT, () => {
  console.log(`Caricamento giochi sulla porta ${PORT}`);
  if (!PASSWORD) console.log('GIOCHI_PASSWORD non impostata: caricamento spento');
});
makeServer(handlePublic).listen(PUBLIC_PORT, () => {
  console.log(`Giochi pubblici (link) sulla porta ${PUBLIC_PORT}`);
  if (!PUBLIC_URL) console.log('GIOCHI_PUBLIC_URL non impostato: i link mostrano solo il codice');
});
