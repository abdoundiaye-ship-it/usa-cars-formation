"use client";

import {
  ChartColumn,
  Bell,
  FileText,
  Folder,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  Ship,
  SlidersHorizontal,
  UserCog,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Icônes du menu (nom → composant) : la mise en page serveur ne transmet que des noms au composant client. */
const ICONS = {
  dashboard: LayoutDashboard,
  reports: ChartColumn,
  dossiers: Folder,
  clients: Users,
  containers: Ship,
  documents: FileText,
  finances: Wallet,
  notifications: Bell,
  users: UserCog,
  settings: SlidersHorizontal,
  audit: ShieldCheck,
  help: LifeBuoy,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof ICONS;

export interface NavItem {
  href: Route;
  label: string;
  icon: NavIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

interface AppShellProps {
  groups: NavGroup[];
  user: { fullName: string; roleLabel: string };
  /** Bouton « Nouveau dossier » (rôles autorisés à créer un dossier). */
  canCreateDossier: boolean;
  signOut: () => Promise<void>;
  /** Mention de copyright, rendue côté serveur et passée en prop. */
  footer: React.ReactNode;
  children: React.ReactNode;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

/**
 * Cadre de l'espace interne : menu latéral marine (fixe sur grand écran, tiroir sur téléphone), barre supérieure
 * (page en cours, recherche, nouveau dossier). Un seul menu « Navigation principale » dans la page.
 */
export function AppShell({ groups, user, canCreateDossier, signOut, footer, children }: AppShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Fermeture du tiroir au changement de page, pendant le rendu (pas d'effet qui déclenche un second rendu).
  const [shownAt, setShownAt] = useState(pathname);
  if (shownAt !== pathname) {
    setShownAt(pathname);
    if (open) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const current = groups
    .flatMap((g) => g.items.map((item) => ({ group: g.label, item })))
    .find((e) => isActive(e.item.href));
  const pageLabel = pathname.startsWith("/recherche") ? "Recherche" : current?.item.label;

  return (
    <div className="min-h-dvh lg:flex">
      <aside
        id="menu-principal"
        aria-label="Menu"
        className={cn(
          // Tiroir sur téléphone : masqué (display:none) quand il est fermé, pour qu'il n'élargisse jamais la page ;
          // fixe sur grand écran (lg), toujours affiché. Pas de transform hors écran (qui créerait un défilement).
          "bg-sidebar fixed inset-y-0 left-0 z-40 w-72 flex-col gap-2 p-3",
          "lg:sticky lg:top-0 lg:z-auto lg:flex lg:h-dvh lg:w-64 lg:shrink-0",
          open ? "flex" : "hidden",
        )}
      >
        <div className="flex items-center gap-2">
          <Link
            href="/tableau-de-bord"
            aria-label="USA CARS — tableau de bord"
            className="flex flex-1 justify-center rounded-lg bg-white px-3 py-2"
          >
            <BrandLogo priority className="h-11 bg-transparent p-0" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Fermer le menu"
            className="flex size-11 items-center justify-center rounded-lg bg-white/10 text-white lg:hidden"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <nav aria-label="Navigation principale" className="-mx-1 flex-1 overflow-y-auto px-1">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="text-sidebar-muted px-3 pt-4 pb-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase">
                {group.label}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = ICONS[item.icon];
                  const active = isActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                          active
                            ? "bg-white/12 text-white shadow-[inset_3px_0_0_var(--brand-red)]"
                            : "text-sidebar-foreground hover:bg-white/8 hover:text-white",
                        )}
                      >
                        <Icon aria-hidden className="size-5 shrink-0" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-3 rounded-lg bg-white/6 p-3">
          <span
            aria-hidden
            className="bg-brand-red flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          >
            {initials(user.fullName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{user.fullName}</p>
            <p className="text-sidebar-muted truncate text-xs">{user.roleLabel}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Se déconnecter"
              title="Se déconnecter"
              className="text-sidebar-foreground flex size-10 items-center justify-center rounded-lg hover:bg-white/10 hover:text-white"
            >
              <LogOut aria-hidden className="size-5" />
            </button>
          </form>
        </div>
      </aside>

      {/* Voile du tiroir : un clic ferme le menu (au clavier : Échap ou le bouton « Fermer le menu »). */}
      {open && (
        <div aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-slate-950/45 lg:hidden" />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-card sticky top-0 z-20 flex min-h-16 items-center gap-2 border-b px-2 sm:px-4 lg:gap-4 lg:px-8">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Ouvrir le menu"
            aria-controls="menu-principal"
            aria-expanded={open}
            className="hover:bg-background flex size-11 items-center justify-center rounded-lg lg:hidden"
          >
            <Menu aria-hidden className="size-5" />
          </button>
          <Link href="/tableau-de-bord" aria-label="USA CARS — tableau de bord" className="lg:hidden">
            <BrandLogo className="h-9 p-0" />
          </Link>
          <div className="hidden min-w-0 flex-col lg:flex">
            {current && <span className="text-muted text-xs">{current.group}</span>}
            <span className="truncate text-base font-bold">{pageLabel ?? "USA CARS"}</span>
          </div>

          <form action="/recherche" role="search" className="ml-auto hidden max-w-md flex-1 md:block">
            <label htmlFor="recherche-globale" className="sr-only">
              Rechercher
            </label>
            <div className="border-border bg-background focus-within:outline-primary flex h-10 items-center gap-2 rounded-lg border px-3 focus-within:outline-2">
              <Search aria-hidden className="text-muted size-4 shrink-0" />
              <input
                id="recherche-globale"
                name="q"
                type="search"
                placeholder="Rechercher un dossier, un VIN, un client, un conteneur…"
                className="placeholder:text-muted w-full bg-transparent text-sm outline-none"
              />
            </div>
          </form>
          <Link
            href="/recherche"
            aria-label="Rechercher"
            className="hover:bg-background ml-auto flex size-11 items-center justify-center rounded-lg md:hidden"
          >
            <Search aria-hidden className="size-5" />
          </Link>
          {canCreateDossier && (
            <Link href="/dossiers/nouveau" className={buttonClasses("primary", "hidden sm:inline-flex")}>
              <Plus aria-hidden />
              Nouveau dossier
            </Link>
          )}
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
        <footer className="border-border border-t px-4 py-6 lg:px-8">{footer}</footer>
      </div>
    </div>
  );
}
