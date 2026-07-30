# HTTPS and remote access

Betts Board works over plain HTTP on your LAN, but browsers reserve a few
platform features for **secure contexts**. Until the board is served over
HTTPS, these three stay off:

- **Push notifications** — event reminders and chore nudges
- **Installing to a phone home screen** (PWA install)
- **The camera barcode scanner** for the pantry

Everything else — calendar, chores, recipes, meal plans, shopping lists,
the TV dashboard — is fully usable over `http://your-server:3000`. Pick one
of the three paths below when you want the full set.

## Option 1: the Caddy sidecar

The shipped [docker-compose.yml](../../docker-compose.yml) contains a
commented-out `caddy` service. Uncomment it — along with the `caddy-data`
volume at the bottom of the file — and set your domain:

```yaml
caddy:
  image: caddy:2
  restart: unless-stopped
  ports: ["80:80", "443:443"]
  command: caddy reverse-proxy --from board.example.com --to betts-board:3000
  volumes:
    - caddy-data:/data
```

Point your domain's DNS at the box, make sure ports 80 and 443 reach it,
and run `docker compose up -d`. Caddy obtains and renews certificates
automatically; there is nothing to configure beyond the domain in `--from`.

## Option 2: your existing reverse proxy

Already running Traefik, Nginx Proxy Manager, or Caddy for other services?
Point it at port `3000` of the Betts Board container, the same way you
proxy anything else on your network.

## Option 3: Tailscale (no domain needed)

If you don't own a domain — or don't want the board reachable from the
public internet at all — [Tailscale](https://tailscale.com) gives every
device on your tailnet a secure, HTTPS-capable address with zero
certificate fuss. On the machine running Betts Board:

```bash
tailscale serve --bg 3000
```

The board is then available at that machine's `https://…ts.net` address
from every device signed in to your tailnet, phones included. This doubles
as remote access when you're away from home.

## Verify it worked

Open the board at its new HTTPS address and check:

1. The browser shows the padlock with no certificate warning.
2. On a phone, **Add to Home Screen** installs the board as an app.
3. The pantry's barcode scanner can open the camera.
4. Notifications can be enabled under **Settings**, and the browser asks
   for notification permission.

If any of these still refuse, see [Troubleshooting](./troubleshooting.md).
