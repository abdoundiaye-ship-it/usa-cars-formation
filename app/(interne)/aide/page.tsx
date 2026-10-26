import {
  Bell,
  ChartColumn,
  FileText,
  Folder,
  LayoutDashboard,
  LifeBuoy,
  Search,
  Ship,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui/feedback";
import { requireInternal } from "@/lib/auth/access";
import { ROLE_LABELS, SCREEN_ROLES } from "@/lib/auth/roles";

export const metadata: Metadata = { title: "Aide" };

interface Topic {
  icon: LucideIcon;
  title: string;
  body: string;
}

const TOPICS: Topic[] = [
  {
    icon: LayoutDashboard,
    title: "Tableau de bord",
    body: "Votre point de départ : les actions urgentes (en rouge), les échéances de la semaine et l’avancement des dossiers. Cliquez sur un élément « À traiter » pour ouvrir le dossier concerné.",
  },
  {
    icon: Search,
    title: "Rechercher",
    body: "La barre en haut cherche partout : numéro de dossier, VIN, nom de client, téléphone, numéro de conteneur ou B/L. Saisissez au moins deux caractères.",
  },
  {
    icon: Folder,
    title: "Dossiers",
    body: "Un dossier = un véhicule = un contrat. Le fil des étapes en haut de la fiche montre où en est le véhicule, de l’ouverture jusqu’à l’enlèvement à Dakar. Les documents (contrat, ordre d’achat, factures) se téléchargent au format Word.",
  },
  {
    icon: Users,
    title: "Clients",
    body: "Créez la fiche d’un client avant d’ouvrir son premier dossier. Une fiche incomplète est signalée ; complétez-la avant de passer à l’étape Achat. L’accès au portail client se gère depuis la fiche.",
  },
  {
    icon: Ship,
    title: "Conteneurs",
    body: "Suivez l’acheminement : l’ETA est toujours indicative tant que l’arrivée (ATA) n’est pas saisie — ce n’est jamais une position en temps réel. Un conteneur en mer non vérifié depuis plusieurs jours est signalé « À vérifier ».",
  },
  {
    icon: Wallet,
    title: "Finances",
    body: "Relevez le taux USD → FCFA chaque jour ouvré : le devis fige le taux du jour de son émission, et chaque paiement prend le taux du jour du paiement. Enregistrez le taux avant de saisir un paiement ou d’émettre un devis.",
  },
  {
    icon: Bell,
    title: "Notifications",
    body: "Le journal des messages envoyés aux clients (e-mail, WhatsApp). Un message en échec peut être renvoyé. Les coordonnées de paiement ne sont jamais envoyées dans une notification.",
  },
  {
    icon: FileText,
    title: "Documents",
    body: "Tous les fichiers des dossiers, en stockage privé. La bascule « Visible du client » décide de ce que le client voit dans son portail.",
  },
  {
    icon: ChartColumn,
    title: "Rapports",
    body: "Indicateurs d’activité (dossiers actifs, retards, créances, délais) exportables au format Excel. La marge et la revue des accès sont réservées à l’administrateur et à la direction.",
  },
  {
    icon: SlidersHorizontal,
    title: "Paramètres",
    body: "Valeurs du contrat (délais, montants, numérotation, identité de l’entreprise). Chaque modification crée une nouvelle version datée ; les dossiers déjà ouverts conservent les valeurs de leur ouverture.",
  },
];

const ADMIN_TOPIC: Topic = {
  icon: ShieldCheck,
  title: "Administration (administrateur et direction)",
  body: "Créez les comptes et attribuez les rôles depuis « Utilisateurs ». Le « Journal d’audit » trace les actions sensibles. La « Revue des accès » (dans Rapports) liste les comptes, leur double authentification et leur dernière connexion. Les comptes de paiement officiels se modifient à deux validations.",
};

/** Guide d'utilisation par écran (US-6.2) : court, adapté au rôle. */
export default async function AidePage() {
  const access = await requireInternal(SCREEN_ROLES.dashboard);
  const topics = access.role === "admin" || access.role === "management" ? [...TOPICS, ADMIN_TOPIC] : TOPICS;

  return (
    <>
      <PageHeader
        title="Aide"
        description={`Guide d’utilisation de l’application · votre rôle : ${ROLE_LABELS[access.role]}.`}
      />
      <Card className="mb-6 flex items-start gap-3">
        <LifeBuoy aria-hidden className="text-primary mt-0.5 size-5 shrink-0" />
        <p className="text-sm">
          Besoin d’aide ou d’un accès&nbsp;? Contactez votre administrateur. Vous ne voyez que les écrans autorisés à
          votre rôle ; chaque action importante est enregistrée.
        </p>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        {topics.map(({ icon: Icon, title, body }) => (
          <Card key={title} className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 font-bold">
              <Icon aria-hidden className="text-primary size-5 shrink-0" />
              {title}
            </h2>
            <p className="text-muted text-sm leading-relaxed">{body}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
