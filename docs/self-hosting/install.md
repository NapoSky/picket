# Installation

::: warning License
PICKET is licensed under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0).
Running it for your own community, regiment or association is allowed; selling it, or offering it as a paid service, is
not. This is a source-available license, not an OSI-approved open source one. Foxhole and its content belong to Siege
Camp and are not covered by this license; PICKET is not affiliated with Siege Camp. See the `LICENSE` and `NOTICE` files.
:::

PICKET runs as a single container image in several identical replicas, backed by PostgreSQL. The `deploy/` directory
contains everything needed for a Docker Compose host behind Traefik.

## Requirements

- A Linux host with Docker and Docker Compose v2.
- The [docker-rollout](https://github.com/wowu/docker-rollout) plugin, used for zero-downtime updates.
- Traefik with the Docker provider, on a Docker network the PICKET container can join.
- A public host name pointing to Traefik, served over HTTPS.

## 1. Create the Discord application

In the [Developer Portal](https://discord.com/developers/applications), create an application and note its
**Application ID** and **Public Key**. Create the bot and copy its token. Do not enable any privileged intent: PICKET
does not need them.

## 2. Prepare the host

Copy the `deploy/` directory to the server, then:

```sh
./init-secrets.sh                 # generates the database passwords and connection strings in ./secrets
read -rsp 'Bot token: ' TOKEN && printf '%s' "$TOKEN" > secrets/discord_bot_token; unset TOKEN   # keeps it out of the shell history
cp .env.example .env              # then edit it: image, host name, Discord identifiers, Traefik names
docker compose up -d --wait postgres
```

The `secrets/` directory is never committed. Secrets reach the containers as files (`*_FILE` variables), not as
environment variables.

## 3. First start

```sh
./rollout.sh ghcr.io/<owner>/picket@sha256:<digest>
```

The script pulls the image, applies the database migrations, replaces the replicas one by one, then registers the slash
commands (only if their definition changed).

Finally, in the Developer Portal, set **Interactions Endpoint URL** to `https://<your host>/interactions`. Discord sends a
signed request to check it: the endpoint must answer, so complete this step once PICKET is running.

## 4. Schedule the cleanup

Data of servers that removed the bot is erased after the retention period. Run the cleanup daily:

```sh
0 4 * * * cd /opt/picket/deploy && docker compose run --rm purge
```

## Behind Cloudflare

Use a dedicated host name for the interactions endpoint. Make sure **no challenge, bot protection or WAF rule** answers
`POST /interactions`: Discord must reach PICKET with the request body unchanged, otherwise the signature check fails
and Discord refuses the endpoint.

## Updates from GitHub Actions

The repository ships a workflow that builds the image, pushes it to GitHub Container Registry and rolls it out over SSH.

1. Create a dedicated key pair and allow it on the server with a **forced command**, in `~/.ssh/authorized_keys`:

   ```text
   command="/opt/picket/deploy/ssh-entrypoint.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA… picket-deploy
   ```

   The key can do nothing but deploy an image referenced by its digest (`ghcr.io/<owner>/<image>@sha256:…`).

2. Create a GitHub environment named `production`, with required reviewers if you want a manual approval, and add the
   secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` (the server's pinned host key, so the
   connection never trusts an unknown host).
3. Nothing to configure for the registry: the workflow sends the job's temporary token (read access to packages) to the
   server, which uses it for the pull and logs out right after. No personal token is ever stored on the server. For a
   manual `./rollout.sh`, make the package public or run `docker login ghcr.io` yourself first.

The deployment only runs after the CI succeeded on `main`, never from a pull request.

## How updates stay invisible

- Database changes are additive; the previous and the new version run together during the switch.
- A replica being stopped first reports itself as not ready, so Traefik stops sending it requests, then finishes the
  work in progress.
- The Discord gateway connection is held by one replica at a time. When it stops, it hands the session over and the next
  replica resumes it without reconnecting from scratch.

## Operating

- Logs are JSON on the standard output, with the server identifier on every line and no secret.
- `/healthz` and `/readyz` listen on an internal port that Traefik does not route.
- Back up the database with `pg_dump` every day and test a restore. Everything PICKET knows is in PostgreSQL.
