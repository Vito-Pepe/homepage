# homepage

Pagina iniziale con i collegamenti alle app che girano sul Raspberry Pi (Sillabe e le prossime). È un sito statico servito da nginx in un container Docker.

I link si adattano da soli: dalla rete locale puntano a `http://<host>:<porta-lan>`, tramite Tailscale a `https://<host>:<porta-tailscale>`.

## Aggiungere un'app

Aggiungi una riga all'array `APPS` in `app/apps.js` e pusha: l'auto-update sul Pi fa il resto.

## Giochi

La sezione **Giochi** (riquadro nella homepage, pagina `/giochi/`) elenca da sola i giochi presenti in `app/giochi/files/`: per aggiungerne uno basta mettere lì il suo file `.html`, senza modificare nessun elenco.

- **Nome nell'elenco**: il `<title>` del gioco. Se manca, si usa il nome del file (`memory-animali.html` diventa "Memory animali").
- **Icona** (facoltativa): `<meta name="icona" content="🐶">` nel `<head>`. Se manca: 🎮.
- **Descrizione** (facoltativa): `<meta name="description" content="Trova le coppie">`.
- Consigliato: un link per tornare all'elenco, `<a href="../">← Giochi</a>`.

Ogni gioco è un file `.html`. Se usa immagini o altri file, mettili nella stessa cartella: nell'elenco compaiono solo i `.html`.

Per pubblicarne uno senza usare il terminale: su GitHub apri la cartella `app/giochi/files`, premi **Add file > Upload files**, trascina il file e conferma su `main`. Entro 5 minuti il Pi lo mostra.

`memory-esempio.html` è un esempio: si può cancellare quando arrivano i giochi veri.

### Caricare un gioco dalla pagina

In fondo alla pagina dei giochi c'è il link **Gestisci giochi**: con la password si può caricare un file `.html`, che compare subito nell'elenco, oppure eliminare un gioco caricato (la ✕ sul suo riquadro). I giochi caricati così stanno **solo sul Pi** (volume Docker `homepage_giochi-caricati`, servito da nginx su `/giochi/caricati/`), non su GitHub. Quelli in `app/giochi/files/` restano gestiti dalla repo e non si possono eliminare dalla pagina.

Il caricamento passa da un piccolo servizio Node (`uploader/`, servizio `giochi` nel compose) che nginx raggiunge su `/giochi/api/`: accetta solo file `.html` fino a 3 MB, pulisce il nome del file e chiede la password, con blocco di un minuto dopo 5 tentativi sbagliati. Senza password impostata il caricamento resta spento.

Impostare la password sul Pi (una volta; la riga che inizia con uno spazio non resta nella cronologia della shell):

```bash
cd ~/homepage
 read -rsp "Password per caricare i giochi: " P && echo "GIOCHI_PASSWORD=$P" >> .env && unset P && echo
docker compose up -d --build
```

Backup dei giochi caricati:

```bash
docker run --rm -v homepage_giochi-caricati:/data -v "$HOME":/backup alpine tar czf /backup/giochi-caricati.tgz -C /data .
```

## Deploy sul Raspberry Pi

```bash
git clone https://github.com/Vito-Pepe/homepage.git
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
