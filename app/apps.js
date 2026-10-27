// Per aggiungere un'app: una riga qui sotto.
// lanPort = porta sulla rete di casa (http): si usa quando la homepage è aperta in http.
// tsHost = nome del dispositivo Tailscale dell'app (repo ingressi-https): con la homepage aperta
//   in https, il riquadro porta a https://<tsHost>.<tailnet>.ts.net, senza porta.
// Un'app senza lanPort compare solo con la homepage aperta in https.
// path = sezione della homepage stessa (stesso indirizzo, nessuna porta).
const APPS = [
  { name: "Sillabe", desc: "Gioco per imparare a leggere le sillabe", icon: "🔤", lanPort: 8080, tsHost: "sillabe" },
  { name: "Parole", desc: "Componi le parole guardando l'immagine", icon: "🧩", lanPort: 8082, tsHost: "parole" },
  { name: "Giochi", desc: "Altri giochi da scegliere", icon: "🎮", path: "giochi/" },
  { name: "Minigiochi", desc: "Tutti i minigiochi, da cercare per nome", icon: "🕹️", lanPort: 8087, tsHost: "minigiochi" },
  { name: "Chess", desc: "Scacchi contro il computer", icon: "♟️", lanPort: 8085, tsHost: "chess" },
  { name: "Meteo", desc: "Le previsioni del tempo", icon: "🌤️", tsHost: "meteo" },
  { name: "Retro", desc: "Giochi retro da giocare nel browser", icon: "👾", lanPort: 8088, tsHost: "retro" },
  { name: "Impostore", desc: "Chi non conosce la parola? Passatevi il telefono", icon: "🕵️", lanPort: 8089, tsHost: "impostore" },
  { name: "Impasti", desc: "Impasti e ImpastiPLUS: calcolatori e diario per la pizza", icon: "🍕", lanPort: 8090, tsHost: "pizzapp" },
];

const host = location.hostname;
// In https la pagina arriva da tailscale serve (https://vito.<tailnet>.ts.net): le app con
// tsHost si aprono sul loro indirizzo https nella stessa tailnet.
const secure = location.protocol === "https:";
const tailnet = secure && host.endsWith(".ts.net") ? host.slice(host.indexOf(".") + 1) : "";
// Tailscale anche in http: nome breve (es. "vito", utile con il Relay privato di iCloud)
// o indirizzo 100.64.0.0/10.
const tailnetIp = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
const viaTailscale = secure || tailnetIp || (!host.includes(".") && host !== "localhost");

document.getElementById("where").textContent = viaTailscale
  ? "Connesso tramite Tailscale"
  : "Connesso dalla rete locale";

function appUrl(app) {
  if (app.path) return app.path;
  if (tailnet && app.tsHost) return `https://${app.tsHost}.${tailnet}/`;
  return app.lanPort ? `http://${host}:${app.lanPort}/` : "";
}

const list = document.getElementById("apps");
APPS.filter(appUrl).forEach((app, i) => {
  const url = appUrl(app);

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
