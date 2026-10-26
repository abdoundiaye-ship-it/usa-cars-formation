#!/usr/bin/env bash
# Essai de restauration (décision G3-a) : démarre un Supabase local VIDE (projet temporaire, sans migrations) et y
# restaure l'archive avec scripts/restauration.sh, vérification des comptages comprise. Exécuté sur un runner
# GitHub Actions : chaque nuit du dimanche pour la sauvegarde de production, à chaque PR avec une base fictive.
# Le Supabase local du dépôt doit être arrêté (mêmes ports).
#
# Usage : scripts/essai-restauration.sh <archive.tar.gz.gpg>   (SAUVEGARDE_PHRASE dans l'environnement)
set -euo pipefail

archive="$(realpath "${1:?Usage : scripts/essai-restauration.sh <archive.tar.gz.gpg>}")"
: "${SAUVEGARDE_PHRASE:?}"
repo="$(pwd)"
supabase="$repo/node_modules/.bin/supabase"
scratch="$(mktemp -d)"

cleanup() { (cd "$scratch" && "$supabase" stop --no-backup > /dev/null 2>&1) || true; rm -rf "$scratch"; }
trap cleanup EXIT

echo "→ Supabase local vide (projet temporaire)"
# Versions d'Auth et de Storage du projet sauvegardé (versions/ de l'archive) : les tables auth.* et storage.*
# restaurées doivent avoir les mêmes colonnes.
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$archive" 3<<<"$SAUVEGARDE_PHRASE" \
  | tar -xzf - -C "$scratch" sauvegarde/versions
(
  cd "$scratch"
  "$supabase" init --force > /dev/null
  mkdir -p supabase/.temp
  for f in gotrue-version storage-version; do
    [[ -s "sauvegarde/versions/$f" ]] && cp "sauvegarde/versions/$f" "supabase/.temp/$f"
  done
  sed -i 's/^project_id = .*/project_id = "essai-restauration"/' supabase/config.toml
  # Même version majeure de PostgreSQL que le projet (supabase/config.toml du dépôt).
  major="$(sed -n 's/^major_version = \([0-9]*\)$/\1/p' "$repo/supabase/config.toml")"
  sed -i "s/^major_version = .*/major_version = $major/" supabase/config.toml
  "$supabase" start -x studio,imgproxy,realtime,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit > /dev/null
)

status="$(cd "$scratch" && "$supabase" status -o env)"
value() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" <<<"$status" | head -n 1; }
SUPABASE_DB_URL="$(value DB_URL)"
SUPABASE_URL="$(value API_URL)"
SUPABASE_SERVICE_ROLE_KEY="$(value SERVICE_ROLE_KEY)"
[[ -n "$SUPABASE_SERVICE_ROLE_KEY" ]] || SUPABASE_SERVICE_ROLE_KEY="$(value SECRET_KEY)"
export SUPABASE_DB_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY

bash scripts/restauration.sh "$archive"
