// Elenco automatico dei giochi: legge i file .html in files/ (elenco JSON generato da nginx).
// Nome e icona arrivano dal gioco stesso: <title>...</title> e <meta name="icona" content="🐶">.
// Facoltativa anche una descrizione: <meta name="description" content="...">.

const list = document.getElementById("games");
const status = document.getElementById("status");

function showStatus(text) {
  status.textContent = text;
  status.hidden = false;
}

function titleFromFile(name) {
  const base = name.replace(/\.html?$/i, "").replace(/[-_]+/g, " ").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

async function readInfo(name) {
  try {
    const res = await fetch(`files/${encodeURIComponent(name)}`);
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
  a.href = `files/${encodeURIComponent(game.file)}`;
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
  return li;
}

(async () => {
  let files;
  try {
    const res = await fetch("files/", { cache: "no-store" });
    if (!res.ok) throw new Error();
    files = (await res.json()).filter((f) => f.type === "file" && /\.html?$/i.test(f.name));
  } catch {
    showStatus("Non riesco a leggere l'elenco dei giochi. Riprova tra poco.");
    return;
  }
  if (files.length === 0) {
    showStatus("Ancora nessun gioco: arriveranno presto!");
    return;
  }
  const games = await Promise.all(files.map(async (f) => ({ file: f.name, ...(await readInfo(f.name)) })));
  games.sort((a, b) => (a.title || a.file).localeCompare(b.title || b.file, "it"));
  games.forEach((g, i) => list.append(card(g, i)));
})();
