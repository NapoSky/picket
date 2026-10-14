# Reprise après sinistre

Objectif : remettre PICKET en service après la perte du serveur ou de sa base.

À récupérer : un dossier de sauvegarde chiffrée, son identité privée `age`, `.env`,
les secrets et l'image immuable correspondant au snapshot (également indiquée
dans son `manifest.txt`). Une sauvegarde perdue avec le disque est irrécupérable.

## 1. Préparer l'hôte

Installer Docker/Compose et docker-rollout comme dans [Installation](./install).
Avec le compte de déploiement, remettre `deploy/`, `.env` et `secrets/`, créer le dossier des backups et y déposer
le snapshot récupéré. Lancer `./init-secrets.sh` pour ajouter les secrets manquants.

## 2. Mettre à jour les adresses si le serveur change

Actualiser le DNS Cloudflare et les secrets de déploiement GitHub (`DEPLOY_HOST`,
`DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`).

## 3. Restaurer la base

Depuis `deploy/`, avec le bot arrêté et une base vide :

```sh
docker compose stop picket picket-stats backup
./restore.sh restore ../backups/<dossier-snapshot> /chemin/vers/identite-age-privee
```

Le script vérifie le checksum, démarre PostgreSQL, restaure l'archive et vérifie
les propriétaires et l'isolation des serveurs. Il refuse une base non vide et
ne démarre pas le bot. Prendre en compte les demandes d'effacement intervenues
depuis le snapshot avant réouverture. Garder la clé hors des services permanents.

## 4. Relancer

```sh
./rollout.sh ghcr.io/<owner>/picket@sha256:<digest-compatible-avec-le-snapshot>
```

Mettre ensuite à jour normalement si nécessaire. L'historique vocal repart à
zéro ; la base ne restaure ni messages Discord, ni cases cochées des todolists,
ni écritures postérieures au snapshot.

## 5. Vérifier

Contrôler `docker compose ps`, une commande Discord, le dashboard stats, une
nouvelle sauvegarde avec `./backup.sh daily` et une notification Discord de test
si le monitoring est activé.

## Exercice mensuel

```sh
./restore.sh verify ../backups/<dossier-snapshot> /chemin/vers/identite-age-privee
```

Le script restaure dans une base temporaire isolée, la vérifie, la supprime et
enregistre le succès. Il ne connecte jamais un second bot au Discord de production.
