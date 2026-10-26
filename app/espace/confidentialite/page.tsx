import type { Metadata } from "next";
import { Alert, Card, PageHeader } from "@/components/ui/feedback";
import { noticeValue, retentionText } from "@/lib/privacy";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Confidentialité" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

/**
 * G1-a : information du client sur ses données personnelles, rédigée d'après l'article 33 du contrat (loi
 * n° 2008-12). Marquée PROJET tant que le paramètre data.privacy_notice_validated est faux. Coordonnées et durées
 * de conservation lues dans les paramètres (règle 4), par la fonction privacy_notice (le client ne lit pas settings).
 */
export default async function ConfidentialitePage() {
  const supabase = await createSupabaseServerClient();
  const { data: notice, error } = await supabase.rpc("privacy_notice");
  const email = noticeValue(notice?.email);
  const phone = noticeValue(notice?.phone);
  const address = noticeValue(notice?.office_address);
  const contact = email ? (
    <a href={`mailto:${email}`} className="text-primary underline">
      {email}
    </a>
  ) : (
    "l’adresse e-mail officielle de USA CARS"
  );

  return (
    <>
      <PageHeader title="Confidentialité" description="Comment USA CARS traite vos données personnelles." />
      {error ? (
        <Alert tone="danger">Cette page n’a pas pu être chargée. Rechargez la page.</Alert>
      ) : (
        <Card className="flex flex-col gap-6">
          {!notice?.validated && <Alert tone="warning">PROJET — texte en cours de validation par USA CARS.</Alert>}
          <Section title="Qui traite vos données">
            <p>
              USA CARS, pour l’exécution de votre contrat de prestation
              {address ? <>, bureau au Sénégal : {address}</> : null}. Contact : {contact}
              {phone ? <>, téléphone {phone}</> : null}.
            </p>
          </Section>
          <Section title="Données traitées et pourquoi">
            <p>
              Votre identité, vos coordonnées, les pièces de votre dossier, les informations de paiement et le suivi de
              votre véhicule. Elles servent à exécuter le contrat (achat aux enchères, transport jusqu’au port de Dakar,
              remise des documents), à gérer votre espace client, à vous envoyer les notifications (e-mail, WhatsApp) et
              à respecter les obligations légales de USA CARS.
            </p>
          </Section>
          <Section title="Qui les reçoit">
            <p>
              Uniquement les destinataires nécessaires à votre opération : plateformes d’enchères, transporteurs,
              terminaux, transitaires, administrations et prestataires techniques (hébergement, messagerie). Certains
              sont situés hors du Sénégal, notamment aux États-Unis.
            </p>
          </Section>
          <Section title="Combien de temps">
            <p>
              Après la clôture de votre dossier, les pièces comptables (devis, factures, reçus, paiements) sont
              conservées {retentionText(notice?.retention_years_accounting)} et les autres données{" "}
              {retentionText(notice?.retention_years)}. Elles sont ensuite supprimées ou anonymisées.
            </p>
          </Section>
          <Section title="Vos droits">
            <p>
              Vous pouvez accéder à vos données, les faire rectifier ou vous opposer à leur traitement en écrivant à{" "}
              {contact}. Vous pouvez aussi saisir la Commission de protection des données personnelles (CDP).
            </p>
          </Section>
          <Section title="Sécurité">
            <p>
              Votre espace n’est accessible qu’avec vos accès personnels. Chez USA CARS, chaque personne ne voit que ce
              que son rôle exige, et les actions sur votre dossier sont enregistrées. Ce site n’utilise que les cookies
              nécessaires à votre connexion.
            </p>
          </Section>
          <p className="text-muted text-xs">
            Références : article 33 du contrat de prestation ; loi n° 2008-12 du 25 janvier 2008 sur la protection des
            données à caractère personnel.
          </p>
        </Card>
      )}
    </>
  );
}
