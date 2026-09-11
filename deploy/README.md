# VPS deployment

Slice runs as a long-lived Node process on the VPS. PostgreSQL stays local to
the VPS and is exposed only on loopback. Nginx is the public HTTPS boundary;
the API process listens on its own port and is not exposed directly.

The production service is deliberately isolated:

- application directory: `/home/ubuntu/slice`
- systemd unit: `slice-api.service`
- API port: `28787`
- database: PostgreSQL database `slice`, role `slice`
- Nginx site: a dedicated Slice hostname

Install the checked-in unit and Nginx template only after replacing the
hostname placeholder with the chosen public hostname. Keep the root `.env`
on the server; it contains the delegated executor key and is never committed.
The server must contain `EXECUTOR_PRIVATE_KEY` only. It must not contain a
user wallet key.

Vercel hosts the static frontend separately. Set its `VITE_API_URL` to the
public HTTPS URL for this API.
