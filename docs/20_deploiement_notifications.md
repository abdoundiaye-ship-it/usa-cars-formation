# Notifications — paramètres de déploiement (phase 4, lot 4b)

Les identifiants des fournisseurs sont des **paramètres renseignés au moment du déploiement** (décision du 20/10/2026) : jamais dans le dépôt, jamais dans un message de commit. Sans eux, l’application fonctionne en **envoi simulé** : chaque message est créé, journalisé (statut « Simulé »), mais rien ne part (CLAUDE.md règle 10).

## Fonctionnement

1. La base crée les messages (table `notifications`, un par canal renseigné sur la fiche client) : lot remporté, devis émis, départ, ETA modifiée, arrivée, documents prêts ; chaque matin à 8 h, les rappels d’échéance (J-7, J-3, J-2) et les relances. Textes : `docs/19_notifications.md`.
2. La fonction Supabase **`send-notifications`** les envoie : e-mail par **Brevo**, WhatsApp par **Twilio**. Elle est appelée chaque minute par la base (pg_cron + pg_net) et immédiatement par l’application pour le lien de connexion d’un client.
3. Écran **Notifications** : journal (statut, erreur, destinataire), « Renvoyer » pour un échec, « Envoyer maintenant », « Envoyer un message de test » (administrateur).

## Paramètres (secrets de la fonction)

Liste complète et commentée : `supabase/functions/.env.example`.

| Paramètre | Rôle |
|---|---|
| `APP_URL` | Adresse publique de l’application (liens vers l’espace client) |
| `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | E-mail : clé d’API Brevo, adresse d’expédition sur le domaine vérifié (SPF, DKIM, DMARC) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | WhatsApp : compte Twilio, numéro WhatsApp Business (format +…) |
| `TWILIO_CONTENT_SIDS` | Modèles WhatsApp approuvés par Meta : JSON `{"lot_won": "HX…", …}` ; un modèle absent part en texte libre (accepté seulement dans le bac à sable Twilio ou une conversation ouverte) |
| `NOTIFICATIONS_TEST_EMAIL`, `NOTIFICATIONS_TEST_WHATSAPP` | **Mode test** : si renseignés, tous les messages leur sont redirigés (le journal indique « → test »). À vider pour la mise en service réelle |
| `NOTIFICATIONS_DISPATCH_TOKEN` | Facultatif : à renseigner avec la clé serveur de l’application si l’envoi immédiat renvoie « Accès refusé » |

## Commandes (production, après validation de la phase et sauvegarde)

```
supabase secrets set --env-file <fichier de paramètres hors du dépôt>
supabase functions deploy send-notifications
```

Puis, une seule fois, dans l’éditeur SQL du tableau de bord Supabase (envoi programmé chaque minute) :

```sql
select vault.create_secret('https://hzgkhtaefpbqztwagwph.supabase.co/functions/v1/send-notifications', 'notifications_dispatch_url');
select vault.create_secret('<clé service_role du projet>', 'notifications_dispatch_key');
```

Vérification : Notifications → « Envoyer un message de test » ; le journal passe à « Envoyé » (ou indique l’erreur du fournisseur).

## Local

Copier `supabase/functions/.env.example` en `supabase/functions/.env` (ignoré par Git), puis redémarrer Supabase (`pnpm db:stop`, `pnpm db:start`) pour que la fonction lise les paramètres.
