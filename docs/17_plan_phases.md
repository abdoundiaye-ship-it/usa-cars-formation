# Plan de réalisation par phases

Chaque phase se termine par une démonstration à USA CARS sur des données fictives et un compte rendu (fait, hypothèses prises, écarts, questions). Ne pas démarrer une phase dont les clarifications bloquantes (colonne « Bloque » de `00_points_de_clarification.md`) sont sans réponse.

| Phase | Contenu | User stories | Clarifications bloquantes | Validation |
|---|---|---|---|---|
| 0. Initialisation | Dépôt https://github.com/abdoundiaye-ship-it/USA-CARS-SYST-ME-DE-GESTION-ET-DE-TRACKING, Next.js + TypeScript, Supabase local (CLI), lien vers le projet de **production** `hzgkhtaefpbqztwagwph` sans y pousser de données de test, CI GitHub Actions (lint, typecheck, tests), `.env.example`, seed fictif minimal (local), commandes `pnpm` | — | I5 (avant le premier déploiement seulement) | Application vide déployée ; CI verte |
| 1. Socle | Compte administrateur initial (`ADMIN_EMAIL`), écran de gestion des utilisateurs et des rôles, Auth + MFA, `settings` chargés depuis `specs/parametres_contractuels.json`, `audit_log`, RLS de base et tests d’isolation | US-1.x | A4, B3 | Tests RLS verts ; l’admin crée un utilisateur |
| 2. Opérations | Clients, contrat par véhicule, ordres d’achat et dépôt, dossiers et workflow, acceptations (scan et WhatsApp enregistrés par l’agent), conteneurs, ETA, événements, documents, tableau de bord | US-2.x | A7, B4, B5 | Un dossier fictif traité de l’ouverture à l’arrivée |
| 3. Finances | Saisie manuelle des forfaits (coûts internes facultatifs), devis/factures, génération Word (puis PDF) avec mention PROJET, taux de change (devis + réactualisation au paiement), paiements USD/FCFA, remboursements, comptes officiels, frais de retard et supplémentaires, remise des documents | US-3.x | I4 confirmée ; C5, C7, C8, C9, D4, D5 | Calculs testés (R1–R7, R9) ; documents générés sans coûts internes |
| 4. Portail et notifications | Portail client, connexion par lien e-mail + WhatsApp, acceptation dans le portail, notifications **e-mail et WhatsApp** via fournisseurs réels | US-4.x | E2, E3 (fournisseurs, compte WhatsApp Business vérifié, modèles approuvés), E5, I3 validée | Test d’isolation entre deux clients ; messages reçus sur les deux canaux |
| 5. Tracking et recouvrement | Liens de suivi configurables, alertes de vérification, procédure véhicule non réclamé, connecteurs API si accès obtenus | US-5.x | F2, F4 (API seulement) | Alertes et courriers générés |
| 6. Rapports et production | Rapports, exports, sauvegardes, revue sécurité, documentation, formation | US-6.x | G1–G3 | Recette signée par USA CARS |

Ordre de priorité si le temps manque : phases 0 → 3 forment le MVP interne ; la phase 4 ouvre le service aux clients.
