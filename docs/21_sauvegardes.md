# Sauvegardes et restauration (phase 6, lot 6c — décision G3-a)

Sauvegarde **chaque nuit à 2 h** (heure de Dakar) par GitHub Actions, **chiffrée** (AES-256), de la base et des fichiers, conservée **30 jours**. La restauration est **essayée automatiquement chaque dimanche** dans un Supabase vide, avec vérification des comptages. Aucune offre payante Supabase.

## Contenu d’une sauvegarde

Un fichier `sauvegarde-AAAA-MM-JJ-HHMM.tar.gz.gpg` (artefact du dépôt privé, onglet **Actions → Sauvegarde**), qui contient :

| Élément | Fichier |
|---|---|
| Données (métier et comptes : utilisateurs, identités, doubles authentifications) | `donnees.sql` |
| Migrations du dépôt (le **schéma** est reconstruit en les rejouant) | `migrations/` |
| Fichiers de Storage (contrats, devis, factures, pièces) et leur manifeste (taille, type, empreinte SHA-256) | `fichiers/`, `fichiers/manifeste-fichiers.json` |
| Tâches planifiées (pg_cron) et migrations appliquées, pour information | `taches-planifiees.json`, `migrations-appliquees.txt` |
| Nombre de lignes par table, avant et après la copie (vérification de la restauration) | `comptages-avant.json`, `comptages-apres.json` |
| Versions d’Auth et de Storage du projet | `versions/` |

Le schéma n’est pas copié par `pg_dump` : il est reconstruit à la restauration en rejouant les migrations incluses dans l’archive (schéma toujours cohérent avec le code, et compatible avec le pooler). Non sauvegardés (à recréer après une restauration, voir plus bas) : secrets du coffre (Vault), secrets et code des fonctions Supabase, réglages d’Auth (adresses de redirection), variables Cloudflare.

## Mise en service (une seule fois, par l’administrateur)

Dans GitHub : **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Valeur |
|---|---|
| `SAUVEGARDE_PHRASE` | Phrase de chiffrement **longue** (au moins 6 mots au hasard). **À conserver aussi hors de GitHub** (gestionnaire de mots de passe, papier au coffre) : sans elle, aucune sauvegarde n’est lisible. |
| `SAUVEGARDE_DB_URL` | Tableau de bord Supabase → **Connect** → **Session pooler** : adresse `postgresql://postgres.hzgkhtaefpbqztwagwph:[MOT-DE-PASSE]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`, mot de passe de la base compris |
| `SAUVEGARDE_SERVICE_ROLE_KEY` | Tableau de bord Supabase → **Project Settings → API Keys → Legacy API Keys** : clé `service_role` (lecture des fichiers) |

Puis **Actions → Sauvegarde → Run workflow** pour un premier essai (sauvegarde et restauration d’essai). Un échec de la sauvegarde nocturne déclenche un e-mail de GitHub au propriétaire du dépôt.

## Ouvrir une sauvegarde sur un ordinateur

1. Onglet **Actions → Sauvegarde**, choisir l’exécution, télécharger l’artefact (fichier `.zip` contenant le `.gpg`).
2. Dans **Git Bash** (installé avec Git pour Windows) :
   ```
   gpg --decrypt sauvegarde-AAAA-MM-JJ-HHMM.tar.gz.gpg > sauvegarde.tar.gz
   tar -xzf sauvegarde.tar.gz
   ```
   La phrase de chiffrement est demandée. Le dossier `sauvegarde/` contient des données personnelles : le supprimer après usage.

## Restaurer (perte ou corruption de la base de production)

La restauration se fait toujours dans un **nouveau projet Supabase vide** ; les scripts refusent le projet de production.

1. Créer un projet Supabase (même région, même version de PostgreSQL 17), noter son mot de passe de base.
2. Ajouter les secrets du projet cible : `RESTAURATION_DB_URL` (Session pooler du nouveau projet), `RESTAURATION_SUPABASE_URL` (`https://<ref>.supabase.co`), `RESTAURATION_SERVICE_ROLE_KEY`.
3. **Actions → Restauration → Run workflow** : numéro de l’exécution « Sauvegarde » (dans l’adresse de sa page) et nom de l’artefact. Le journal se termine par « Restauration vérifiée » et la liste des migrations appliquées.
4. Sur un poste, relier le dépôt au nouveau projet et terminer :
   ```
   pnpm exec supabase link --project-ref <ref>
   pnpm exec supabase migration repair --status applied <versions affichées à l’étape 3>
   pnpm exec supabase functions deploy generate-document send-notifications export-report
   pnpm exec supabase secrets set --env-file <fichier de paramètres hors du dépôt>
   ```
5. Recréer les deux secrets du coffre (Vault) de `docs/20_deploiement_notifications.md` ; reporter dans **Authentication → URL Configuration** l’adresse du site et les redirections ; désactiver les inscriptions (comme en production).
6. Mettre à jour l’application : `NEXT_PUBLIC_SUPABASE_URL` dans `wrangler.jsonc`, la clé anon (secret Cloudflare), la clé `service_role` (secret Cloudflare), `PRODUCTION_PROJECT_REF` dans `lib/env.ts` ; redéployer.
7. Vérifier `/api/sante`, une connexion administrateur, un dossier et un document ; consigner l’incident.

## Essai de restauration

- **Chaque dimanche** (et à chaque lancement manuel) : la sauvegarde de la nuit est restaurée dans un Supabase local vide sur le runner GitHub (mêmes versions d’Auth et de Storage), puis le nombre de lignes de chaque table est comparé aux comptages de la sauvegarde ; chaque fichier est renvoyé et relu (empreinte SHA-256). Le runner est détruit à la fin.
- **À chaque PR** : même chaîne (scripts identiques) sur la base fictive du dépôt, avec un fichier fictif (CI, job « Sauvegarde chiffrée et essai de restauration »).

## Limites

- Espace des artefacts GitHub (offre gratuite, dépôt privé) : 500 Mo. Taille actuelle d’une sauvegarde : moins de 1 Mo ; à surveiller quand les documents s’accumuleront (30 sauvegardes conservées).
- Perte maximale de données : une journée (pas de restauration à l’instant précis sans offre payante Supabase).
