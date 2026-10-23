# node:alpine e' multi-arch (amd64 + arm64) — funziona su Raspberry Pi 5 senza modifiche
FROM node:22-alpine

WORKDIR /app
COPY server.js ./

# Cartella dei giochi caricati: dell'utente "node", così il volume condiviso è scrivibile
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production DATA_DIR=/data PORT=3000
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
