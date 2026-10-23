// Elenco automatico dei giochi, da due cartelle (elenchi JSON generati da nginx):
//   files/     giochi messi nella repo su GitHub
//   caricati/  giochi caricati da questa pagina (servizio "giochi", con password)
// Nome e icona arrivano dal gioco stesso: <title>...</title> e <meta name="icona" content="🐶">.
// Facoltativa anche una descrizione: <meta name="description" content="...">.

const $ = (id) => document.getElementById(id);
const DIRS = ["files/", "caricati/"];
const HTML = /\.html?$/i;

let admin = false;
// Link pubblici per i genitori (solo in modalità gestione): "files/x.html" -> { url, token }
let links = {};
let publicUrl = "";

function showStatus(text) {
  $("status").textContent = text;
  $("status").hidden = !text;
}

function titleFromFile(name) {
  const base = name.replace(HTML, "").replace(/[-_]+/g, " ").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

async function listDir(dir) {
  try {
    const res = await fetch(dir, { cache: "no-store" });
    if (res.status === 404) return [];
    if (!res.ok) return null;
    return (await res.json())
      .filter((f) => f.type === "file" && HTML.test(f.name))
      .map((f) => ({ dir, file: f.name }));
  } catch {
    return null;
  }
}

async function readInfo(game) {
  try {
    const res = await fetch(game.dir + encodeURIComponent(game.file), { cache: "no-store" });
    if (!res.ok) return {};
    // DOMParser legge l'HTML senza eseguirne gli script
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const meta = (n) => (doc.querySelector(`meta[name="${n}"]`)?.getAttribute("content") || "").trim();
    return { title: doc.title.trim(), icon: meta("icona"), desc: meta("description") };
  } catch {
    return {};
  }
}

function card(game, i) {
  const li = document.createElement("li");
  li.style.animationDelay = `${i * 0.08}s`;

  const a = document.createElement("a");
  a.href = game.dir + encodeURIComponent(game.file);
  a.className = `card tone-${i % 4}`;

  const icon = document.createElement("span");
  icon.className = "icon";
  icon.textContent = Array.from(game.icon || "🎮").slice(0, 4).join("");

  const name = document.createElement("strong");
  name.className = "name";
  name.textContent = (game.title || titleFromFile(game.file)).slice(0, 60);

  a.append(icon, name);
  if (game.desc) {
    const desc = document.createElement("span");
    desc.className = "desc";
    desc.textContent = game.desc.slice(0, 140);
    a.append(desc);
  }
  li.append(a);

  const link = admin && links[`${game.dir}${game.file}`];
  if (link) li.append(shareBox(game, link));

  if (admin && game.dir === "caricati/") {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "remove";
    del.textContent = "✕";
    del.title = "Elimina questo gioco";
    del.setAttribute("aria-label", `Elimina ${name.textContent}`);
    del.addEventListener("click", () => removeGame(game, name.textContent));
    li.append(del);
  }
  return li;
}

// ── Link pubblici ──
async function copyText(text, input) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fuori da HTTPS il browser non dà accesso agli appunti: si copia dalla casella
    input.select();
    return document.execCommand("copy");
  }
}

function shareBox(game, link) {
  const box = document.createElement("div");
  box.className = "share";

  const input = document.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.value = link.url || `Codice ${link.token} (manca GIOCHI_PUBLIC_URL sul Pi)`;
  input.setAttribute("aria-label", "Link per i genitori");

  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "btn small";
  copy.textContent = "Copia link";
  copy.disabled = !link.url;
  copy.addEventListener("click", async () => {
    copy.textContent = (await copyText(input.value, input)) ? "Copiato!" : "Copia a mano";
    setTimeout(() => (copy.textContent = "Copia link"), 1800);
  });

  const rotate = document.createElement("button");
  rotate.type = "button";
  rotate.className = "btn small ghost";
  rotate.textContent = "Nuovo link";
  rotate.addEventListener("click", () => rotateLink(game));

  box.append(input, copy, rotate);
  return box;
}

async function loadLinks() {
  links = {};
  if (!admin) return;
  try {
    const data = await api("GET", "api/links");
    publicUrl = data.publicUrl;
    data.links.forEach((l) => (links[`${l.source}/${l.file}`] = l));
    $("no-public").hidden = Boolean(publicUrl);
  } catch (ex) {
    message(ex.message, "error");
  }
}

async function rotateLink(game) {
  if (!confirm("Creare un nuovo link per questo gioco? Quello vecchio smetterà subito di funzionare.")) return;
  try {
    await api("POST", "api/links/rotate", JSON.stringify({ source: game.dir.replace("/", ""), file: game.file }), "application/json");
    message("Nuovo link creato.", "ok");
  } catch (ex) {
    message(ex.message, "error");
  }
  await loadLinks();
  await loadGames();
}

async function loadGames() {
  const lists = await Promise.all(DIRS.map(listDir));
  if (lists.every((l) => l === null)) {
    showStatus("Non riesco a leggere l'elenco dei giochi. Riprova tra poco.");
    $("games").replaceChildren();
    return;
  }
  const found = lists.flatMap((l) => l || []);
  if (found.length === 0) {
    showStatus("Ancora nessun gioco: arriveranno presto!");
    $("games").replaceChildren();
    return;
  }
  showStatus("");
  const games = await Promise.all(found.map(async (g) => ({ ...g, ...(await readInfo(g)) })));
  games.sort((a, b) => (a.title || a.file).localeCompare(b.title || b.file, "it"));
  $("games").replaceChildren(...games.map(card));
}

// ── Gestione: password, caricamento, eliminazione ──
async function api(method, url, body, type) {
  const headers = { "X-Giochi": "1" };
  if (type) headers["Content-Type"] = type;
  const res = await fetch(url, { method, headers, body, credentials: "same-origin" });
  let data = {};
  try {
    data = await res.json();
  } catch {
    // risposta senza corpo
  }
  if (!res.ok) {
    const e = new Error(data.error || "Servizio dei giochi non raggiungibile");
    e.status = res.status;
    throw e;
  }
  return data;
}

function message(text, kind) {
  const m = $("admin-msg");
  m.textContent = text;
  m.className = `msg ${kind || ""}`;
  m.hidden = !text;
}

async function openAdmin() {
  $("admin").hidden = false;
  $("manage").hidden = true;
  message("");
  let s = { enabled: false, auth: false };
  try {
    s = await (await fetch("api/session", { cache: "no-store" })).json();
  } catch {
    message("Il servizio di caricamento non risponde.", "error");
  }
  $("admin-off").hidden = s.enabled;
  $("login").hidden = !s.enabled || s.auth;
  $("upload").hidden = !s.auth;
  admin = Boolean(s.auth);
  if (s.enabled && !s.auth) $("password").focus();
  await loadLinks();
  await loadGames();
  $("admin").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$("manage").addEventListener("click", openAdmin);

$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("POST", "api/login", JSON.stringify({ password: $("password").value }), "application/json");
    $("password").value = "";
    await openAdmin();
  } catch (ex) {
    message(ex.message, "error");
  }
});

$("logout").addEventListener("click", async () => {
  await api("POST", "api/logout").catch(() => {});
  admin = false;
  links = {};
  $("admin").hidden = true;
  $("manage").hidden = false;
  await loadGames();
});

async function upload(file, replace) {
  const url = `api/upload?name=${encodeURIComponent(file.name)}${replace ? "&replace=1" : ""}`;
  return api("POST", url, file, "text/html");
}

$("file").addEventListener("change", async () => {
  const file = $("file").files[0];
  if (!file) return;
  message("Caricamento…");
  try {
    let res;
    try {
      res = await upload(file, false);
    } catch (ex) {
      if (ex.status !== 409 || !confirm(`${ex.message}. Vuoi sostituirlo?`)) throw ex;
      res = await upload(file, true);
    }
    message(`Caricato: ${res.name}. Lo trovi nell'elenco qui sopra${res.url ? `, con il suo link per i genitori: ${res.url}` : ""}.`, "ok");
    await loadLinks();
    await loadGames();
  } catch (ex) {
    if (ex.status === 401) await openAdmin();
    message(ex.message, "error");
  } finally {
    $("file").value = "";
  }
});

async function removeGame(game, title) {
  if (!confirm(`Eliminare "${title}"?`)) return;
  try {
    await api("DELETE", `api/files/${encodeURIComponent(game.file)}`);
    message(`Eliminato: ${title}.`, "ok");
  } catch (ex) {
    message(ex.message, "error");
  }
  await loadLinks();
  await loadGames();
}

loadGames();
