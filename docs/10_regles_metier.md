# Règles métier

Traduction opérationnelle du contrat de prestation révisé et du cahier des charges v1.1 (§6, §7, §11). Les valeurs entre `{}` sont des clés de la table `settings` (voir `specs/parametres_contractuels.json`). Chaque règle doit être implémentée dans un module pur et testable (`lib/rules/*.ts`) avec tests unitaires couvrant les cas limites listés.

## R1. Devise et conversion (contrat art. 8)

- Tous les montants sont en USD, stockés en centimes entiers. **Le montant USD fait foi.**
- Conversion : `xof = round_half_up(usd × taux)` au **FCFA entier le plus proche** (décision C4). Pas de majoration (`{fx.markup_percent}` = 0, interprétation I1 confirmée).
- **Au devis** : le taux du jour d’émission du devis est figé sur le devis (`fx_rate_id`, valeur, source, date-heure du relevé). Les factures FA et FS issues de ce devis affichent ce même taux « de référence ».
- **Au paiement** : le taux est **réactualisé**. Chaque paiement enregistre le taux du jour du paiement (`payments.fx_rate_id`) et l’équivalent FCFA effectivement reçu. Le solde restant dû est affiché en USD et en FCFA au taux du jour. Le portail et les documents indiquent clairement « montant FCFA indicatif au taux du JJ/MM/AAAA ».
- Un paiement en FCFA est converti en USD au taux du jour du paiement pour l’imputation : `usd_cents = round(xof / taux × 100)`. L’écart éventuel d’arrondi (≤ 1 centime) est absorbé, journalisé.
- Saisie du taux : rôles admin et comptabilité ; champs taux, date-heure du relevé (UTC), source (par défaut `{fx.source}`), auteur. Un taux par jour au minimum les jours ouvrés ; alerte si aucun taux n’est saisi pour le jour d’un paiement. Historique conservé, jamais supprimé.
- Tests : arrondi 0,5 FCFA ; devis à un taux puis paiement à un autre ; paiement partiel en FCFA ; absence de taux du jour.

## R2. Devis forfaitaire (contrat art. 7, annexe C ; devis révisé)

Structure fixe d’un devis :

| Ligne | Contenu visible par le client | Exigible avec |
|---|---|---|
| A | « Coût total d’acquisition du véhicule – forfait » + description des éléments couverts (sans montants détaillés) | Paiement 1 |
| B | « Logistique et transport maritime vers Dakar – forfait » + description | Solde |
| C | Assurance transport : choix `accepted` / `refused` / `pending` + montant | Solde |
| D | Ajustements : frais supplémentaires approuvés, frais de retard, remise (lignes détaillées) | Solde |
| TVA | `{vat.rate_percent}` si applicable | selon document |

- **Phase actuelle — saisie manuelle** (décision C1, `{quote.forfait_mode}` = `manual`) : l’agent en charge de l’opération établit la structure des coûts et calcule les forfaits A et B, puis **saisit les deux montants**. Il peut (facultatif mais recommandé) saisir le détail des coûts internes par poste (enchère, frais plateforme, taxes USA, autres frais d’acquisition, transport terrestre, manutention, mise en conteneur, fret, frais documentaires) ; le système affiche alors, pour information interne, la marge implicite (`forfait − Σ coûts`). Pas d’approbation obligatoire (`{quote.require_approval}` = false) ; l’émission est journalisée.
- **Évolution prévue — calcul assisté** (`{quote.forfait_mode}` = `proposed_with_approval`) : le système proposera `forfait = arrondi(Σ coûts × (1 + marge))` selon des règles de marge et d’arrondi paramétrées, puis exigera une vérification et une approbation avant émission. **Concevoir dès maintenant** les tables et l’interface pour que ce mode s’active par paramètre, sans migration lourde (statut d’approbation, approbateur, montant proposé vs montant retenu). Ne pas développer le moteur de calcul tant que USA CARS ne l’a pas demandé.
- Le détail des coûts et la marge ne sont **jamais** visibles du client, quel que soit le mode.
- Un devis est valable `{quote.validity_hours}` heures après émission. Passé ce délai : statut `expired`, alerte à l’agent ; un nouveau devis doit être émis (nouveau numéro).
- Un forfait accepté n’est **jamais recalculé**. Seules s’ajoutent en ligne D : les frais supplémentaires (R7) et les frais de retard (R5).
- Le choix d’assurance est **obligatoire** avant l’émission de la facture de solde (pas avant le paiement 1).

## R3. Documents financiers et numérotation

- Types : `quote` (DV), `deposit_invoice` (FA, ligne A), `balance_invoice` (FS, lignes B + C si acceptée + D), `cash_receipt` (RC), `refund_note` (RB, remboursement).
- Numérotation continue par type et par année, sans trou, attribuée **au moment de l’émission** (pas au brouillon), via une séquence transactionnelle. Un document émis n’est jamais modifié ni supprimé : on l’annule (statut `cancelled`, motif) et on en émet un nouveau.
- Chaque document émis génère un fichier (Word puis PDF) stocké dans un bucket privé, accessible par lien signé temporaire.

## R4. Échéances de paiement (contrat art. 9)

- **Dépôt** (décision C2, interprétation I2 confirmée) : avant l’enchère, montant = **forfait A estimé** à partir de l’enchère maximale de l’ordre d’achat (saisi par l’agent). Lot non remporté → dépôt intégralement restitué (R6).
- **Paiement 1** : montant = **totalité du forfait A** (décision C2), diminué du dépôt imputé. Si le dépôt dépasse le forfait A réel, l’excédent est restitué (R6). `due_at = lot_won_notified_at + {payment1.due_hours_after_win}` heures.
- **Solde** : à l’émission de la facture de solde, on fige `reference_eta` = ETA du conteneur à cette date. `due_at = reference_eta − {balance.due_hours_before_eta}` heures.
- Si l’ETA est **avancée** après l’envoi de la facture de solde : `due_at = max(nouvelle_eta − 48 h, notification_at + {balance.min_hours_after_eta_advance_notice} h)`. Journaliser l’ancienne et la nouvelle échéance ; notifier le client.
- Si l’ETA est **retardée** : `due_at` inchangée (sauf action manuelle autorisée, journalisée).
- Rappels de solde à J-`{balance.reminder_days_before_due}` (7, 3, 2) si solde > 0.
- Cas limites à tester : ETA avancée plusieurs fois ; ETA dans le passé à l’émission ; paiement partiel ; solde nul.

## R5. Frais de retard (contrat art. 20)

- `periodes = ceil(jours_de_retard / {late_fee.period_days})` avec `jours_de_retard = date_courante − due_at` (en jours, > 0).
- `frais = min(periodes × {late_fee.amount_usd}, {late_fee.cap_usd} si défini)`.
- Les frais s’arrêtent de courir au paiement intégral de l’échéance concernée.
- Si `{late_fee.auto_apply}` = false : le système propose la ligne D, la comptabilité l’approuve.
- Tests : retard de 1 jour → 1 période ; 14 jours → 1 ; 15 jours → 2 ; plafond atteint.

## R6. Paiements

- Modes : virement, Wave, Orange Money, espèces (reçu RC). Champs obligatoires : montant USD, date de crédit effectif, mode, référence, compte officiel crédité, justificatif (sauf espèces : reçu généré), validateur.
- Les paiements partiels sont autorisés ; le solde est recalculé à chaque enregistrement.
- Un paiement est imputé d’abord sur le paiement 1, puis sur le solde, sauf choix explicite.
- **Trop-perçu : restitué au client** (décision C6). Le système détecte tout excédent (paiements > montant dû, dépôt > forfait A réel, dépôt d’un lot non remporté, annulation avec sommes récupérables) et crée une **demande de remboursement** : montant USD (et FCFA au taux du jour), mode (par défaut celui du paiement d’origine), bénéficiaire, motif. Validation par un administrateur, puis enregistrement de l’exécution (date, référence, justificatif) et génération d’un document `RB-AAAA-####`. Délai cible `{refund.business_days}` jours ouvrés (alerte au-delà). Un remboursement ne peut pas dépasser l’excédent constaté.
- Comptes officiels : table dédiée, modifiable uniquement par un administrateur, avec double validation (une seconde personne admin approuve) et journalisation.

## R7. Frais supplémentaires hors forfait (contrat art. 26)

- Toute ligne D de type `extra_cost` exige un justificatif.
- Si montant > `{extra_costs.approval_threshold_usd}` **ou** > `{extra_costs.approval_threshold_percent}` % du forfait concerné : statut `pending_client_approval`, le client accepte ou refuse dans le portail (ou l’agent enregistre son accord écrit). Exception « urgence » (stockage, port, transporteur) : ajout direct avec notification immédiate, motif obligatoire.

## R8. Ordre d’achat et enchère (contrat art. 5, 6, annexe B)

- Un ordre d’achat signé est requis avant de passer le dossier au statut « Enchère en cours ».
- Champs : plateforme, lot, VIN, enchère maximale (USD), dépôt, confirmations du client (4 cases de l’annexe B), date-heure de signature.
- Contrôle de l’âge : `année_courante − année_modèle > {import.max_age_years_*}` selon la catégorie → alerte bloquante (dérogation admin possible, motivée, journalisée).
- Un prix d’adjudication saisi > enchère maximale → alerte et validation admin obligatoire.

## R9. Remise des documents et propriété (contrat art. 11, 15)

- Bouton « Remettre les documents » désactivé tant que le solde total du dossier > 0.
- Remise : bénéficiaire (client ou mandataire), pièce d’identité vérifiée, procuration téléversée si mandataire, décharge signée téléversée. Délai cible `{documents.release_business_hours}` heures ouvrées après paiement intégral (alerte si dépassé).
- Au paiement intégral : `ownership_transferred_at` = date du paiement.

## R10. Arrivée, enlèvement, réclamations (contrat art. 17–19)

- Saisie de l’ATA → notification client attendue sous `{arrival.notify_within_hours}` h ; alerte si non envoyée.
- Enlèvement attendu `{pickup.days_after_documents}` jours après la remise des documents ; alerte ensuite.
- Réclamation : à saisir dans les `{claim.business_days_after_pickup}` jours ouvrés après l’enlèvement (réserves, photos). Au-delà : saisie possible avec mention « hors délai ».

## R11. Véhicule non réclamé (contrat art. 21–22)

- À partir de l’ATA, si solde > 0 ou véhicule non enlevé : relance à J+`{unclaimed.reminder_days_after_arrival}`, mise en demeure à J+`{unclaimed.formal_notice_days_after_arrival}` (délai de régularisation ≥ `{unclaimed.formal_notice_min_cure_days}` jours), alerte « procédure possible » à `{unclaimed.procedure_months_after_arrival}` mois.
- Le système **ne change jamais automatiquement la propriété** ni ne déclenche de vente : il produit les courriers (modèles) et les alertes ; toute action est manuelle et journalisée.

## R12. Tracking (cahier des charges §5)

- Lien de suivi construit depuis le transporteur : `url_template` avec `{ref}` si disponible, sinon `tracking_url` + affichage de la référence à saisir.
- Lien de type `tiers` : affiché avec la mention « service de suivi tiers ».
- Chaque événement porte sa source : `manual`, `api`, `carrier_link`. Les saisies manuelles sont visuellement distinguées.
- Alerte si conteneur en transit et dernière vérification > `{tracking.max_days_without_check_in_transit}` jours.

## R13. Changements d’étape

Voir `13_workflow_statuts.md`. Toute exception à une condition de passage est réservée à l’administrateur, avec motif obligatoire journalisé.

## R14. Contrat par véhicule (décision B1)

- Chaque dossier (un véhicule) a **son propre contrat** ; un client qui achète 5 véhicules a 5 dossiers, 5 contrats, 5 ordres d’achat.
- Le contrat est généré à l’ouverture du dossier à partir du modèle (fiche véhicule en annexe A), avec la référence du dossier.
- Pour faciliter la saisie d’un client professionnel, proposer « Dupliquer le dossier » (copie client, plateforme, responsable ; jamais les montants ni les documents signés).

## R15. Acceptation et signature des documents (décision D3)

Trois méthodes, au choix, pour le contrat, l’ordre d’achat, le devis (avec le choix d’assurance) et l’approbation des frais supplémentaires :

| Méthode | Preuve enregistrée |
|---|---|
| Papier signé et scanné | Fichier téléversé (PDF/photo), date de signature, agent qui l’a reçu |
| Validation par WhatsApp | Message reçu depuis le numéro de notification du client : capture ou export du message téléversé, date-heure, numéro émetteur ; si l’API WhatsApp le permet, réponse à un message modèle avec boutons « J’accepte / Je refuse » enregistrée automatiquement |
| Acceptation dans le portail | Case de consentement + bouton, horodatage, identifiant de session, adresse IP, version exacte du document affiché |

- Une acceptation porte toujours sur une **version figée** du document (numéro + empreinte du fichier).
- Le choix d’assurance doit figurer dans la même acceptation que le devis.

## R16. Connexion client et notifications (décisions E1–E3)

- Le client reçoit son accès **par e-mail et par WhatsApp** dès la première version (solution technique pour WhatsApp à valider, interprétation I3).
- Les liens et codes de connexion sont à usage unique et expirent rapidement (15 minutes par défaut).
- Toutes les notifications partent sur les deux canaux s’ils sont renseignés ; échec d’un canal → journalisé, l’autre canal reste valable.
- Les messages WhatsApp utilisent des **modèles approuvés** par le fournisseur ; aucun message ne contient de coordonnées de paiement modifiées.
