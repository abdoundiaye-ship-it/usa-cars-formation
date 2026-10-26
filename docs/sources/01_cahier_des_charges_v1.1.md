**USA CARS**

**SYSTÈME DE GESTION ET DE TRACKING**

*Cahier des charges fonctionnel et technique*

Gestion des clients, véhicules, ordres d’achat, devis forfaitaires, paiements,  
logistique USA–Dakar, conteneurs maritimes et suivi des expéditions

Version 1.1 \| Octobre 2026

Révision alignée sur le contrat de prestation de services et le devis / facture client révisés

## Suivi des révisions

| **Version** | **Date**        | **Principales modifications**                                                                                                                                                                                                                                                                                                                      |
|-------------|-----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1.0         | Octobre 2026    | Version initiale (relue : saisie du coût d’acquisition, ajout de MSC).                                                                                                                                                                                                                                                                             |
| 1.1         | 17 octobre 2026 | Alignement sur le contrat révisé (40 articles, annexes A à D) et le devis / facture révisé : ordre d’achat, devis forfaitaire (sections A, B, C, D), échéancier en deux paiements, devise USD et taux XE.com, règles contractuelles paramétrables (section 6), ajout du transporteur Grimaldi, recouvrement, réclamations et données personnelles. |

Les éléments <span class="mark">surlignés en jaune</span> reprennent les valeurs encore à confirmer dans le contrat révisé. Ils doivent être paramétrables et validés avant la mise en production.

# 1. Résumé exécutif

USA CARS souhaite une plateforme web centralisée pour gérer chaque dossier depuis l’ordre d’achat et l’enchère sur COPART/IAA aux États-Unis jusqu’à l’arrivée du navire à Dakar, la remise des documents et la clôture du dossier. Le système réunira les opérations, les documents contractuels, la facturation, les paiements, les notifications et le tracking maritime.

Le système applique les règles du contrat de prestation de services : ordre d’achat avec enchère maximale, devis forfaitaire, paiement en deux temps (acquisition puis solde), devise de référence en USD, frais de retard, remise des documents après paiement intégral et procédure de véhicule non réclamé. Il produit les documents d’exécution du contrat : ordre d’achat, devis, factures d’acompte et de solde, fiche opérationnelle et décharges.

La plateforme comprendra un espace interne et un portail client sécurisé. Chaque client ne pourra consulter que ses propres dossiers. Le suivi maritime fonctionnera d’abord par lien vers la page de suivi de chaque transporteur (Maersk, MSC, Grimaldi), puis par intégration API si l’accès est autorisé.

# 2. Objectifs

- Centraliser les données clients, véhicules, lots, ordres d’achat, conteneurs et expéditions.

- Suivre les étapes opérationnelles et identifier les retards ou dossiers bloqués.

- Établir les forfaits d’acquisition et de logistique à partir des coûts saisis, enregistrer les paiements et visualiser les soldes en USD et en FCFA.

- Générer et archiver contrats, ordres d’achat, devis, factures, preuves de paiement, documents de transport et décharges de remise.

- Appliquer automatiquement les échéances et règles du contrat : paiement 1, solde, frais de retard, remise des documents, véhicule non réclamé.

- Notifier les clients des étapes clés, échéances de paiement et changements de statut ou d’ETA.

- Accéder au tracking des transporteurs sans présenter les données comme une géolocalisation continue si elles ne le permettent pas.

- Conserver un journal d’audit des modifications, validations et opérations financières.

# 3. Modules fonctionnels

| **Module**           | **Fonctions attendues**                                                                                                                                                                                                |
|----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Clients              | Coordonnées, pièce d’identité ou NINEA/RCCM, numéro WhatsApp et e-mail de notification, historique, statut, pièces justificatives.                                                                                     |
| Véhicules            | VIN, marque, modèle, année (contrôle de la limite d’âge à l’importation), kilométrage, statut du titre, clés, photos, lot, plateforme et état déclaré.                                                                 |
| Ordres d’achat       | Mandat d’enchère : plateforme, lot, VIN, enchère maximale autorisée, dépôt, confirmations du client, signature horodatée.                                                                                              |
| Contrats             | Génération à partir du modèle validé (contrat et annexes A à D), validation/signature, versions et archivage.                                                                                                          |
| Devis et facturation | Devis forfaitaire (A acquisition, B logistique et maritime, C assurance en option, D ajustements), facture d’acompte, facture de solde, numérotation par type, paiements partiels, soldes, échéances, conversion FCFA. |
| Taux de change       | Taux USD → XOF relevé sur XE.com (taux moyen du marché), date et heure du relevé, auteur, historique.                                                                                                                  |
| Logistique USA       | Enlèvement, transporteur terrestre, sites, dates, frais internes et preuve de prise en charge.                                                                                                                         |
| Conteneurs           | Numéro, transporteur (Maersk, MSC, Grimaldi, autre), navire, voyage, ports, Bill of Lading et ETA.                                                                                                                     |
| Tracking             | Lien de suivi par transporteur, événements, escales, changements d’ETA, arrivée réelle et date de dernière vérification.                                                                                               |
| Documents            | Contrat signé, ordre d’achat, devis, factures, factures d’enchères, titre, connaissement, preuves de paiement, procurations, décharges et documents de livraison.                                                      |
| Notifications        | E-mail ; WhatsApp en option selon le fournisseur et les autorisations.                                                                                                                                                 |
| Recouvrement         | Frais de retard, relances, mises en demeure et suivi du délai de quatre mois pour véhicule non réclamé.                                                                                                                |
| Réclamations         | Réserves à l’enlèvement, photos, délai de déclaration, transmission aux transporteurs ou assureurs et suivi.                                                                                                           |
| Rapports             | Dossiers actifs, retards, créances, coûts internes et marge par véhicule, délais et rentabilité.                                                                                                                       |

# 4. Parcours opérationnel

1.  Ouverture du dossier client (identité, coordonnées de notification) et signature du contrat de prestation.

2.  Signature de l’ordre d’achat : lot, VIN, enchère maximale autorisée, vérification de l’âge du véhicule ; enregistrement du dépôt éventuel.

3.  Enchère dans la limite autorisée et notification du lot remporté au client.

4.  Saisie du coût d’acquisition (enchère, frais, taxes et autres frais connus) et des coûts logistiques estimés ; établissement interne des forfaits A et B ; émission du devis forfaitaire avec l’option d’assurance, valable <span class="mark">48 heures</span>.

5.  Validation du devis par le client (signature, e-mail ou WhatsApp) et enregistrement de son choix d’assurance.

6.  Émission de la facture d’acompte (section A) et encaissement du paiement 1 dans un délai de <span class="mark">24 heures</span> après la notification du lot remporté.

7.  Enregistrement de l’achat, des documents et des instructions logistiques ; suivi du transport terrestre vers le site de consolidation ou le port américain.

8.  Enregistrement du chargement, association du véhicule au conteneur et saisie du transporteur, du conteneur, du B/L, du navire, du voyage et du lien de suivi.

9.  Émission de la facture de solde (B + C si l’assurance est acceptée + D) mentionnant l’ETA de référence ; échéance fixée à 48 heures avant cette ETA.

10. Mise à jour de l’ETA et des événements ; recalcul de l’échéance si l’ETA est avancée ; notifications au client.

11. Saisie de l’arrivée réelle (ATA) et notification du client dans les 24 heures.

12. Encaissement du solde ; remise des documents sous <span class="mark">48 heures ouvrées</span>, au client ou à son mandataire, contre pièce d’identité et décharge signée.

13. Enregistrement du dédouanement et de l’enlèvement (délai de <span class="mark">15 jours</span>), des réserves éventuelles, puis clôture.

14. À défaut de paiement ou d’enlèvement : frais de retard, relance, mise en demeure et procédure de véhicule non réclamé (section 6).

# 5. Tracking maritime et transporteurs

## 5.1 Première version : lien de suivi par transporteur

Un agent saisit le transporteur, le numéro de conteneur et/ou le numéro de connaissement. Le système construit le lien de suivi à partir de la configuration du transporteur. Le portail client affiche les références et permet d’ouvrir la page de suivi.

| **Transporteur** | **Lien de suivi**                       | **Type**                                  | **Référence**                                        |
|------------------|-----------------------------------------|-------------------------------------------|------------------------------------------------------|
| Maersk           | https://www.maersk.com/tracking/        | Officiel                                  | Insérée dans le lien (modèle …/tracking/{ref})       |
| MSC              | https://www.msc.com/fr/track-a-shipment | Officiel                                  | À saisir sur la page                                 |
| Grimaldi         | https://trackingmcp.com/track/grimaldi  | Service tiers (TrackingMCP), non officiel | À saisir sur la page (conteneur, B/L ou réservation) |

- Configuration extensible : nom, lien, modèle de lien avec {ref} si le site l’accepte, type de lien (officiel ou tiers) et état de l’accès API.

- Signaler au client lorsque le lien passe par un service tiers. <span class="mark">Remplacer le lien Grimaldi par la page officielle du transporteur si elle est disponible.</span>

- Conserver la date de dernière vérification et les notes internes.

- Identifier clairement les statuts et événements saisis manuellement.

## 5.2 Évolution : intégration API

Une intégration automatique ne sera développée qu’après vérification des conditions d’accès, autorisations, droits d’utilisation et couverture des données pour chaque transporteur (portails développeurs Maersk et MSC ; accès Grimaldi à étudier). Le connecteur devra gérer les erreurs, limites d’appels, données manquantes et changements de format.

| **Donnée**                 | **Utilisation**                                                                                   |
|----------------------------|---------------------------------------------------------------------------------------------------|
| Transporteur               | Sélection du connecteur ou du lien de suivi.                                                      |
| Conteneur / Bill of Lading | Références pour identifier l’expédition.                                                          |
| Navire / voyage            | Identification du voyage maritime.                                                                |
| Événements                 | Départ, transbordement, arrivée et événements fournis.                                            |
| ETA / ATA                  | Date estimée et date réelle d’arrivée ; l’ETA de référence sert au calcul de l’échéance du solde. |
| Date et source             | Traçabilité de la mise à jour : API, saisie manuelle, lien officiel ou service tiers.             |

Le tracking ne doit pas être présenté comme une géolocalisation GPS continue. La fréquence et la précision dépendent des données fournies par le transporteur.

# 6. Règles contractuelles à paramétrer

Les règles suivantes proviennent du contrat de prestation révisé. Elles sont paramétrables par l’administrateur, chaque modification étant journalisée, et s’appliquent aux nouveaux dossiers à partir de leur date d’effet.

| **Règle**              | **Valeur contractuelle**                                                                                                                                                                                                 | **Comportement attendu du système**                                                                                                                           | **Contrat** |
|------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|
| Devise                 | USD, qui fait foi ; FCFA indicatif.                                                                                                                                                                                      | Montants stockés en USD ; conversion affichée sur devis, factures et portail.                                                                                 | Art. 8      |
| Taux de change         | Taux moyen du marché XE.com, relevé <span class="mark">à la date d’émission de la facture</span> ; valable jusqu’à l’échéance.                                                                                           | Saisie par la comptabilité ; taux, source, date et heure imprimés sur chaque facture ; historique. <span class="mark">Majoration éventuelle à décider.</span> | Art. 8      |
| Validité du devis      | <span class="mark">48 heures</span>.                                                                                                                                                                                     | Expiration automatique et alerte à l’agent.                                                                                                                   | Art. 7      |
| Dépôt                  | <span class="mark">Montant à définir</span> ; imputé sur le paiement 1 ou restitué sous <span class="mark">5 jours ouvrés</span>.                                                                                        | Enregistrement, imputation et suivi de la restitution.                                                                                                        | Art. 6      |
| Paiement 1             | Section A, <span class="mark">24 heures</span> après la notification du lot remporté.                                                                                                                                    | Calcul de l’échéance et rappel ; alerte en cas de dépassement.                                                                                                | Art. 9.1    |
| Solde                  | 48 h avant l’ETA de l’avis de solde (7 jours recommandés). ETA avancée : au plus tôt 48 h après la notification. ETA retardée : échéance inchangée.                                                                      | Recalcul automatique ; rappels à J-7, J-3 et J-2.                                                                                                             | Art. 9.3    |
| Frais de retard        | 100 USD par période de 14 jours commencée, <span class="mark">plafond à définir</span>.                                                                                                                                  | Calcul automatique en section D ; arrêt au paiement intégral.                                                                                                 | Art. 20     |
| Notification d’arrivée | Sous 24 heures après l’information officielle.                                                                                                                                                                           | Alerte si la notification n’est pas partie 24 h après la saisie de l’ATA.                                                                                     | Art. 17     |
| Remise des documents   | <span class="mark">48 heures ouvrées</span> après paiement intégral ; pièce d’identité ou procuration ; décharge.                                                                                                        | Blocage tant que le solde est positif ; enregistrement de la décharge.                                                                                        | Art. 15     |
| Enlèvement             | <span class="mark">15 jours</span> après la remise des documents.                                                                                                                                                        | Alerte à l’échéance.                                                                                                                                          | Art. 18     |
| Réclamation            | <span class="mark">3 jours ouvrés</span> après l’enlèvement, avec réserves et photos.                                                                                                                                    | Création et suivi de la réclamation.                                                                                                                          | Art. 19     |
| Frais supplémentaires  | Accord préalable au-delà de <span class="mark">250 USD ou 10 % du forfait concerné</span>, sauf urgence.                                                                                                                 | Demande d’accord au client et justificatif obligatoire.                                                                                                       | Art. 26     |
| Véhicule non réclamé   | Relance à <span class="mark">J+30</span>, mise en demeure à <span class="mark">J+60</span> (délai d’au moins <span class="mark">15 jours</span>), procédure à 4 mois après l’arrivée ; aucune appropriation automatique. | Compte à rebours, modèles de lettres, alertes.                                                                                                                | Art. 21–22  |
| Propriété              | Transférée au client au paiement intégral.                                                                                                                                                                               | Statut « propriété transférée » à la date du paiement intégral.                                                                                               | Art. 11     |
| Limite d’âge           | 10 ans (tourisme, utilitaires légers \< 3,5 t) ; 15 ans (camions, transport de personnes) — décret signé le 24 octobre 2025, <span class="mark">publication au Journal officiel à vérifier</span>.                       | Paramètre ; alerte à la saisie de l’ordre d’achat.                                                                                                            | Art. 5      |

# 7. Devis, facturation et paiements

## 7.1 Devis forfaitaire

- **Section A – Coût total d’acquisition du véhicule** : un montant forfaitaire unique. La description cite les éléments couverts (enchère, frais COPART/IAA/vendeur, taxes aux États-Unis, transport terrestre, frais de service) sans les ventiler.

- **Section B – Logistique et transport maritime vers Dakar** : un montant forfaitaire unique (manutention, stockage, mise en conteneur, fret, frais documentaires et de terminal).

- **C – Assurance transport** : seule option soumise au choix du client, acceptée ou refusée avec ses initiales.

- **Section D – Ajustements** : frais supplémentaires justifiés, frais de retard et remise.

- TVA si applicable <span class="mark">(traitement fiscal des forfaits à confirmer avec l’expert-comptable)</span>.

## 7.2 Calcul interne des forfaits

L’agent saisit les coûts connus (enchère, frais, taxes et autres frais) et les coûts logistiques estimés. Le système propose les forfaits A et B (coûts + marge) ; l’agent ou la comptabilité les valide. Le détail des coûts et la marge sont visibles uniquement par l’administration, la comptabilité et la direction, et ne sont jamais affichés au client. Le forfait accepté n’est pas révisé, sauf frais supplémentaires ou frais de retard prévus au contrat.

## 7.3 Documents et numérotation

| **Document**      | **Numérotation** | **Contenu**                                                              |
|-------------------|------------------|--------------------------------------------------------------------------|
| Devis             | DV-AAAA-####     | Sections A, B, C, D, validité, taux de change, choix d’assurance.        |
| Facture d’acompte | FA-AAAA-####     | Section A ; échéance du paiement 1.                                      |
| Facture de solde  | FS-AAAA-####     | Sections B, C (si acceptée) et D ; ETA de référence ; échéance du solde. |

Mentions légales des factures (RCCM, NINEA, TVA) <span class="mark">à confirmer avec l’expert-comptable</span>.

## 7.4 Paiements

- Modes : virement, Wave, Orange Money, espèces au bureau contre reçu.

- Paiements acceptés uniquement sur les comptes officiels de l’annexe D du contrat, avec la référence du dossier.

- Pour chaque paiement : montant, devise, date de crédit effectif, mode, référence, justificatif et validateur.

- Comptes officiels modifiables par l’administrateur seulement, avec double validation et journalisation. Aucune notification ne contient de nouvelles coordonnées de paiement.

# 8. Écrans principaux

| **Écran**          | **Contenu minimum**                                                                                                                |
|--------------------|------------------------------------------------------------------------------------------------------------------------------------|
| Tableau de bord    | Dossiers actifs, conteneurs en transit, échéances (paiement 1, solde), retards, soldes dus, devis expirés, véhicules non réclamés. |
| Liste des dossiers | Référence, client, véhicule, étape, dernière mise à jour, responsable et solde.                                                    |
| Ordre d’achat      | Saisie, enchère maximale, contrôle de l’âge, confirmations du client, signature, dépôt.                                            |
| Fiche véhicule     | Identité, chronologie, forfaits, coûts internes (selon les droits), documents, notes et réclamations.                              |
| Fiche conteneur    | Conteneur, navire, voyage, transporteur, lien de suivi, références, événements, historique de l’ETA.                               |
| Devis et factures  | Génération des devis, factures d’acompte et de solde au format Word/PDF à partir des modèles validés.                              |
| Finances           | Paiements, soldes, échéances, frais de retard, justificatifs et taux de change.                                                    |
| Documents          | Type, dossier, version, date et droits d’accès (interne ou visible par le client).                                                 |
| Portail client     | Ses véhicules, étapes, devis à valider et choix d’assurance, montants en USD et FCFA, paiements, documents autorisés et tracking.  |
| Paramètres         | Transporteurs et liens, taux de change, règles contractuelles (section 6), comptes officiels, utilisateurs.                        |
| Rapports           | Exports Excel/CSV selon les droits.                                                                                                |

# 9. Rôles et autorisations

| **Rôle**         | **Autorisations**                                                                                                                                       |
|------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| Administrateur   | Accès global, configuration, utilisateurs, transporteurs, règles contractuelles, comptes officiels et rapports.                                         |
| Agent opérations | Dossiers, ordres d’achat, étapes logistiques, conteneurs, tracking et documents opérationnels.                                                          |
| Comptabilité     | Coûts internes, forfaits, devis, factures, paiements, soldes, taux de change et rapprochements.                                                         |
| Direction        | Indicateurs, marges et rapports globaux.                                                                                                                |
| Client           | Uniquement ses dossiers : validation des devis, choix d’assurance, paiements, documents autorisés et tracking. Aucun accès au détail interne des coûts. |

Les autorisations doivent être appliquées côté serveur et dans la base de données, pas uniquement en masquant des éléments de l’interface.

# 10. Données principales

| **Entité**            | **Champs principaux**                                                                                                                           |
|-----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| Client                | ID, nom, pièce d’identité ou NINEA/RCCM, téléphone et e-mail de notification, adresse, statut, consentement et date de création.                |
| Ordre d’achat         | ID, client, plateforme, lot, VIN, enchère maximale, dépôt, confirmations, date et heure de signature.                                           |
| Dossier véhicule      | ID, client, contrat, VIN, marque, modèle, année, kilométrage, titre, clés, lot, plateforme, statut, propriété transférée et dates.              |
| Coût interne          | Type de frais, devise, montant, justificatif et auteur (non visible par le client).                                                             |
| Devis / facture       | Type (DV, FA, FS), numéro, forfaits A et B, assurance (choix et montant), ajustements, TVA, taux de change et date de relevé, échéance, statut. |
| Paiement              | Montant, devise, date de crédit, mode, référence, compte officiel, preuve et validateur.                                                        |
| Taux de change        | Taux USD → XOF, source, date et heure du relevé, auteur.                                                                                        |
| Conteneur             | Numéro, transporteur, navire, voyage, ports, départ, ETA, arrivée réelle.                                                                       |
| Expédition            | Dossier, conteneur, Bill of Lading, lien de suivi et son type, événements, source, date de vérification.                                        |
| Document              | Type, dossier, stockage privé, version, date, droits ; décharges et procurations.                                                               |
| Réclamation           | Dossier, date, réserves, photos, statut, transmission et réponse.                                                                               |
| Notification          | Destinataire, canal, modèle, date, statut et erreur éventuelle.                                                                                 |
| Paramètre contractuel | Règle, valeur, date d’effet, auteur.                                                                                                            |
| Journal d’audit       | Utilisateur, action, horodatage, objet et valeurs modifiées pertinentes.                                                                        |

# 11. Règles métier et alertes

- Un changement d’étape exige les informations requises ou une validation autorisée ; toute exception est motivée et journalisée.

- Aucune enchère n’est saisie au-delà de l’enchère maximale de l’ordre d’achat ; un prix d’adjudication supérieur déclenche une alerte.

- Les forfaits acceptés ne sont pas recalculés ; seuls les frais supplémentaires approuvés et les frais de retard s’y ajoutent.

- Autoriser les paiements partiels et recalculer le solde en USD et en FCFA.

- Calculer les échéances, rappels et frais de retard selon les paramètres de la section 6.

- Présenter l’ETA comme indicative jusqu’à confirmation de l’arrivée réelle.

- Bloquer la remise des documents tant que le solde n’est pas réglé.

- Journaliser les notifications, leurs statuts et les tentatives de renvoi.

- Exiger les validations et documents obligatoires avant la clôture.

# 12. Architecture technique recommandée

| **Couche**              | **Option proposée**                                                                                                                                                          |
|-------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Interface               | Application web responsive React / Next.js.                                                                                                                                  |
| Base de données         | PostgreSQL via Supabase.                                                                                                                                                     |
| Authentification        | Comptes nominatifs, récupération sécurisée et rôles.                                                                                                                         |
| Sécurité                | Règles d’accès par ligne, stockage privé et liens signés temporaires.                                                                                                        |
| Génération documentaire | Modèles Word du contrat, de l’ordre d’achat, du devis et des factures ; export PDF.                                                                                          |
| Automatisations         | Tâches planifiées pour échéances, rappels, frais de retard, synchronisation et anomalies.                                                                                    |
| Intégrations            | Connecteurs séparés pour transporteurs (Maersk, MSC, Grimaldi), e-mail et messagerie. Taux XE.com saisi manuellement ; API XE (payante) ou autre source autorisée à étudier. |
| Hébergement             | HTTPS, sauvegardes, surveillance et environnement de test séparé.                                                                                                            |

# 13. Sécurité, données personnelles et continuité

- Principe du moindre privilège et séparation des dossiers par client.

- Authentification renforcée pour les administrateurs et utilisateurs internes.

- Journalisation des changements sensibles, des opérations financières et des modifications de comptes officiels.

- Protection des données personnelles conforme à la loi n° 2008-12 ou au texte qui la remplace ; <span class="mark">formalités auprès de la CDP à vérifier</span> ; information du client et exercice de ses droits.

- Durée de conservation des données alignée sur le contrat (<span class="mark">à définir</span>) et procédure de suppression.

- Sauvegardes régulières et procédure documentée de restauration.

- Chiffrement en transit et contrôle des liens documentaires.

- Tests de sécurité avant mise en production et revue périodique des comptes.

# 14. Plan de réalisation

| **Phase**          | **Livrables**                                                                                                                                           | **Validation**                               |
|--------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------|
| 1\. Cadrage        | Processus, rôles, statuts, modèle de données, paramètres de la section 6 ; validation juridique et comptable des modèles de contrat, devis et factures. | Périmètre et modèles approuvés par USA CARS. |
| 2\. MVP opérations | Clients, ordres d’achat, véhicules, dossiers, étapes, documents et tableau de bord.                                                                     | Dossier test traité de bout en bout.         |
| 3\. Finances       | Forfaits, devis, factures, paiements, soldes, taux de change, échéances, frais de retard et rapports.                                                   | Calculs, échéances et droits testés.         |
| 4\. Portail client | Connexion, accès limité, validation des devis, choix d’assurance et notifications.                                                                      | Isolation des dossiers vérifiée.             |
| 5\. Tracking       | Liens Maersk, MSC et Grimaldi, puis API si accès accordé.                                                                                               | Références et événements traçables.          |
| 6\. Production     | Tests, sauvegardes, formation et documentation.                                                                                                         | Recette approuvée par USA CARS.              |

# 15. Critères d’acceptation

- Créer un dossier complet avec client, contrat, ordre d’achat, véhicule et documents.

- Émettre un devis forfaitaire (A, B, C, D) sans ventilation des coûts visible par le client, puis les factures d’acompte et de solde avec leur numérotation.

- Afficher les montants en USD et en FCFA avec le taux XE.com, sa date et son heure de relevé.

- Calculer les échéances du paiement 1 et du solde, et recalculer l’échéance du solde si l’ETA est avancée.

- Calculer et facturer les frais de retard selon les paramètres.

- Associer un véhicule à un conteneur et enregistrer les références maritimes et le lien de suivi.

- Afficher l’état du dossier, la chronologie et le tracking au client sans exposer d’autres dossiers.

- Bloquer la remise des documents tant que le solde n’est pas réglé.

- Déclencher et journaliser les alertes d’échéance, d’arrivée et de véhicule non réclamé.

- Exporter des rapports selon les permissions et maintenir une piste d’audit.

# 16. Hypothèses et points à confirmer

- L’accès API des transporteurs n’est pas présumé acquis et doit être vérifié pour chacun.

- Lien de suivi officiel Grimaldi à identifier (le lien actuel passe par un service tiers).

- Valeurs contractuelles encore ouvertes : dépôt, délai du paiement 1, plafond des frais de retard, plafond de responsabilité, seuil des frais supplémentaires, majoration éventuelle du taux, durée de conservation des données.

- Traitement fiscal (TVA) des forfaits et mentions légales des factures, avec l’expert-comptable.

- Publication au Journal officiel du décret sur la limite d’âge des véhicules importés.

- Les coûts d’API, d’hébergement, de messagerie et de fournisseurs tiers restent à chiffrer.

- Les paiements en ligne ne sont pas inclus dans le MVP ; les paiements et justificatifs seront enregistrés.

- Les intégrations COPART/IAA, signatures électroniques et connexions bancaires sont à étudier séparément.

# 17. Liens de référence

- Maersk – suivi des expéditions : https://www.maersk.com/tracking/

- Maersk Developer Portal : https://developer.maersk.com/

- MSC – suivi des expéditions : https://www.msc.com/fr/track-a-shipment

- MSC – site et portail développeurs : https://www.msc.com/

- Grimaldi – suivi via TrackingMCP (service tiers) : https://trackingmcp.com/track/grimaldi

- XE.com – USD vers XOF : https://www.xe.com/currencyconverter/convert/?Amount=1&From=USD&To=XOF

Les fonctionnalités, conditions d’accès et autorisations doivent être vérifiées lors de la phase d’intégration.

# Annexe A – Statuts suggérés

| **Étape**     | **Statuts possibles**                                                                          |
|---------------|------------------------------------------------------------------------------------------------|
| Ouverture     | Nouveau ; informations à compléter ; contrat signé ; ordre d’achat signé ; validation requise. |
| Achat         | Enchère en cours ; gagné ; devis émis ; devis validé ; paiement 1 attendu ; confirmé ; annulé. |
| Transport USA | Enlèvement à planifier ; enlevé ; en transit ; reçu au site/port.                              |
| Conteneur     | Chargement planifié ; chargé ; conteneur confirmé ; documents attendus.                        |
| Maritime      | Réservation confirmée ; départ prévu ; en transit ; transbordement ; arrivée estimée ; arrivé. |
| Dakar         | Documents à finaliser ; solde attendu ; documents remis ; dédouanement en cours ; enlevé.      |
| Clôture       | Terminé ; archivé ; réclamation ; litige ; suspendu ; non réclamé (procédure en cours).        |

# Annexe B – Informations à recueillir avant le développement

- Identité légale de USA CARS (forme juridique, RCCM, NINEA, adresse), logo officiel et liste des utilisateurs internes.

- Versions validées par le conseil juridique et l’expert-comptable du contrat, de l’ordre d’achat, du devis et des factures.

- Valeurs définitives des paramètres de la section 6.

- Comptes officiels (banque, Wave, Orange Money), numéro WhatsApp et e-mail officiels.

- Méthode interne de calcul des forfaits A et B (postes de coût et marge).

- Exemples de numéros de conteneur / Bill of Lading pour Maersk, MSC et Grimaldi.

- Canaux de notification et modèles de messages approuvés.

- Volume estimé de dossiers mensuels et nombre de clients simultanés.

- Politique d’accès, conservation des documents et exigences de sauvegarde.

# Annexe C – Correspondance entre documents contractuels et système

| **Document**           | **Généré ou enregistré à l’étape**  | **Référence**                   |
|------------------------|-------------------------------------|---------------------------------|
| Contrat de prestation  | Ouverture du dossier                | Contrat, articles 1 à 40        |
| Ordre d’achat          | Avant l’enchère                     | Annexe B du contrat             |
| Devis (DV)             | Après l’adjudication                | Devis / facture client          |
| Facture d’acompte (FA) | Après validation du devis           | Section A ; art. 9.1            |
| Facture de solde (FS)  | Après embarquement et B/L           | Sections B, C, D ; art. 9.2–9.3 |
| Fiche opérationnelle   | Mise à jour tout au long du dossier | Annexe A du contrat             |
| Décharge de remise     | Remise des documents                | Art. 15                         |
| Mise en demeure        | Défaut de paiement ou d’enlèvement  | Art. 21–22                      |
