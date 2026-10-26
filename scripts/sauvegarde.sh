#!/usr/bin/env bash
# Sauvegarde complète et chiffrée (décision G3-a, docs/21_sauvegardes.md) : données (métier + comptes), migrations
# (schéma de restauration), fichiers Storage, comptages des tables avant et après la copie des données.
# Lecture seule sur le projet sauvegardé. Exécutée chaque nuit par GitHub Actions (.github/workflows/sauvegarde.yml).
#
# Le schéma n'est PAS copié par pg_dump : il est reconstruit à la restauration en rejouant les migrations du dépôt
# (incluses dans l'archive). C'est plus fiable (schéma toujours cohérent avec le code) et évite les limites de
# `supabase db dump` avec le pooler Supavisor. pg_dump/psql se connectent au pooler (nom d'utilisateur postgres.<ref>).
#
# Usage : scripts/sauvegarde.sh <archive.tar.gz.gpg>
# Variables : SUPABASE_DB_URL (connexion PostgreSQL via le pooler, mot de passe compris), SUPABASE_URL (API),
#             SUPABASE_SERVICE_ROLE_KEY (lecture des fichiers), SAUVEGARDE_PHRASE (phrase de chiffrement).
# Outils : pg_dump et psql (version ≥ serveur), gpg, tar, curl, pnpm install déjà fait.
set -euo pipefail

archive="${1:?Usage : scripts/sauvegarde.sh <archive.tar.gz.gpg>}"
: "${SUPABASE_DB_URL:?}" "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}" "${SAUVEGARDE_PHRASE:?}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PSQL="${PSQL:-psql}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
dir="$work/sauvegarde"
mkdir -p "$dir/versions"

query() { "$PSQL" "$SUPABASE_DB_URL" -X -At -v ON_ERROR_STOP=1 -f "$1"; }

echo "→ Comptage des tables (avant)"
query scripts/sql/comptages.sql > "$dir/comptages-avant.json"

# Données : tables métier (public) et comptes (auth : utilisateurs, identités, facteurs 2FA). INSERT avec
# ON CONFLICT DO NOTHING : à la restauration, les lignes créées par les migrations (paramètres, référentiels) sont
# conservées et les données réelles ajoutées, sans conflit de clé.
echo "→ Copie des données (public + comptes)"
# Tables sélectionnées par motif : dès qu'un --table est donné, pg_dump ignore --schema, d'où `public.*` (toutes les
# tables de public) explicitement, en plus des tables de comptes.
"$PG_DUMP" "$SUPABASE_DB_URL" --data-only --no-owner --inserts --on-conflict-do-nothing \
  --table='public.*' --table='auth.users' --table='auth.identities' --table='auth.mfa_factors' \
  -f "$dir/donnees.sql"

echo "→ Comptage des tables (après), tâches planifiées, migrations appliquées"
query scripts/sql/comptages.sql > "$dir/comptages-apres.json"
query scripts/sql/taches-planifiees.sql > "$dir/taches-planifiees.json"
query scripts/sql/migrations-appliquees.sql > "$dir/migrations-appliquees.txt"

echo "→ Migrations (schéma de restauration) et versions d'Auth/Storage"
cp -r supabase/migrations "$dir/migrations"
curl -sf "$SUPABASE_URL/auth/v1/health" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' > "$dir/versions/gotrue-version"
storage_version="$(curl -sf "$SUPABASE_URL/storage/v1/version" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY")"
echo "v${storage_version#v}" > "$dir/versions/storage-version"

echo "→ Copie des fichiers (Storage)"
pnpm exec tsx scripts/sauvegarde-fichiers.ts "$dir/fichiers"

echo "→ Archive chiffrée (AES-256)"
tar -czf "$work/sauvegarde.tar.gz" -C "$work" sauvegarde
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 \
  --output "$archive" "$work/sauvegarde.tar.gz" 3<<<"$SAUVEGARDE_PHRASE"
echo "✅ Sauvegarde écrite : $archive ($(du -h "$archive" | cut -f1))"
