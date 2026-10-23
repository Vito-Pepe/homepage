// Per aggiungere un'app: una riga qui sotto.
// lanPort = porta sulla rete di casa (http), tsPort = porta HTTPS su Tailscale.
// Senza tsPort l'app si apre in http sulla lanPort anche dalla tailnet.
// path = sezione della homepage stessa (stesso indirizzo, nessuna porta).
const APPS = [
  { name: "Sillabe", desc: "Gioco per imparare a leggere le sillabe", icon: "🔤", lanPort: 8080, tsPort: 10000 },
  { name: "Parole", desc: "Componi le parole guardando l'immagine", icon: "🧩", lanPort: 8082 },
  { name: "Giochi", desc: "Altri giochi da scegliere", icon: "🎮", path: "giochi/" },
];

const host = location.hostname;
// In https la pagina arriva da tailscale serve: le app con tsPort si aprono in https.
const secure = location.protocol === "https:";
// Tailscale anche in http: nome breve (es. "vito", utile con il Relay privato di iCloud)
// o indirizzo 100.64.0.0/10.
const tailnetIp = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
const viaTailscale = secure || tailnetIp || (!host.includes(".") && host !== "localhost");

document.getElementById("where").textContent = viaTailscale
  ? "Connesso tramite Tailscale"
  : "Connesso dalla rete locale";

const list = document.getElementById("apps");
APPS.forEach((app, i) => {
  const url = app.path
    ? app.path
    : secure && app.tsPort
      ? `https://${host}:${app.tsPort}/`
      : `http://${host}:${app.lanPort}/`;

  const li = document.createElement("li");
  li.style.animationDelay = `${i * 0.08}s`;

  const a = document.createElement("a");
  a.href = url;
  a.className = `card tone-${i % 4}`;

  const icon = document.createElement("span");
  icon.className = "icon";
  icon.textContent = app.icon;

  const name = document.createElement("strong");
  name.className = "name";
  name.textContent = app.name;

  const desc = document.createElement("span");
  desc.className = "desc";
  desc.textContent = app.desc;

  a.append(icon, name, desc);
  li.append(a);
  list.append(li);
});
