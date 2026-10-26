# Écrans et expérience utilisateur

Référence visuelle et fonctionnelle : `reference/prototype/usa-cars-prototype.html` (ouvrir dans un navigateur ; sélecteur « Voir comme » pour changer de rôle). Le prototype est **antérieur** au passage au devis forfaitaire : ses lignes de coûts détaillées correspondent aux **coûts internes**, pas à ce que voit le client. En cas d’écart, les documents de `docs/` font foi.

## Espace interne

| Écran | Contenu | Rôles |
|---|---|---|
| Tableau de bord | Indicateurs (dossiers actifs, conteneurs en mer, soldes dus, échéances dépassées), liste « À traiter » triée par gravité (échéance dépassée, devis expiré, dossier sans mise à jour > 7 j, ETA modifiée, documents à remettre, véhicule non réclamé), dossiers par étape, conteneurs avec progression calendaire (« pas une position GPS ») | tous internes |
| Dossiers | Recherche (référence, client, VIN, lot, conteneur), filtres par étape, colonnes : référence, client, véhicule, étape · statut, conteneur, dernière mise à jour, responsable, solde | tous internes |
| Fiche dossier | Bandeau étape (7 étapes), conditions de passage avec coches, actions ; blocs véhicule, chronologie, forfaits et paiements, coûts internes (selon rôle), expédition, documents, notes, réclamations, audit du dossier | tous internes |
| Ordre d’achat | Formulaire annexe B, contrôle de l’âge, enchère max, dépôt, confirmations, signature | admin, ops |
| Devis et factures | Saisie manuelle des forfaits A et B (aide : tableau facultatif des coûts internes et marge implicite), émission DV/FA/FS, aperçu du document, enregistrement de l’acceptation (portail, WhatsApp, scan) et du choix d’assurance, ajustements D | admin, ops, accounting |
| Conteneurs | Liste et fiche : références, lien de suivi (mention « service tiers » si besoin), événements avec source, historique ETA, véhicules chargés, actions (ETA, événement, départ, ATA, vérifié aujourd’hui) | admin, ops |
| Finances | Soldes par dossier (USD et FCFA au taux du jour), échéances, paiements récents, remboursements à approuver et à exécuter, frais de retard proposés, taux de change du jour et historique | admin, accounting, management |
| Documents | Tous les documents, filtre par type, bascule visible client / interne | internes |
| Notifications | Journal, statut, renvoi | admin, ops |
| Recouvrement | Relances et mises en demeure à envoyer, compte à rebours 4 mois | admin, accounting |
| Rapports | Indicateurs, créances, délais, marge par véhicule (direction), exports CSV/Excel | selon rôle |
| Paramètres | Transporteurs, règles contractuelles (avec statut à confirmer), comptes officiels (double validation), utilisateurs et rôles (création par l’administrateur) | admin |
| Journal d’audit | Recherche et filtre | admin, management |

## Portail client

- Accueil : ses dossiers sous forme de cartes (véhicule, étape, prochaine action attendue de sa part).
- Dossier : étapes, devis à accepter (forfaits A et B, choix d’assurance C), factures, paiements, solde en USD et FCFA (taux, source et date affichés), échéance, documents visibles, frais supplémentaires à approuver, réclamation.
- Suivi maritime : transporteur, conteneur, B/L, navire, ETA « indicative » ou ATA, derniers événements, bouton vers la page de suivi (avec la référence à saisir si le lien ne la contient pas), mention « pas une localisation GPS ».
- Instructions de paiement : comptes officiels actifs + message anti-fraude.

## Exigences transverses

- Responsive dès 400 px (les agents travaillent aussi sur téléphone).
- Montants : `tabular-nums`, USD en premier, FCFA en secondaire.
- États vides, chargement et erreurs explicites ; messages d’erreur qui disent comment corriger.
- Toute action sensible affiche une confirmation dans la page (pas de `confirm()` navigateur) et laisse une trace d’audit.
- Accessibilité : contrastes AA, navigation clavier, libellés de formulaires.
