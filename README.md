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

### Link per i genitori

Ogni gioco, caricato o della repo, ha un **link pubblico** da mandare ai genitori: in "Gestisci giochi" compare sotto il suo riquadro, con "Copia link" e "Nuovo link" (che disattiva quello vecchio). Un gioco appena caricato riceve subito il link; quelli della repo lo ricevono da soli. Eliminando un gioco, il suo link smette di funzionare.

Chi apre il link vede **solo quel gioco**, da qualsiasi telefono e senza Tailscale. Lo serve la seconda porta del servizio `giochi` (`127.0.0.1:8084`, visibile solo sul Pi), che risponde solo a un codice valido (casuale, 128 bit) e restituisce il gioco in **sandbox**: gli script funzionano, ma il gioco non può salvare dati nel browser né vedere cookie o altre pagine del sito. Esce su Internet dall'ingresso pubblico di Parole (`parole-esercizi`, percorso `/g/`, configurato nella repo parole).

Limiti: un gioco pubblicato deve stare in un solo file (immagini incorporate o prese da Internet); il link "← Giochi" dentro un gioco, dalla versione pubblica, non porta da nessuna parte.

I codici stanno nel volume `homepage_giochi-stato`, separato dai giochi.

Configurazione sul Pi (indirizzo base dei link, una volta):

```bash
cd ~/homepage
echo "GIOCHI_PUBLIC_URL=https://parole-esercizi.<tailnet>.ts.net/g" >> .env
docker compose up -d --build
```

### Isolamento dalla rete di casa

Il servizio `giochi` riceve richieste da Internet, quindi i container della homepage stanno su una rete con bridge dal nome fisso (`br-giochi`) e le regole in `firewall/` bloccano ogni connessione nuova che ne esce verso LAN, tailnet, Internet e il Pi stesso. nginx e il servizio dei giochi possono comunque parlarsi. Installazione (una volta):

```bash
cd ~/homepage
sudo install -m 755 firewall/giochi-firewall.sh /usr/local/sbin/giochi-firewall.sh
sudo install -m 644 firewall/giochi-firewall.service /etc/systemd/system/giochi-firewall.service
sudo systemctl daemon-reload
sudo systemctl enable --now giochi-firewall.service
sudo giochi-firewall.sh status
```

Verifica (prima delle regole deve rispondere `RAGGIUNTO`, dopo `BLOCCATO`):

```bash
docker compose exec giochi wget -q -T 3 -O /dev/null http://192.168.1.1 && echo RAGGIUNTO || echo BLOCCATO
```

Backup dei giochi caricati e dei codici dei link:

```bash
docker run --rm -v homepage_giochi-caricati:/data -v "$HOME":/backup alpine tar czf /backup/giochi-caricati.tgz -C /data .
docker run --rm -v homepage_giochi-stato:/data -v "$HOME":/backup alpine tar czf /backup/giochi-link.tgz -C /data .
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
