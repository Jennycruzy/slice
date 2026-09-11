# Server deployment

Slice runs as one long-lived Node process on the server. PostgreSQL stays on
the same machine and listens only on loopback. Nginx is the public HTTPS
boundary: it serves the built web app and forwards API paths to the process,
which is never exposed directly.

Layout:

- application directory: `/home/ubuntu/slice`
- systemd unit: `slice-api.service`
- API port: `28787` (loopback only)
- database: PostgreSQL database `slice`, role `slice`
- web build: `/var/www/slice`
- Nginx site: one dedicated Slice hostname

## Web app

The web app and the API share one origin, so the browser needs no
`VITE_API_URL`. After a frontend change:

```sh
npm run build --workspace @slice/web
sudo rsync -a --delete apps/web/dist/ /var/www/slice/
```

Nginx serves `/`, `/trade`, `/executions`, `/proof` and `/integrations` from
that directory and forwards `/api`, `/health`, `/r` and `/ccxt` to the API.

## API

Install the checked-in unit and Nginx template after replacing the hostname
placeholder with the public hostname. Keep the root `.env` on the server; it
holds the delegated executor key and is never committed. The server must hold
`EXECUTOR_PRIVATE_KEY` only. It must never hold a user wallet key.

## Hosting the web app elsewhere

The web app is a static build and can also be hosted separately (for example
on Vercel using [`vercel.json`](../vercel.json)). In that case set
`VITE_API_URL` to the public HTTPS URL of this API.
