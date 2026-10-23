# homepage

Pagina iniziale con i collegamenti alle app che girano sul Raspberry Pi (Sillabe e le prossime). È un sito statico servito da nginx in un container Docker.

I link si adattano da soli: dalla rete locale puntano a `http://<host>:<porta-lan>`, tramite Tailscale a `https://<host>:<porta-tailscale>`.

## Aggiungere un'app

Aggiungi una riga all'array `APPS` in `app/apps.js` e pusha: l'auto-update sul Pi fa il resto.

## Deploy sul Raspberry Pi

```bash
git clone -b <branch> https://github.com/Vito-Pepe/homepage.git
cd homepage
docker compose up --build -d
curl -I http://127.0.0.1:8081
```

Pubblicazione su Tailscale (homepage sull'indirizzo principale, porta 443):

```bash
sudo tailscale serve --bg --https=443 localhost:8081
```

Aggiornamento automatico ogni 5 minuti (senza sudo):

```bash
(crontab -l 2>/dev/null; echo "*/5 * * * * cd $HOME/homepage && ./update.sh >> $HOME/homepage/update.log 2>&1") | crontab -
```

## Porte

| App | LAN (http) | Tailscale (https) |
|---|---|---|
| homepage | 8081 | 443 |
| sillabe | 8080 | 8443 |
