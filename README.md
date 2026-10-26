# USA CARS — Package de développement pour Claude Code

Version du 17 octobre 2026 — **mise à jour avec les décisions de USA CARS** (comptes GitHub/Supabase, administrateur initial, contrat par véhicule, forfaits saisis manuellement, taux du devis réactualisé au paiement, trop-perçu remboursé, 3 modes de signature, connexion et notifications par e-mail et WhatsApp dès la V1). Basé sur : cahier des charges v1.1, contrat de prestation révisé (40 articles, annexes A à D), devis / facture client révisé (forfaits), prototype interactif.

## Mode d’emploi

1. Confirmer l’interprétation I5 (hébergement) et relire I3 et I4 dans `docs/00_points_de_clarification.md` ; répondre aux questions ouvertes au fil des phases (fournisseurs e-mail et WhatsApp avant la phase 4).
2. Cloner le dépôt https://github.com/abdoundiaye-ship-it/USA-CARS-SYST-ME-DE-GESTION-ET-DE-TRACKING (privé) et y copier le contenu de ce dossier ; ajouter `.env.local` au `.gitignore`.
3. Ouvrir Claude Code dans ce dépôt et coller le message de `KICKOFF_PROMPT.md`.
4. Valider le plan de chaque phase avant que Claude Code ne code ; répondre aux nouvelles questions dans `docs/00_points_de_clarification.md`.

## Contenu

| Chemin                               | Rôle                                                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                          | Instructions permanentes lues par Claude Code : contexte, stack, règles non négociables, méthode, définition de « terminé »                                                        |
| `KICKOFF_PROMPT.md`                  | Premier message à envoyer à Claude Code                                                                                                                                            |
| `docs/00_points_de_clarification.md` | Questions à trancher avant / pendant le développement, avec hypothèses par défaut                                                                                                  |
| `docs/10_regles_metier.md`           | Règles R1 à R13 : devise et taux, forfaits, numérotation, échéances, frais de retard, paiements, frais supplémentaires, ordre d’achat, remise des documents, non réclamé, tracking |
| `docs/12_roles_permissions.md`       | Matrice des droits par rôle et tests RLS obligatoires                                                                                                                              |
| `docs/13_workflow_statuts.md`        | Étapes, statuts et conditions de passage (avec diagramme)                                                                                                                          |
| `docs/14_ecrans_ux.md`               | Écrans internes et portail client                                                                                                                                                  |
| `docs/15_user_stories.md`            | User stories par phase avec critères d’acceptation                                                                                                                                 |
| `docs/16_documents_generes.md`       | Documents produits (contrat, ordre d’achat, DV, FA, FS, reçus, décharges) et champs                                                                                                |
| `docs/17_plan_phases.md`             | Phases 0 à 6, dépendances et validations                                                                                                                                           |
| `docs/sources/`                      | Les trois documents de référence convertis en Markdown                                                                                                                             |
| `specs/parametres_contractuels.json` | Paramètres initiaux (délais, montants, seuils, transporteurs, numérotation), avec statut confirmé / à confirmer                                                                    |
| `specs/schema_initial.sql`           | Proposition de schéma PostgreSQL/Supabase (27 tables dont remboursements et acceptations, RLS de principe) — chargée sans erreur sur PostgreSQL 16                                 |
| `reference/templates/`               | Les trois documents Word révisés (modèles de génération)                                                                                                                           |
| `reference/prototype/`               | Prototype cliquable (données fictives)                                                                                                                                             |

## Points d’attention

- Les valeurs surlignées dans le contrat sont reprises comme paramètres « à confirmer » : le développement peut avancer, mais elles doivent être validées avant la production.
- Le prototype date d’avant le passage au devis forfaitaire : ses coûts détaillés correspondent aux coûts internes, que le client ne doit jamais voir.
- Le lien de suivi Grimaldi passe par un service tiers (TrackingMCP) ; à remplacer par le lien officiel dès qu’il est connu.
- Les modèles Word du contrat (art. 6 et 8) et du devis doivent être alignés sur les décisions C2/I2 (dépôt = forfait A estimé sur l’enchère maximale, régularisé après l’adjudication) et C4/I1 (taux du devis réactualisé au paiement, sans majoration).

## Développement

Prérequis : Node.js 24 (`.nvmrc`), pnpm 10, **Docker Desktop** (pour Supabase local).

```bash
pnpm install
pnpm db:start        # démarre Supabase LOCAL (Docker)
pnpm db:env          # écrit .env.local avec les clés locales
pnpm db:reset        # applique les migrations + seed fictif (local uniquement)
pnpm dev             # http://localhost:3000
```

| Commande | Rôle |
|---|---|
| `pnpm lint` · `pnpm typecheck` · `pnpm format` | Qualité du code |
| `pnpm test` | Tests unitaires (Vitest) — règles métier dans `lib/` |
| `pnpm test:db` | Tests de base de données (pgTAP, `supabase/tests/`) |
| `pnpm test:e2e` | Parcours (Playwright, desktop et 400 px) |
| `pnpm db:types` | Types générés depuis la base locale, dans `supabase/.temp/` : référence pour mettre à jour `lib/supabase/database.types.ts` (tenu à la main) |
| `pnpm settings:generate` | Régénère la migration des paramètres initiaux depuis `specs/parametres_contractuels.json` |
| `pnpm admin:create` | Compte administrateur initial (`ADMIN_EMAIL`), idempotent — local par défaut ; `--lien` affiche un lien d’accès à usage unique (sans e-mail) |

**Production** (`hzgkhtaefpbqztwagwph`) : jamais de `db reset`, de seed ni de tests. Les clés de production se saisissent
uniquement dans l’hébergeur — pas dans `.env.local`. Garde-fous : l’application refuse de démarrer sur l’URL de
production si `NEXT_PUBLIC_APP_ENV` ≠ `production`, et `db:reset`, `test:db`, `test:e2e` refusent de s’exécuter si
une variable ou un fichier `.env*` pointe vers la production.

Structure : `app/` (Next.js App Router), `lib/` (règles pures, montants, clients Supabase), `supabase/` (migrations,
seed fictif, tests pgTAP), `scripts/`, `tests/` (unitaires, e2e), `.github/workflows/ci.yml` (CI).

### Comptes de démonstration (local)

Après `pnpm db:reset` : `admin@exemple.test`, `ops@exemple.test`, `compta@exemple.test`, `direction@exemple.test`,
`client@exemple.test` — mot de passe `DemoUsaCars2026`. L’administrateur configure la double authentification
(TOTP) à la première connexion. La comptabilité et la direction (MFA exigée, décisions A4 et A4-bis) ont déjà un facteur de démonstration :
ajoutez le secret `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` à une application d’authentification. Les e-mails d’invitation locaux arrivent dans Mailpit (http://127.0.0.1:54324).

### Authentification en production (à faire dans le tableau de bord Supabase, avant la mise en service)

- Authentication → URL Configuration : `Site URL` = URL de l’application ; ajouter `<URL>/auth/confirm` aux redirections.
- Authentication → Email Templates : reprendre `supabase/templates/invitation.html` et `reinitialisation.html`.
  **Impossible sur l’offre gratuite sans SMTP personnalisé** (constaté le 19/10/2026) : d’ici là, donner l’accès par
  lien à copier (écran Utilisateurs, ou `pnpm admin:create --production --lien` pour l’administrateur initial).
- Authentication → Providers → Email : inscriptions publiques désactivées ; mot de passe 12 caractères minimum.
- Authentication → Multi-Factor : TOTP activé.
- SMTP personnalisé (fournisseur d’e-mail, question E2) : le service d’envoi intégré de Supabase est limité et
  réservé aux membres de l’équipe du projet.
