# CLAUDE.md — USA CARS · Système de gestion et de tracking

Instructions permanentes pour Claude Code sur ce projet. À lire avant toute tâche.

## 1. Contexte

USA CARS (Dakar, Sénégal) achète des véhicules aux enchères aux États-Unis (COPART, IAA) pour le compte de clients et les expédie par conteneur jusqu’au port de Dakar. L’application gère chaque dossier de bout en bout : client → contrat → ordre d’achat → enchère → devis forfaitaire → paiement 1 → transport terrestre USA → conteneur → transport maritime → arrivée à Dakar → solde → remise des documents → enlèvement → clôture, avec un portail client.

Sources de vérité, par ordre de priorité :
1. `docs/00_points_de_clarification.md` — décisions prises par USA CARS (une réponse écrite là remplace tout le reste).
2. `docs/10_regles_metier.md` + `specs/parametres_contractuels.json` — règles du contrat traduites en paramètres.
3. `docs/sources/02_contrat_prestation_revise.md` — contrat de prestation (40 articles, annexes A à D).
4. `docs/sources/03_devis_facture_revise.md` — modèle de devis / facture.
5. `docs/sources/01_cahier_des_charges_v1.1.md` — cahier des charges fonctionnel.
6. `reference/prototype/usa-cars-prototype.html` — prototype cliquable (référence UX uniquement, données fictives, pas de code à réutiliser tel quel).

En cas de contradiction entre ces sources, **ne choisis pas seul** : signale-la et pose la question.

## 2. Environnement fourni par USA CARS

- **Dépôt GitHub** : https://github.com/abdoundiaye-ship-it/USA-CARS-SYST-ME-DE-GESTION-ET-DE-TRACKING (privé). GitHub Actions pour la CI.
- **Hébergement de l’application** : voir interprétation I5 (par défaut : déploiement Vercel connecté au dépôt GitHub ; à confirmer avant le premier déploiement).
- **Supabase = PRODUCTION** : projet `hzgkhtaefpbqztwagwph` (URL API : `https://hzgkhtaefpbqztwagwph.supabase.co`). Les clés (`anon`, `service_role`) et le mot de passe de la base sont fournis par USA CARS dans `.env.local` / les secrets de l’hébergeur et de GitHub Actions — **jamais dans le dépôt, jamais dans un message de commit, jamais dans les logs**.
- Règles de sécurité liées à la production :
  - développer et tester **uniquement** sur Supabase local (CLI, `supabase start`) ;
  - **interdit sur le projet de production** : `supabase db reset`, chargement du seed de démonstration, tests automatisés, suppression de données ;
  - pousser une migration en production (`supabase link` puis `supabase db push`) seulement après validation de la phase par USA CARS, **après une sauvegarde**, et en annonçant la commande avant de l’exécuter ;
  - migrations uniquement additives ou réversibles ; pas de modification manuelle du schéma dans le tableau de bord.
- **Compte administrateur initial** : `abdou.ndiaye@icloud.com`, via la variable `ADMIN_EMAIL`, créé par un script idempotent (invitation par e-mail). Les autres utilisateurs sont créés par l’administrateur dans l’application.

## 3. Stack imposée (sauf décision contraire dans le fichier de clarifications)

- Next.js (App Router) + TypeScript strict, React Server Components par défaut.
- Supabase : PostgreSQL, Auth, Storage (buckets privés), Row Level Security (RLS) sur **toutes** les tables exposées.
- Tailwind CSS ; composants accessibles (shadcn/ui accepté).
- Validation : Zod côté serveur pour toute entrée.
- Génération documentaire : modèles `.docx` remplis côté serveur (docxtemplater ou équivalent), export PDF dans une seconde étape.
- Tests : Vitest (unitaires, règles métier) + Playwright (parcours) + tests de politiques RLS (pgTAP ou scripts SQL).
- Migrations SQL versionnées dans `supabase/migrations/`. Point de départ : `specs/schema_initial.sql` (proposition à revoir, pas un contrat).

## 4. Règles non négociables

1. **Argent** : tous les montants sont stockés en **USD, en centimes entiers** (`bigint`). Jamais de `float`. Le FCFA est calculé avec le taux enregistré (`fx_rates`) et arrondi au **FCFA entier le plus proche** : taux du jour d’émission du **devis**, **réactualisé au jour de chaque paiement** (R1).
2. **Forfaits** : en phase actuelle, l’agent **saisit manuellement** les montants des forfaits A et B (R2) ; le calcul automatique viendra plus tard, avec approbation. Le client voit uniquement les forfaits A (acquisition) et B (logistique + maritime), l’option C (assurance) et les ajustements D. **Les coûts internes et la marge ne sont jamais renvoyés au rôle `client`** — ni dans l’UI, ni dans une API, ni dans un document généré. Ceci doit être garanti par RLS, pas seulement par l’interface.
3. **Isolation client** : un client ne lit que ses propres dossiers, documents autorisés (`visible_client = true`), paiements, notifications et tracking. Tester explicitement l’accès croisé entre deux clients.
4. **Paramètres** : aucune valeur contractuelle (délais, montants, seuils) en dur dans le code. Tout passe par la table `settings` initialisée depuis `specs/parametres_contractuels.json`. Les valeurs `status: "a_confirmer"` sont des valeurs par défaut provisoires.
5. **Audit** : toute création/modification d’un dossier, paiement, taux, paramètre, compte officiel, document ou droit d’accès écrit une ligne dans `audit_log` (utilisateur, rôle, action, objet, avant/après pertinent, horodatage).
6. **ETA** : toujours affichée comme « indicative » tant que l’ATA n’est pas saisie. Jamais de carte GPS ou de langage laissant croire à une position en temps réel.
7. **Comptes officiels** : seuls les administrateurs modifient les comptes de paiement officiels, avec double validation. Aucune notification ne contient de coordonnées de paiement nouvelles ou modifiées.
8. **Données de démonstration** : toute donnée de seed est fictive et identifiable (références `DEMO-`, conteneurs `DEMU`, e-mails `@exemple.test`). Ne jamais importer de données réelles sans instruction explicite.
9. **Secrets** : jamais de clé dans le dépôt. `.env.example` documente les variables. La clé `service_role` Supabase n’est utilisée que dans du code serveur.
10. **Intégrations externes** : e-mail et WhatsApp sont **réels dès la phase 4** (décision E1–E3), via des adaptateurs interchangeables ; avant la phase 4 ou sans identifiants fournis, utiliser l’implémentation « simulée » qui journalise. API transporteurs et API XE : pas avant la phase prévue.
11. **Un contrat par véhicule** : un dossier = un véhicule = un contrat = un ordre d’achat (R14).
12. **Trop-perçu** : toujours restitué au client via une demande de remboursement approuvée (R6), jamais conservé comme avoir.

## 5. Langue et conventions

- Interface, messages, documents générés : **français**. Dates `JJ/MM/AAAA`, fuseau `Africa/Dakar` (UTC+0), montants `12 450 $US` / `7 302 000 FCFA`.
- Code, noms de tables et de colonnes : anglais, `snake_case` en SQL, `camelCase` en TypeScript.
- Vocabulaire métier dans l’UI : dossier, ordre d’achat, devis, facture d’acompte, facture de solde, forfait, solde, ETA, ATA, B/L, conteneur, transporteur, remise des documents, enlèvement.
- Libellés d’action explicites (« Enregistrer le paiement », pas « Valider »).

## 6. Méthode de travail attendue

- Travailler **phase par phase** selon `docs/17_plan_phases.md`. Ne pas commencer une phase sans que ses points de clarification bloquants soient répondus (voir colonne « Bloque » dans `docs/00_points_de_clarification.md`). Pour les points non bloquants, appliquer l’hypothèse par défaut indiquée et la lister dans le compte rendu.
- Au début de chaque phase : proposer un plan court (fichiers, migrations, tests) et attendre validation.
- À la fin de chaque phase : migrations appliquées, seed fictif à jour, tests verts, compte rendu listant ce qui est fait, les hypothèses prises et les écarts.
- Petits commits thématiques, messages en français à l’impératif.
- Quand une règle métier est ambiguë : **s’arrêter et poser la question**, citer l’article du contrat ou la section du cahier des charges concernés.

## 7. Définition de « terminé » (toute user story)

- Critères d’acceptation de `docs/15_user_stories.md` couverts par au moins un test.
- RLS vérifiée pour chaque rôle concerné (y compris un test « accès refusé »).
- Écriture dans `audit_log` pour les actions sensibles.
- Écran utilisable à 400 px de large ; états vides, chargement et erreurs gérés.
- Aucun texte en dur contenant une valeur contractuelle.

## 8. Commandes (à créer en phase 0)

```
pnpm dev            # serveur local
pnpm test           # Vitest
pnpm test:e2e       # Playwright
pnpm db:reset       # supabase db reset + seed fictif
pnpm lint && pnpm typecheck
```
