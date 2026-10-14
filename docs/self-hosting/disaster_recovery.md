# Disaster recovery

Purpose: restore PICKET after losing the server or its database.

Have ready: an encrypted backup directory, its private `age` identity, `.env`,
deployment secrets and the immutable image used for that snapshot (also recorded
in its `manifest.txt`). A backup lost with the disk cannot be recovered.

## 1. Prepare the host

Install Docker/Compose and docker-rollout as in [Installation](./install).
As the deployment user, restore `deploy/`, `.env` and `secrets/`, create the backup directory and place the
recovered snapshot there. Run `./init-secrets.sh` to add missing secrets.

## 2. Update addresses if the server changed

Update Cloudflare DNS and the GitHub deployment secrets (`DEPLOY_HOST`,
`DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`).

## 3. Restore the database

From `deploy/`, with the bot stopped and an empty database:

```sh
docker compose stop picket picket-stats backup
./restore.sh restore ../backups/<snapshot-directory> /path/to/private-age-identity
```

The script verifies the checksum, starts PostgreSQL, restores the archive and
checks ownership and tenant isolation. It refuses a non-empty database and does
not start the bot. Review deletion requests made since the snapshot before
reopening the service. Keep the private identity outside permanent services.

## 4. Restart

```sh
./rollout.sh ghcr.io/<owner>/picket@sha256:<snapshot-compatible-digest>
```

Then upgrade normally if necessary. Voice history starts fresh; database backups
do not restore Discord messages, checked todo items or writes after the snapshot.

## 5. Verify

Check `docker compose ps`, a Discord command, the stats dashboard, a new backup
with `./backup.sh daily`, and a test Discord alert if monitoring is enabled.

## Monthly exercise

```sh
./restore.sh verify ../backups/<snapshot-directory> /path/to/private-age-identity
```

This restores into a temporary isolated database, checks it, removes it and
records success. It never connects a second bot to production Discord.
