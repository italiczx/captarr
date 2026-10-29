# Captarr

A single container for SABnzbd, Sonarr, and Radarr. It runs on a Synology NAS, or any other host that can reach those apps.

The first launch opens a setup wizard. You create a username and password, then connect each app with its host URL and API key. Any app can be skipped and added later in Settings. API keys stay on the server. The browser only gets a login session.

The image is published to Docker Hub as [`jamesangier/captarr`](https://hub.docker.com/r/jamesangier/captarr).

## Run it

```bash
docker run -d --name captarr \
  -p 8787:8787 \
  -v /volume1/docker/captarr:/data \
  --restart unless-stopped \
  jamesangier/captarr:latest
```

Or with Compose:

```yaml
services:
  captarr:
    image: jamesangier/captarr:latest
    ports:
      - "8787:8787"
    environment:
      PUID: "1026"
      PGID: "100"
    volumes:
      - /volume1/docker/captarr:/data
    restart: unless-stopped
```

Open `http://<nas-ip>:8787`.

On Synology, set `PUID` and `PGID` to the user that should own the data folder. The config, including the password hash and API keys, is stored in that folder as `config.json`.

`latest` tracks the `main` branch. Version tags such as `1.2.0` are published when a `v1.2.0` tag is pushed. Images are built for `linux/amd64` and `linux/arm64`.

## What you can do

- **Dashboard** — SABnzbd speed, queue, time left, disk free, and download totals, plus series and movie counts and recent imports from Sonarr and Radarr.
- **SABnzbd** — queue progress, pause, resume, remove, and history.
- **Sonarr / Radarr** — browse the library, search, add, and remove a title with or without deleting files. A show or movie can start an automatic search or a manual search of indexer releases. On a show, a season can be searched on its own, and a downloaded episode file can be deleted.
- **Settings** — change the password or reconnect an app.

Host URLs need a scheme, for example `http://192.168.1.10:8989` or `http://192.168.1.10:8080/sabnzbd`. Use the address this container can reach, which may be different from the address you use in a browser.

Connections to your apps allow private LAN certificates. Finish setup before you expose the port beyond your network. Put HTTPS in front of it if it is reachable from outside.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listen port inside the container |
| `DATA_DIR` | `/data` | Where `config.json` is stored |
| `PUID` / `PGID` | `0` | Drop to this user after fixing `/data` ownership. Leave unset to keep running as root |
| `COOKIE_SECURE` | unset | Set to `1` when Captarr is served over HTTPS |
| `TRUST_PROXY` | unset | Set to `1` behind a reverse proxy so login limits use the client address |

## Develop

Node 22 or newer.

```bash
npm ci
npm test
npm run dev
```

The dev server is Vite with `/api` proxied to the API on port 8787.

To build the image locally:

```bash
docker compose up -d --build
```

## Publishing

[`.github/workflows/docker.yml`](.github/workflows/docker.yml) builds the image on every push and pull request. Pushes to `main`, and version tags, are pushed to Docker Hub as `jamesangier/captarr`.

The image is pushed to the `jamesangier` Docker Hub account. Add a personal access token from that account as the repository secret `DOCKERHUB_TOKEN` (Settings → Secrets and variables → Actions) before the first push to `main`. Create the token under Docker Hub → Account settings → Personal access tokens, with read and write access.
