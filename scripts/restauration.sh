#!/usr/bin/env bash
# Restauration d'une sauvegarde chiffrée (décision G3-a, docs/21_sauvegardes.md) dans un projet Supabase VIDE
# (nouveau projet, ou Supabase local de l'essai de restauration) : schéma reconstruit en rejouant les migrations de
# l'archive, puis données, fichiers, et vérification des comptages. Jamais sur le projet de production.
#
# Usage : scripts/restauration.sh <archive.tar.gz.gpg>
# Variables : SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY du projet CIBLE ; SAUVEGARDE_PHRASE.
# Outils : psql, gpg, tar, pnpm install déjà fait.
set -euo pipefail

archive="${1:?Usage : scripts/restauration.sh <archive.tar.gz.gpg>}"
: "${SUPABASE_DB_URL:?}" "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}" "${SAUVEGARDE_PHRASE:?}"
PSQL="${PSQL:-psql}"

production_ref="$(sed -n 's/^export const PRODUCTION_PROJECT_REF = "\(.*\)";$/\1/p' lib/env.ts)"
if [[ -z "$production_ref" || "$SUPABASE_DB_URL$SUPABASE_URL" == *"$production_ref"* ]]; then
  echo "⛔ Restauration refusée sur le projet de production : restaurer dans un nouveau projet (docs/21)." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "→ Déchiffrement"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt \
  --output "$work/sauvegarde.tar.gz" "$archive" 3<<<"$SAUVEGARDE_PHRASE"
tar -xzf "$work/sauvegarde.tar.gz" -C "$work"
dir="$work/sauvegarde"

echo "→ Schéma : rejeu des migrations (crée aussi les extensions, le compartiment et les tâches pg_cron)"
# Déclencheurs désactivés pendant le rejeu : les insertions de référence (paramètres…) ne doivent pas générer de
# lignes d'audit ou d'événements, sinon les comptages ne correspondraient plus à la production.
for f in "$dir"/migrations/*.sql; do
  "$PSQL" "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 -c "SET session_replication_role = replica" -f "$f" > /dev/null
done

echo "→ Données (déclencheurs désactivés le temps du chargement)"
"$PSQL" "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET session_replication_role = replica" -f "$dir/donnees.sql" > /dev/null

echo "→ Fichiers (Storage)"
pnpm exec tsx scripts/restauration-fichiers.ts "$dir/fichiers"

echo "→ Vérification des comptages"
"$PSQL" "$SUPABASE_DB_URL" -X -At -v ON_ERROR_STOP=1 -f scripts/sql/comptages.sql > "$work/comptages-restaures.json"
pnpm exec tsx scripts/verifier-restauration.ts \
  "$dir/comptages-avant.json" "$dir/comptages-apres.json" "$work/comptages-restaures.json"

echo "Migrations rejouées ; sur un nouveau projet, les marquer « applied » (supabase migration repair) :"
cat "$dir/migrations-appliquees.txt"
