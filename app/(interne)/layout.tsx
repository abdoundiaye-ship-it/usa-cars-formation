import { AppShell, type NavGroup } from "@/components/app-shell";
import { BrandFooter } from "@/components/brand-footer";
import { requireInternal } from "@/lib/auth/access";
import { canAccess, ROLE_LABELS, SCREEN_ROLES } from "@/lib/auth/roles";
import { signOut } from "../connexion/actions";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const access = await requireInternal();
  const can = (screen: keyof typeof SCREEN_ROLES) => canAccess(access.role, SCREEN_ROLES[screen]);

  // Menu par activité ; chaque rôle ne voit que ses écrans (la base vérifie aussi les droits).
  const groups: NavGroup[] = [
    {
      label: "Pilotage",
      items: [
        { href: "/tableau-de-bord", label: "Tableau de bord", icon: "dashboard" },
        { href: "/rapports", label: "Rapports", icon: "reports" },
        { href: "/aide", label: "Aide", icon: "help" },
      ],
    },
    {
      label: "Opérations",
      items: [
        { href: "/dossiers", label: "Dossiers", icon: "dossiers" },
        { href: "/clients", label: "Clients", icon: "clients" },
        { href: "/conteneurs", label: "Conteneurs", icon: "containers" },
        { href: "/documents", label: "Documents", icon: "documents" },
      ],
    },
    {
      label: "Finances",
      items: can("finances") ? [{ href: "/finances", label: "Finances", icon: "finances" }] : [],
    },
    {
      label: "Communication",
      items: [{ href: "/notifications", label: "Notifications", icon: "notifications" }],
    },
    {
      label: "Administration",
      items: [
        ...(can("users") ? [{ href: "/utilisateurs" as const, label: "Utilisateurs", icon: "users" as const }] : []),
        { href: "/parametres", label: "Paramètres", icon: "settings" },
        ...(can("audit") ? [{ href: "/audit" as const, label: "Journal d’audit", icon: "audit" as const }] : []),
      ],
    },
  ];

  return (
    <AppShell
      groups={groups.filter((g) => g.items.length > 0)}
      user={{ fullName: access.fullName, roleLabel: ROLE_LABELS[access.role] }}
      canCreateDossier={can("operationsWrite")}
      signOut={signOut}
      footer={<BrandFooter />}
    >
      {children}
    </AppShell>
  );
}
