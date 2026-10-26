# Rôles et permissions

Rôles techniques : `admin`, `ops` (agent opérations), `accounting` (comptabilité), `management` (direction), `client`.

Démarrage (décision A3) : un seul compte **Administrateur avec accès complet** est créé au premier déploiement ; l’administrateur crée ensuite les autres utilisateurs et leur attribue un rôle depuis l’écran Utilisateurs. Les permissions sont appliquées **par RLS et dans les fonctions serveur** ; l’interface ne fait que refléter ces droits.

L = lecture · E = écriture · V = validation · — = aucun accès

| Objet | admin | ops | accounting | management | client |
|---|---|---|---|---|---|
| Clients | L E | L E | L | L | L (sa fiche) |
| Contrats | L E V | L E | L | L | L (les siens) |
| Ordres d’achat | L E V (dérogation âge / enchère) | L E | L | L | L (les siens), acceptation |
| Dossiers – étapes et statuts | L E V (exceptions) | L E | L | L | L (les siens, chronologie visible) |
| **Coûts internes et marge** | L E | L E (décision C1 : l’agent établit la structure des coûts) | L E | L | **—** |
| Forfaits et devis | L E V | L E (saisie manuelle des forfaits et émission) | L E V | L | L (ses devis émis), acceptation et choix d’assurance |
| Factures, ajustements D | L E V | L | L E V | L | L (les siennes), approbation des frais supplémentaires |
| Paiements | L E | L | L E | L | L (les siens) |
| Remboursements (trop-perçu) | L E V | L | L E (demande) | L | L (les siens) |
| Acceptations (scan, WhatsApp, portail) | L E | L E (scan, WhatsApp) | L | L | E (portail), L (les siennes) |
| Comptes officiels | L E V (double validation) | L | L | L V (approbation, décision Q1) | L (comptes actifs uniquement, sur les factures) |
| Taux de change | L E | L | L E | L | L (taux figé sur ses documents) |
| Conteneurs, ETA, événements | L E | L E | L | L | L (conteneur de ses dossiers, événements `visible_client`) |
| Documents | L E | L E | L E | L | L si `visible_client` |
| Remise des documents | L E | L E | L | L | L |
| Réclamations | L E | L E | L | L | L E (les siennes) |
| Recouvrement (relances, mises en demeure) | L E | L | L E | L E (U3) | L (courriers envoyés) |
| Procédure « véhicule non réclamé » (ouverture, clôture) | L E | L | L | L E (U3) | — |
| Notifications | L E | L E | L | L | L (les siennes) |
| Paramètres, transporteurs | L E | L | L | L | — |
| Utilisateurs | L E (crée les comptes et attribue les rôles) | — | — | L | — |
| Journal d’audit | L | — | — | L | — |
| Rapports et exports | L | L (opérationnels) | L (financiers) | L | — |

Tests obligatoires (phase 1 puis à chaque nouvelle table) :
1. Un client A ne peut lire aucune ligne d’un client B (dossiers, documents, paiements, notifications, événements).
2. Le rôle `client` reçoit zéro ligne de `internal_costs`, et aucun document ou vue client ne contient la marge.
3. Seul `admin` crée ou modifie un compte officiel ; son activation est approuvée par `admin` ou `management` (décision Q1), et l’approbateur doit être différent du créateur.
4. Un document émis (`financial_documents.status <> 'draft'`) ne peut plus être modifié, seulement annulé.
