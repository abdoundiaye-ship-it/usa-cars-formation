# User stories et critères d’acceptation

Identifiants `US-<phase>.<n>`. Chaque critère doit être couvert par un test (unitaire, RLS ou Playwright).

## Phase 1 — Socle (authentification, rôles, paramètres, audit)

**US-1.0 Compte administrateur initial** — Au premier déploiement, un script crée un compte administrateur avec accès complet à partir de la variable `ADMIN_EMAIL` (mot de passe défini par lien d’invitation).
- Le script est idempotent (relancé, il ne crée pas de doublon) ; aucune adresse ni mot de passe dans le dépôt.

**US-1.1 Connexion interne** — En tant qu’utilisateur interne, je me connecte avec e-mail et mot de passe + double authentification.
- Un compte désactivé ne peut pas se connecter.
- La MFA est exigée pour admin et comptabilité (clarification A4).

**US-1.2 Gestion des utilisateurs** — En tant qu’administrateur, je crée un utilisateur et lui attribue un rôle.
- Le changement de rôle est journalisé (avant/après).

**US-1.3 Paramètres contractuels** — En tant qu’administrateur, je consulte et modifie les paramètres de `settings`.
- Les valeurs `a_confirmer` sont signalées visuellement.
- Une modification crée une nouvelle version datée (`effective_from`) ; l’ancienne reste consultable.

**US-1.4 Journal d’audit** — En tant qu’administrateur ou direction, je consulte et filtre l’audit.
- Les autres rôles n’y ont pas accès (test RLS).

## Phase 2 — Opérations (clients, contrats, ordres d’achat, dossiers, conteneurs, documents)

**US-2.1 Fiche client** — Créer et modifier un client (personne ou société) avec coordonnées de notification.
- Le téléphone de notification est au format international (+221…).

**US-2.2 Contrat par véhicule** — À l’ouverture d’un dossier, générer son contrat (un contrat par véhicule, décision B1) et enregistrer son acceptation selon l’une des 3 méthodes (R15).
- Impossible de rattacher un même contrat à deux dossiers.
- « Dupliquer le dossier » copie le client et la plateforme, jamais les montants ni les documents signés.

**US-2.3 Ordre d’achat** — Saisir un ordre d’achat (annexe B) pour un dossier.
- Impossible de passer à « Enchère en cours » sans ordre d’achat signé et les 4 confirmations cochées.
- Un véhicule trop âgé selon `import.max_age_years_*` déclenche une alerte bloquante ; seul l’admin peut déroger avec motif.

**US-2.4 Résultat d’enchère** — Enregistrer le lot remporté et le prix d’adjudication.
- Prix > enchère max → validation admin obligatoire.
- `lot_won_notified_at` est enregistré et l’échéance du paiement 1 est calculée (R4).

**US-2.5 Étapes et statuts** — Changer de statut dans l’étape ; passer à l’étape suivante si les conditions de `13_workflow_statuts.md` sont remplies.
- Les conditions manquantes sont listées ; l’exception admin exige un motif journalisé.

**US-2.6 Conteneurs** — Créer un conteneur (numéro ISO 6346, transporteur, B/L, navire, voyage, ports, ETD, ETA), y associer des dossiers.
- Le lien de suivi est construit depuis la configuration du transporteur ; mention « service tiers » pour Grimaldi.

**US-2.7 ETA et événements** — Modifier l’ETA (historique conservé, source), ajouter un événement, saisir départ et ATA, marquer « vérifié aujourd’hui ».
- Une modification d’ETA sur un dossier dont la facture de solde est émise déclenche le recalcul R4.

**US-2.8 Documents** — Téléverser des documents par dossier (type, version), basculer la visibilité client.
- Stockage privé ; accès par lien signé expirant.

**US-2.9 Tableau de bord opérationnel** — Liste « À traiter » et indicateurs (sans montants pour `ops` si la direction le décide).

## Phase 3 — Finances (forfaits, devis, factures, paiements, taux, retards)

**US-3.1 Coûts internes (facultatif)** — En tant qu’agent en charge de l’opération, je peux saisir la structure des coûts par poste (sections A et B), estimés ou définitifs, avec justificatif ; la marge implicite s’affiche pour information interne.
- Invisibles pour `client` (test RLS).

**US-3.2 Saisie des forfaits** — En tant qu’agent, je saisis les montants des forfaits A et B que j’ai calculés (décision C1, mode `manual`).
- La saisie et toute modification avant émission sont journalisées.
- Le modèle de données prévoit le futur mode `proposed_with_approval` (montant proposé, approbateur) sans l’activer.

**US-3.3 Devis** — Émettre un devis DV numéroté, avec taux de change figé, validité `quote.validity_hours`.
- Le document généré ne contient que A, B, C, D et la TVA ; aucun coût interne (test sur le fichier généré).
- Passé la validité, statut `expired` et alerte.

**US-3.4 Dépôt et facture d’acompte** — Avant l’enchère, enregistrer le dépôt (= forfait A estimé sur l’enchère max, interprétation I2 confirmée). Après l’adjudication, émettre FA pour la **totalité du forfait A**, dépôt imputé ; échéance R4.
- Dépôt > forfait A réel ou lot non remporté → demande de remboursement créée (US-3.12).

**US-3.5 Taux de change** — Saisir le taux du jour (source XE.com, date-heure) ; historique. Le devis fige le taux du jour de son émission (repris sur FA/FS) ; chaque paiement enregistre le taux réactualisé du jour du paiement ; montants FCFA arrondis à l’unité la plus proche.
- Alerte si un paiement est saisi un jour sans taux enregistré.

**US-3.6 Paiements** — Enregistrer un paiement (mode, compte officiel, référence, date de crédit, justificatif) ; reçu RC pour les espèces.
- Solde recalculé ; paiement partiel accepté ; paiement en FCFA converti au taux du jour ; trop-perçu → demande de remboursement automatique (US-3.12).
- Paiement 1 soldé → statut « Confirmé » proposé.

**US-3.7 Facture de solde** — Émettre FS (B + C si acceptée + D) après embarquement ; `reference_eta` figée ; échéance R4.
- Émission impossible tant que le choix d’assurance est `pending`.

**US-3.8 Frais de retard** — Calcul R5 proposé quotidiennement ; ajout en ligne D après validation (si `late_fee.auto_apply` = false).

**US-3.9 Frais supplémentaires** — Ajouter une ligne D `extra_cost` avec justificatif ; au-delà du seuil R7, approbation client requise sauf urgence motivée.

**US-3.10 Comptes officiels** — Créer / modifier un compte officiel ; activation après approbation d’un second administrateur.

**US-3.12 Remboursement du trop-perçu** — Le système crée une demande de remboursement pour tout excédent ; un administrateur l’approuve ; l’exécution (date, mode, référence, justificatif) génère un document RB.
- Montant remboursé ≤ excédent constaté ; alerte au-delà de `refund.business_days`.

**US-3.11 Remise des documents** — Enregistrer la remise (bénéficiaire, pièce, procuration, décharge) ; bouton inactif si solde > 0 ; `ownership_transferred_at` renseigné au paiement intégral.

## Phase 4 — Portail client et notifications

**US-4.1 Accès client** — Le client reçoit son lien (ou code) de connexion **par e-mail et par WhatsApp** (décision E1, solution technique I3) et ne voit que ses dossiers (tests d’accès croisé).
- Lien ou code à usage unique, expiration 15 minutes.

**US-4.2 Acceptation du devis** — Le devis peut être accepté de **trois façons** (décision D3, R15) : dans le portail (case + bouton, horodatage, IP, version), par WhatsApp (preuve enregistrée par l’agent ou réponse à un modèle à boutons), ou papier signé scanné (téléversé par l’agent). Le choix d’assurance est obligatoire dans la même acceptation.

**US-4.3 Suivi** — Le client voit étapes, chronologie visible, suivi maritime (ETA indicative, ATA, lien de suivi), montants en USD et FCFA, échéances, documents visibles.

**US-4.4 Approbation des frais supplémentaires** — Le client approuve ou refuse une ligne D en attente.

**US-4.5 Notifications** — **E-mail et WhatsApp dès la première version** (décision E1–E3), via des fournisseurs réels (E2, E3), pour : lot remporté, devis émis, rappel d’échéance (J-7/J-3/J-2), départ, ETA modifiée, arrivée (sous 24 h, alerte sinon), documents prêts, relance, mise en demeure.
- Journal avec statut, erreur et renvoi ; aucun message ne contient de coordonnées de paiement modifiées.

## Phase 5 — Tracking et recouvrement

**US-5.1 Liens de suivi** — Maersk (référence dans le lien), MSC et Grimaldi (référence à saisir), configurables.
**US-5.2 Alerte de vérification** — Alerte si conteneur en transit non vérifié depuis `tracking.max_days_without_check_in_transit` jours.
**US-5.3 Véhicule non réclamé** — Compte à rebours R11, génération des courriers de relance et de mise en demeure, aucune action automatique sur la propriété.
**US-5.4 Connecteur API** (si accès obtenu, F2) — Adaptateur par transporteur, gestion des erreurs et limites d’appels, événements marqués `api`.

## Phase 6 — Rapports et mise en production

**US-6.1 Rapports** — Dossiers actifs, retards, créances par client, délais moyens achat → Dakar, marge par véhicule (direction), exports CSV/Excel selon droits.
**US-6.2 Production** — Sauvegardes vérifiées (restauration testée), revue des accès, tests de sécurité, documentation utilisateur, formation.

**US-6.3 Réclamations après l’enlèvement** (contrat art. 19) — Après l’enlèvement du véhicule, l’agent ou le client dépose une réclamation (réserves, photos facultatives) dans le délai `claim.business_days_after_pickup` jours ouvrés ; au-delà elle est marquée « hors délai » (recours contre les tiers compromis). USA CARS la traite (transmise, résolue ou rejetée) avec une réponse ; le client en suit l’avancement dans son espace et reçoit la notification `claim_update`.
