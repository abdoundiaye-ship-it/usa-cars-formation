# Documents générés par le système

Modèles de référence dans `reference/templates/` (Word). Pour la génération, créer des copies avec des balises (docxtemplater, syntaxe `{champ}`) dans `templates/` ; ne pas modifier les originaux.

| Document | Modèle de référence | Numéro | Généré quand | Visible client |
|---|---|---|---|---|
| Contrat de prestation | `USA_CARS_Contrat_Prestation_Services_Senegal_-_Revise.docx` (art. 1 à 40) | `reference` du contrat | Ouverture du dossier (un contrat par véhicule, B1) | oui |
| Ordre d’achat | Contrat, annexe B | — | Avant l’enchère | oui |
| Fiche opérationnelle | Contrat, annexe A | — | À la demande, mise à jour continue | non (interne), sauf décision contraire |
| Devis | `USA_CARS_Devis_Facture_Client_-_Revise.docx` (case « Devis ») | DV-AAAA-#### | Après l’adjudication | oui |
| Facture d’acompte | même modèle (case « Facture d’acompte ») | FA-AAAA-#### | Après acceptation du devis | oui |
| Facture de solde | même modèle (case « Facture de solde ») | FS-AAAA-#### | Après embarquement et B/L | oui |
| Reçu espèces | à créer (1 page, même charte) | RC-AAAA-#### | Paiement en espèces | oui |
| Note de remboursement | à créer (1 page) | RB-AAAA-#### | Exécution d’un remboursement de trop-perçu | oui |
| Décharge de remise | à créer | — | Remise des documents | oui |
| Lettre de relance | `templates/courrier.docx` (art. 22) | LR-AAAA-#### | Véhicule arrivé, solde dû ou non enlevé (J+30 au plus tard) | oui, une fois l’envoi enregistré (U4) |
| Mise en demeure | même modèle (art. 21–22) | MD-AAAA-#### | Après l’envoi de la relance (J+60 au plus tard) | oui, une fois l’envoi enregistré (U4) |

## Champs du devis / facture

En-tête : identité légale USA CARS (paramètres), type de document coché, numéro, date, n° contrat, référence dossier, client, téléphone, pièce/NINEA, e-mail.

Section 1 : marque, modèle, année, VIN, plateforme, lot, lieu d’achat, port de départ, transporteur, conteneur, navire/voyage, B/L, ETA (indicative), lien de suivi.

Section 2 :
- A — libellé fixe « Coût total d’acquisition du véhicule – forfait » + description fixe + `forfait_a`.
- B — libellé fixe « Logistique et transport maritime vers Dakar – forfait » + description fixe + `forfait_b`.
- C — assurance : case cochée selon `insurance`, montant (0 si refusée), initiales.
- D — lignes `adjustments` approuvées (libellé, montant).
- TVA (si taux > 0) ; TOTAL GÉNÉRAL USD.

Sections 3 à 5 : paiements reçus (date, mode, référence, montant USD, montant FCFA et taux du jour du paiement), total payé, solde USD, taux de référence du devis (valeur, source, date-heure du relevé), solde FCFA au taux du jour d’édition (« indicatif, réactualisé au paiement »), échéancier (paiement 1 = totalité du forfait A moins dépôt, solde avec ETA de référence).

Sections 6 à 8 : comptes officiels actifs, référence à indiquer, conditions, bloc de validation.

**Contrôle automatique** : un test parcourt le texte du fichier généré et échoue s’il contient un libellé ou un montant de `internal_costs`.

## Règles

- Un document émis est figé (fichier stocké + valeurs en base). Correction = annulation + nouveau document.
- Mention « PROJET » en filigrane tant que le paramètre `templates.legal_validated` est faux (décision D1).
- Chaque document soumis à acceptation porte une empreinte (SHA-256) enregistrée avec l’acceptation (R15).
- Export PDF : seconde étape (LibreOffice headless côté serveur ou service dédié), à décider en phase 3.

## Mise en œuvre (lot 3b)

- Modèle balisé `templates/devis_facture.docx`, produit par `pnpm templates:generate` à partir du modèle révisé : logo de USA CARS en en-tête (D4), case du type de document, valeurs contractuelles du modèle (validité, frais de retard, délais du paiement 1 et du solde, remise des documents) **remplacées par les paramètres** en vigueur à l’ouverture du dossier (CLAUDE.md règle 4).
- Émission en deux temps : la base émet le document (numéro DV/FA continu, montants et taux figés — fonctions `issue_quote`, `issue_deposit_invoice`), puis la fonction `generate-document` produit le fichier Word et le rattache **une seule fois** (`register_financial_document_file`). Un échec de génération n’entraîne aucun trou de numérotation : « Générer le fichier » relance la génération.
- Le générateur ne lit que les lignes visibles du client (`financial_documents`) : aucune requête sur `internal_costs`. Contrôle automatique : test unitaire sur le fichier généré et parcours Playwright qui télécharge le devis et y cherche les coûts internes du dossier.
- Devis : section 1 (expédition) affichée « — » tant que le conteneur n’est pas connu ; total « hors option C » et « avec l’assurance » ; reste à payer en FCFA au taux du jour d’édition.
- Facture d’acompte : totalité du forfait A (+ TVA), dépôts imputés, excédent éventuel signalé « à restituer » ; taux de référence du devis.

## Mise en œuvre (lot 3c)

- Facture de solde `FS` : même modèle (case « Facture de solde »), émise après l’embarquement (conteneur affecté avec B/L et ETA) ; lignes B, C si acceptée, D approuvées (détaillées), TVA ; ETA de référence figée (« indicative ») ; section 1 renseignée depuis le conteneur (transporteur, navire, B/L, lien de suivi). Si l’ETA est avancée, l’échéance est avancée (R4) et l’événement est visible du client ; le fichier émis n’est pas regénéré.
- Reçu espèces `RC` et note de remboursement `RB` : modèle d’une page `templates/recu.docx` (même en-tête avec logo, mention PROJET), montant USD qui fait foi et équivalent FCFA (montant reçu, ou taux du jour), mode, référence, signatures.
- Les lignes D postérieures à la facture de solde (frais de retard, par exemple) entrent dans le solde du dossier sans modifier la facture émise.

## Mise en œuvre (lot 5b) — procédure « véhicule non réclamé »

- Modèle `templates/courrier.docx` (même en-tête avec logo, mention PROJET tant que `templates.legal_validated` est faux, décision U2) : destinataire, références du dossier et du contrat, objet, corps rédigé d’après les articles 17, 20, 21 et 22, signature.
- Lettre de relance `LR` : arrivée, sommes dues (USD qui fait foi, équivalent FCFA au taux du jour d’émission), véhicule enlevé ou non, échéance de la mise en demeure.
- Mise en demeure `MD` (art. 21) : relance citée, sommes dues et frais de retard accumulés, délai de régularisation d’au moins `unclaimed.formal_notice_min_cure_days` jours **à compter de la réception**, conséquences (art. 22) et mention « aucune appropriation automatique ». La date limite est fixée à l’enregistrement de l’envoi (date d’envoi + délai).
- Montants et motif figés à l’émission ; aucune coordonnée de paiement (rappel des seuls canaux officiels de l’annexe D) ; aucun coût interne.
- Le courrier n’est visible du client qu’après l’enregistrement de l’envoi (date, canal, preuve) ; la preuve d’envoi reste interne.
