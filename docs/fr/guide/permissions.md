# Permissions

PICKET utilise deux niveaux que vous rattachez à des rôles, plus un niveau administrateur implicite.

| Niveau | Destiné à | Exemples |
| --- | --- | --- |
| `member` (membre) | Les utilisateurs courants du bot | Consulter l'état, (bientôt) ajouter un timer ou une todolist |
| `officer` (officier) | Les personnes qui gèrent le bot | (bientôt) créer des boards, configurer le war-log |
| administrateur | Propriétaire et détenteurs de la permission Administrateur | Gérer les permissions, supprimer les données du serveur |

Un officier est aussi un membre. Un administrateur est aussi un officier.

## Comment le niveau est déterminé

La première règle qui correspond l'emporte, et elle est évaluée **à chaque utilisation** d'une commande (boutons
compris), pas au moment où quelque chose a été créé.

1. La personne a la permission Discord **Administrateur** (le propriétaire du serveur en fait partie) : administrateur.
2. La personne a un rôle de la liste officier : officier.
3. La personne a un rôle de la liste membre, ou la liste membre contient `@everyone` : membre.
4. Sinon l'accès est refusé, et le message indique le niveau requis.

Si Discord ne fournit pas les permissions de la personne, l'accès est refusé : PICKET n'autorise jamais par défaut.

## Bon à savoir

- **Sans rôle officier** configuré, seuls les administrateurs peuvent utiliser les commandes d'officier.
  `/picket permissions show` vous en avertit.
- `@everyone` ne peut pas être officier.
- Si vous supprimez un rôle dans Discord, PICKET le retire seul des niveaux et le consigne dans le journal d'audit.
- Les permissions de commandes propres à Discord (Paramètres du serveur → Intégrations) s'appliquent en premier. PICKET ne
  peut pas autoriser ce que Discord interdit déjà.
