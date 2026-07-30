# HTTPS

The board works over plain HTTP on your LAN, and most of it works well that
way. Three features do not, because browsers gate them behind a *secure
context*.

## What needs a secure context

| Feature | Why the browser requires HTTPS |
| --- | --- |
| Push notifications | Service workers and the Web Push API are secure-context only |
| Installing to a home screen (PWA) | The install prompt requires a secure context |
| Camera barcode scanner | `getUserMedia` is secure-context only |

Everything else — the calendar, chores, recipes, meal planning, shopping lists,
photos, wish lists, TV mode, the API — works fine over `http://your-server:3000`.

`localhost` counts as a secure context, but that only helps the machine running
the board. The kitchen tablet reaching it over the LAN does not get the
exemption.

One related setting: when you do serve the board over HTTPS, set
`NUXT_SESSION_COOKIE_SECURE` to `true` so the session cookie is only ever sent
encrypted. It defaults to `false` because LAN deployments are plain HTTP. See
[Configuration](./configuration.md#environment-variables).

## Option 1: the Caddy sidecar

`docker-compose.yml` ships with a commented-out Caddy service. Uncomment it, set
your domain, and uncomment the `caddy-data` volume at the bottom:

```yaml
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    command: caddy reverse-proxy --from board.example.com --to betts-board:3000
    volumes:
      - caddy-data:/data

volumes:
  betts-data:
  caddy-data:
```

Then:

```bash
docker compose up -d
```

Caddy obtains and renews certificates automatically. This needs a real domain
name pointing at the host, and ports 80 and 443 reachable for the ACME
challenge.

## Option 2: an existing reverse proxy

If you already run Traefik, Nginx Proxy Manager, or Caddy in front of other
services, point it at port 3000 and let it terminate TLS. Nothing in the board
needs to know it is behind a proxy.

One exception, and only one: if that proxy is the **sole** route to the
container, you may set `BETTS_TRUSTED_PROXY=1` so the unlock rate limit reads
the client address from the last `X-Forwarded-For` element instead of the
socket. Leave it unset if the container is also reachable directly — the header
is client-writable, and an attacker who can choose their own rate-limit bucket
has no rate limit at all.

## Option 3: Tailscale, with no domain

If you do not have a domain and do not want one,
[Tailscale](https://tailscale.com) gives every device on your tailnet an
HTTPS-capable address with no certificate work:

```bash
tailscale serve --bg 3000
```

Devices on the tailnet reach the board over HTTPS. This is the least
infrastructure of the three, at the cost of the board being reachable only from
the tailnet.

## Verifying it worked

Load the board over `https://` and check the three gated features:

- The browser offers **Add to Home Screen** or an install button.
- **Settings → Notifications** offers *Notify on this device* instead of saying
  push notifications aren't available here.
- The barcode scanner in the pantry opens the camera rather than reporting it is
  unavailable.

On iOS specifically, notifications only work once the board has been added to
the home screen — Safari does not deliver web push to a normal tab.

If any of these still misbehave, see
[Troubleshooting](./troubleshooting.md).
