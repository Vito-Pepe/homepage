// Per aggiungere un'app: una riga qui sotto.
// lanPort = porta sulla rete di casa (http), tsPort = porta HTTPS su Tailscale.
const APPS = [
  { name: "Sillabe", desc: "Gioco per imparare a leggere le sillabe", icon: "🔤", lanPort: 8080, tsPort: 8443 },
];

const host = location.hostname;
const viaTailscale = location.protocol === "https:";

document.getElementById("where").textContent = viaTailscale
  ? "Connesso tramite Tailscale"
  : "Connesso dalla rete locale";

const list = document.getElementById("apps");
APPS.forEach((app, i) => {
  const url = viaTailscale
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
