# Points de clarification

Les décisions de USA CARS font foi pour le développement (voir `CLAUDE.md`). Ce fichier contient :
1. les **décisions prises** (section 1) ;
2. les **interprétations** que Claude Code doit appliquer pour certaines réponses, et qu’il doit faire confirmer (section 2) ;
3. les **questions encore ouvertes**, avec la phase qu’elles bloquent et l’hypothèse par défaut (section 3).

Format pour ajouter une décision : `ID — date — décision`.

---

## 1. Décisions prises (17/10/2026)

| ID | Sujet | Décision |
|---|---|---|
| A1 | Comptes techniques | Les comptes **GitHub** et **Supabase** sont créés et détenus par USA CARS. Projet Supabase : référence `hzgkhtaefpbqztwagwph` (tableau de bord : https://supabase.com/dashboard/project/hzgkhtaefpbqztwagwph). |
| A3 | Utilisateurs | Créer **un compte Administrateur avec accès complet**. USA CARS créera ensuite les autres utilisateurs et leur attribuera un rôle depuis l’application. Pas d’accès partenaire USA pour l’instant. |
| B1 | Contrat | **Un contrat par véhicule** (un contrat = un dossier = un véhicule). |
| B2 | Devis multi-véhicules | Non : un devis et ses factures par dossier (conséquence de B1). |
| C1 | Forfaits A et B | **Phase actuelle : calcul manuel.** L’agent en charge de l’opération établit la structure des coûts, calcule les forfaits A et B hors du système ou avec l’aide d’une grille de saisie, puis **saisit les montants** des forfaits. **À terme** : calcul automatique proposé par le système (structure de coûts, règles de marge, arrondi), toujours soumis à vérification et approbation avant validation définitive. Le modèle de données doit dès maintenant permettre cette évolution. |
| C2 | Paiement 1 et dépôt | Le paiement 1 couvre **tout le forfait A**. Le dépôt est égal au **montant total du forfait A** (voir interprétation I2). |
| C3 | TVA et mentions légales | **À confirmer plus tard** avec l’expert-comptable. Champ TVA à 0 % en attendant. |
| C4 | Taux de change | Le taux utilisé est celui **de la date d’émission du devis** ; il est **réactualisé au moment du paiement**. Arrondi des montants FCFA **à l’unité la plus proche**. Pas de majoration (voir interprétation I1). |
| C6 | Trop-perçu | Le trop-perçu est **restitué au client** (remboursement enregistré et justifié). |
| D1 | Validation des modèles | Le développement avance sans attendre l’avocat. Les documents générés portent la mention **« PROJET »** tant que les modèles et les valeurs surlignées ne sont pas validés. |
| D3 | Signature / validation des documents | **Trois options proposées** : (1) document papier signé puis scanné et téléversé ; (2) validation par WhatsApp (preuve enregistrée) ; (3) acceptation directe dans le portail client (horodatée). |
| I1 | Majoration du taux | **Confirmé le 17/10/2026** : aucune majoration en pourcentage. Le devis affiche le montant FCFA au taux du jour de son émission ; à chaque paiement, le montant FCFA est recalculé au taux du jour du paiement. Le montant en USD reste la référence. |
| I2 | Dépôt | **Confirmé le 17/10/2026** : avant l’enchère, dépôt égal au **forfait A estimé à partir de l’enchère maximale** de l’ordre d’achat. Après l’adjudication, le dépôt est imputé sur le paiement 1 (totalité du forfait A) : le client paie la différence, ou l’excédent lui est restitué. Lot non remporté : dépôt intégralement restitué. |
| A1-bis | Environnements | Le projet Supabase `hzgkhtaefpbqztwagwph` est la **production**. Développement et tests sur Supabase **local** uniquement (voir `CLAUDE.md` §2). |
| A1-ter | Dépôt GitHub | https://github.com/abdoundiaye-ship-it/USA-CARS-SYST-ME-DE-GESTION-ET-DE-TRACKING (le garder **privé** : il contiendra les modèles de contrat et la configuration). |
| A2 | Hébergement | USA CARS indique **GitHub** (voir interprétation I5 sur l’hébergement de l’application elle-même). |
| A3-bis | Compte administrateur initial | `abdou.ndiaye@icloud.com` (variable `ADMIN_EMAIL`). |
| E1 / E2 / E3 | Connexion client et notifications | **Dès la première version** : le client reçoit son lien de connexion **par WhatsApp et par e-mail** ; les notifications partent **par e-mail et par WhatsApp** via des services d’envoi réels. |
| A4 | Double authentification | **17/10/2026** : TOTP (application d’authentification) **obligatoire pour admin et comptabilité** ; non imposé à la direction ni aux agents opérations. Liste des rôles paramétrable (`auth.mfa_required_roles`). |
| B3 | Numérotation | **17/10/2026** : référence dossier `UC-AAAA-####` ; compteurs **annuels**, continus et sans trou, pour les dossiers et les documents DV, FA, FS. |
| X7 | Date d’effet des paramètres | **17/10/2026** : chaque dossier conserve la date d’effet des paramètres en vigueur à son ouverture ; une modification de paramètre ne s’applique qu’aux nouveaux dossiers (cahier des charges §6). |
| E2 | Fournisseur d’e-mail | **17/10/2026** : **Brevo, offre gratuite** (300 e-mails/jour), choisi par Claude Code à la demande de USA CARS. Sert au SMTP de Supabase Auth (invitations, réinitialisations) et, en phase 4, aux notifications via l’adaptateur e-mail. **Reste à fournir** : le domaine d’envoi (ex. `usacars.sn`) à vérifier chez Brevo (SPF, DKIM, DMARC) et l’adresse d’expédition (ex. `no-reply@<domaine>`). |
| I5 | Hébergement | **17/10/2026** : phase de test sur **Cloudflare Workers + adaptateur OpenNext** (offre gratuite, adresse `*.workers.dev`), code sur GitHub, base sur Supabase. Cloudflare Pages écarté (outil Next.js obsolète, incompatible avec Next.js 16). Nom de domaine acheté quand l’application sera prête. Voir `docs/18_deploiement_cloudflare.md`. |
| A7 | Reprise des dossiers en cours | **19/10/2026** : **pas de reprise automatique**. Les dossiers en cours (Excel, papier) sont saisis manuellement dans l’application. |
| B4 | Changement de conteneur | **19/10/2026** : **oui**, un véhicule peut changer de conteneur ; chaque changement est conservé dans l’historique du dossier (ancien et nouveau conteneur, date, auteur). |
| B5 | Type de service | **19/10/2026** : **deux cas à prévoir**. (1) **Achat + transport** (cas courant) : le véhicule est choisi par le client ou par USA CARS, mais c’est **toujours USA CARS qui enchérit et paie**, sur la base d’un **ordre d’achat signé par le client**. (2) **Transport seul** (occasionnel) : le client achète lui-même le véhicule et confie uniquement le transport à USA CARS — **exclu pour le moment (décision du 19/10/2026)**, à reprendre plus tard si nécessaire (questions T1 à T4 en attente, section 3). |
| P1 | Conditions de passage relevant de la phase 3 | **19/10/2026** (plan de la phase 2 validé) : devis accepté, paiement 1 reçu, facture de solde, solde = 0 sont confirmés **manuellement** par l’agent (journalisé) en phase 2, puis vérifiés automatiquement en phase 3. |
| P2 | Dépôt sur l’ordre d’achat | **19/10/2026** : l’agent saisit le **montant attendu** (forfait A estimé, I2) ; l’encaissement est enregistré en phase 3 avec les paiements. |
| P3 | Comptes des clients | **19/10/2026** : phase 2 = fiches clients seulement ; comptes de connexion avec le portail (phase 4). |
| P4 | Transporteurs | **19/10/2026** : créés par l’administrateur dans Paramètres → Transporteurs ; transporteurs fictifs dans le seed local. |
| P5 | Âge du véhicule à l’importation | **19/10/2026** : âge = année en cours − année du modèle ; **bloquant si l’âge dépasse la limite** (limite 10 ans : un véhicule de 10 ans passe, un de 11 ans ou plus est bloqué). Dérogation possible par l’administrateur seulement, avec motif. |
| I4 | Forfaits : saisie et approbation | **19/10/2026** (interprétation confirmée) : l’agent opérations saisit les forfaits A et B et, s’il le souhaite, le détail interne des coûts ; **pas d’approbation obligatoire** (`quote.require_approval = false`), émission journalisée ; détail des coûts et marge **jamais** visibles du client. |
| C5 | Frais de retard | **19/10/2026** : **pas de plafond** ; ajoutés **après validation de la comptabilité**, jamais automatiquement. |
| C7 | Numérotation reçus et remboursements | **19/10/2026** : oui, `RC-AAAA-####` (reçus espèces) et `RB-AAAA-####` (notes de remboursement). |
| C8 | Comptes et canaux officiels | **19/10/2026** : **valeurs fictives** jusqu’à fourniture par USA CARS ; saisie ensuite par l’administrateur avec double validation. |
| C9 | Remboursements | **19/10/2026** : même moyen que le paiement d’origine, sous **5 jours ouvrés**, validé par un administrateur. |
| D4 | Logo et identité légale | **19/10/2026** : logo de USA CARS en en-tête des devis et factures ; identité légale par les paramètres `company.*`. |
| D5 | Format des documents remis | **19/10/2026** : phase 3 = documents **Word** ; la conversion PDF (service supplémentaire, éventuellement payant) est traitée à part, après choix de l’outil par USA CARS. |
| X1 | Moment du choix de l’assurance | **19/10/2026** : le client choisit l’assurance **à l’acceptation du devis** ; la facture de solde reprend ce choix. |
| X2 | Validité du devis et paiement 1 | **19/10/2026** : la validité du devis est **alignée sur l’échéance du paiement 1** (le devis expire en même temps que le délai de paiement) ; les deux valeurs restent des paramètres. |
| Q1 | Double validation des comptes officiels | **19/10/2026** : un administrateur crée ou modifie le compte ; l’activation est approuvée par **un administrateur ou la direction**, toujours une autre personne que le créateur. |
| Q2 | Montants sur le tableau de bord | **19/10/2026** : les agents opérations voient les montants de leurs dossiers (forfaits, soldes) ; la marge consolidée reste réservée à la direction et à l’administrateur. |
| A4-bis | Double authentification de la direction | **19/10/2026** : la direction approuvant les comptes de paiement (Q1), la double authentification est **exigée aussi pour la direction** (administrateur, comptabilité, direction). Nouvelle version du paramètre `auth.mfa_required_roles`. |
| J1 | Jours ouvrés (remboursements, remise des documents) | **20/10/2026** : les délais en jours ouvrés excluent les week-ends **et les jours fériés au Sénégal**. Calendrier tenu par l’administrateur (Paramètres → Jours fériés) : fêtes fixes et liées à Pâques pré-remplies ; fêtes à date lunaire (Tamkharit, Maouloud, Korité, Tabaski, Grand Magal de Touba) saisies chaque année à leur annonce. « 48 heures ouvrées » = 2 jours ouvrés. |
| E3-a | Fournisseur WhatsApp | **20/10/2026** (proposition validée) : **API WhatsApp Business via Twilio**, numéro WhatsApp Business dédié, vérification de l’entreprise par Meta à lancer par USA CARS ; modèles de messages soumis à l’approbation de Meta. |
| E5-a | Textes des notifications | **20/10/2026** (proposition validée) : rédigés par Claude Code, validés par USA CARS avant soumission des modèles WhatsApp. |
| I3-a | Connexion du client par WhatsApp | **20/10/2026** (proposition validée) : **lien de connexion à usage unique** généré côté serveur et envoyé par un modèle WhatsApp d’authentification approuvé ; lien magique par e-mail natif de Supabase en parallèle. |
| E3-b | Test réel WhatsApp | **20/10/2026** : e-mail validé en réel (Brevo, expéditeur `usacarsusasen@gmail.com`, message reçu). WhatsApp : le bac à sable Twilio exige des modèles (erreur 21654), impossibles à créer sur l’offre d’essai ; **test reporté** au passage de Twilio en offre payante (à l’usage), avec numéro WhatsApp Business de USA CARS, vérification Meta et approbation des modèles de `docs/19`. D’ici là, WhatsApp reste en **envoi simulé** en production (paramètres Twilio laissés vides). |
| R9-a | Qui enregistre la remise des documents | **20/10/2026** (hypothèse validée) : l’administrateur et les agents opérations ; la comptabilité et la direction consultent. |
| F9 | Dossiers sans devis accepté dans les soldes | **20/10/2026** (hypothèse validée) : rien n’est dû tant que le devis n’est pas accepté ; ces dossiers n’apparaissent pas dans les soldes de l’écran Finances. |
| F2-a | Accès API des transporteurs | **20/10/2026** (plan de la phase 5 validé) : aucun accès demandé pour le moment ; suivi par **liens seulement**, connecteur API (US-5.4) reporté jusqu’à l’obtention d’un accès. L’état de l’accès API reste renseigné par transporteur. |
| U1 | Délais de la procédure « véhicule non réclamé » | **20/10/2026** : relance à J+30, mise en demeure à J+60, délai de régularisation d’au moins 15 jours, procédure possible à 4 mois après l’arrivée (contrat art. 21–22) : valeurs **confirmées**. |
| U2 | Textes des courriers de relance et de mise en demeure | **20/10/2026** : rédigés par Claude Code d’après les articles 21–22, marqués « PROJET » jusqu’à validation par USA CARS (ou son avocat, D1). |
| U3 | Qui émet les courriers et ouvre la procédure | **20/10/2026** : l’administrateur, la direction et la comptabilité émettent les courriers et enregistrent leur envoi ; les agents opérations consultent. L’ouverture de la procédure à 4 mois (statut « Non réclamé ») est réservée à l’administrateur et à la direction, avec motif. Aucune action automatique sur la propriété du véhicule (R11). |
| U4 | Envoi des courriers | **20/10/2026** : l’agent envoie le courrier (remise en main propre, e-mail, WhatsApp, coursier) et enregistre l’envoi (date, canal, preuve) ; le courrier devient alors visible dans l’espace client et le client reçoit une notification l’en informant (sans pièce jointe ni coordonnées de paiement). |
| G1-a | Formalités CDP | **21/10/2026** (plan de la phase 6 validé) : la déclaration auprès de la Commission de protection des données personnelles est faite par USA CARS ; l’application fournit une page « Confidentialité » dans l’espace client, rédigée par Claude Code d’après l’article 33 et marquée « PROJET » jusqu’à validation. |
| G2-a | Durées de conservation | **21/10/2026** (valeur par défaut, **à confirmer**) : 10 ans après la clôture pour les pièces comptables, 5 ans pour les autres données ; paramètres modifiables, rapport des dossiers concernés, purge toujours manuelle. À reporter dans l’article 33 du contrat (durée laissée en blanc). |
| G2-b | Durées de conservation confirmées | **22/10/2026** : **10 ans** pour les pièces comptables (devis, factures, reçus, paiements) et **5 ans** pour les autres données, après la clôture ; paramètres passés au statut « confirmé » ; article 33 du contrat complété (durées reprises des paramètres dans le contrat généré). |
| G2-c | Suppression dans l’application | **22/10/2026** : un bouton par dossier permettra plus tard de **supprimer ou anonymiser** les données dont la durée de conservation est atteinte (remplace « purge hors application » de G2-a). Modalités : voir G2-d. |
| G2-d | Modalités de la suppression | **22/10/2026** (proposition acceptée) : **anonymisation** (identité et pièces effacées, pièces comptables conservées jusqu’à leur propre durée), par un **administrateur seulement, avec double validation**, uniquement pour un dossier listé par le rapport « Conservation des données », journalisée dans `audit_log` ; développée **après la phase 6**. |
| G3-a | Sauvegardes | **21/10/2026** : sauvegarde **chaque nuit par GitHub Actions**, **chiffrée**, de la base et des fichiers (documents), conservée 30 jours ; procédure de restauration testée et documentée. Pas d’offre payante Supabase pour l’instant. |
| P6-1 | Format des exports | **21/10/2026** : fichiers **Excel (.xlsx)**, générés par une fonction Supabase (limite de calcul de Cloudflare gratuit). |
| P6-2 | Environnement de formation | **21/10/2026** (valeur par défaut) : second projet Supabase gratuit et copie de l’application réservés à la formation, avec les données fictives (jamais en production) ; projet créé par USA CARS. |
| P6-3 | Réclamations après l’enlèvement | **21/10/2026** : ajoutées à la phase 6 (lot 6d) — saisie par l’agent ou le client, réserves et photos, délai `claim.business_days_after_pickup` jours ouvrés (au-delà : « hors délai »), suivi visible du client (`docs/12`). |

---

## 2. Interprétations à faire confirmer par USA CARS

I1 et I2 ont été confirmées le 17/10/2026, I4 le 19/10/2026 (voir section 1). Restent I3 et I5 : Claude Code applique ces interprétations par défaut, les rappelle dans son plan de phase et attend confirmation avant la phase concernée.

| ID | Réponse donnée | Interprétation appliquée | Phase |
|---|---|---|---|
| I3 | Connexion par lien WhatsApp et e-mail. | Supabase Auth envoie nativement des **liens magiques par e-mail**. Pour WhatsApp, deux solutions à valider techniquement : (a) code à usage unique (OTP) envoyé par WhatsApp via un fournisseur compatible Supabase ; (b) lien de connexion à usage unique généré côté serveur et envoyé par un **modèle WhatsApp d’authentification approuvé**. Claude Code propose la solution en phase 4 avant de la développer. | 4 |
| I4 | Calcul manuel des forfaits par l’agent. | L’agent (rôle `ops`) peut saisir les forfaits A et B et, s’il le souhaite, le détail interne des coûts. **Pas d’approbation obligatoire** en phase actuelle (`quote.require_approval = false`), mais l’émission est journalisée. Ce détail et la marge ne sont jamais visibles du client. | 3 |
| I5 | Hébergeur : GitHub. | GitHub héberge le **code** (dépôt) et l’**intégration continue** (GitHub Actions). GitHub Pages ne sert que des sites **statiques** : il ne peut pas exécuter la partie serveur de l’application (génération des devis et factures, clés Supabase secrètes, réception des messages WhatsApp, tâches planifiées). Deux options : **(a) recommandée** — application Next.js déployée automatiquement depuis le dépôt GitHub sur Vercel (offre gratuite pour démarrer), Supabase restant la base de production ; **(b)** interface statique sur GitHub Pages et toute la logique serveur dans des Supabase Edge Functions (plus de travail, mêmes fonctionnalités). Claude Code applique **(a)** par défaut et attend la confirmation de USA CARS avant le premier déploiement. | 0 (déploiement) |

**Documents à aligner** (hors développement) : l’article 8 du contrat prévoit un taux relevé à la date d’émission de la **facture** ; la décision C4 retient la date du **devis** avec réactualisation au paiement. L’article 6 laisse le dépôt « à définir » ; la décision C2 le fixe au forfait A. Le contrat et le devis Word doivent être mis à jour en conséquence.

---

## 3. Questions encore ouvertes

| # | Question | Bloque | Hypothèse par défaut |
|---|---|---|---|
| A5 | Langue de l’interface. | — | Français uniquement. |
| A6 | Volume attendu (dossiers/mois, clients, utilisateurs internes). | — | 50 dossiers/mois, 200 clients, 10 internes. |
| E3 | **Fournisseur WhatsApp** : API WhatsApp Business de Meta (en direct) ou intermédiaire (Twilio, 360dialog…) ? Numéro WhatsApp Business dédié ? Vérification de l’entreprise par Meta à lancer. | Phase 4 | API WhatsApp Business via Twilio ; modèles de messages soumis à approbation. |
| E5 | Textes des notifications (lot remporté, devis, échéances, départ, ETA modifiée, arrivée, documents prêts, relances). | Phase 4 | Proposés par Claude Code, validés par USA CARS. |
| F1 | Lien officiel de suivi Grimaldi. | — | Lien tiers TrackingMCP, signalé comme tel. |
| F2 | Demander un accès API Maersk / MSC ? | Phase 5 (API) | Liens seulement ; API reportée (voir F2-a). |
| F3 | Fréquence de vérification manuelle du suivi. | — | Alerte après 3 jours sans vérification en transit. |
| F4 | Exemples réels anonymisés de numéros de conteneur et de B/L. | Phase 5 | Contrôle ISO 6346 ; B/L en texte libre. |
| G1 | Formalités CDP (données personnelles). | Production | Avant la mise en production (voir G1-a). |
| G2 | Durées de conservation après clôture. | Production | 10 ans (comptable), 5 ans (autres) — confirmé (voir G2-b). |
| G3 | Sauvegardes (fréquence, rétention), restauration. | Production | Quotidienne, 7 jours minimum (voir G3-a). |
| G4 | Publication au JO du décret sur la limite d’âge (10 / 15 ans). | — | 10 / 15 ans, paramétrables. |
| T1 | Transport seul (B5) : quel contrat ? Le contrat actuel (40 articles) est construit autour de l’achat (ordre d’achat, enchère, forfait A). | Reporté (transport seul exclu le 19/10/2026) | Même contrat avec une variante « transport seul » sans les articles d’acquisition, marquée « PROJET » jusqu’à validation par l’avocat (D1). Pas d’ordre d’achat ; R14 devient : un dossier = un véhicule = un contrat. |
| T2 | Transport seul : quels montants et quand les payer ? | Reporté (transport seul exclu le 19/10/2026) | Pas de forfait A ni de dépôt ; forfait B (logistique + maritime), option C et ajustements D inchangés. Paiement 1 = totalité du forfait B **avant l’enlèvement aux États-Unis** ; solde = ajustements éventuels, avant la remise des documents. |
| T3 | Transport seul : quels documents le client doit-il fournir, et avant quand ? | Reporté (transport seul exclu le 19/10/2026) | Titre de propriété, facture d’achat (bill of sale), autorisation d’enlèvement (release / gate pass) et adresse d’enlèvement, **avant la planification du transport terrestre**. |
| T4 | Transport seul : qui paie les frais de stockage ou de retard sur le lieu d’achat (parc COPART/IAA ou vendeur) ? | Reporté (transport seul exclu le 19/10/2026) | Le client, refacturés en ajustement D s’ils sont avancés par USA CARS. |
