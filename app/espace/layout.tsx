import { LogOut } from "lucide-react";
import Link from "next/link";
import { BrandFooter } from "@/components/brand-footer";
import { BrandLogo } from "@/components/brand-logo";
import { buttonClasses } from "@/components/ui/button";
import { requireClient } from "@/lib/auth/access";
import { signOut } from "../connexion/actions";

/** Portail client (phase 4) : espace distinct de l'espace interne ; données filtrées par la RLS (règle 3). */
export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const access = await requireClient();
  return (
    <div className="min-h-dvh">
      <header className="border-border bg-card sticky top-0 z-10 border-b">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/espace" aria-label="USA CARS — mes dossiers" className="flex rounded-md bg-white px-1.5 py-1">
            <BrandLogo priority className="h-10 bg-transparent p-0" />
          </Link>
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <p className="text-muted hidden min-w-0 truncate text-right font-medium sm:block">{access.fullName}</p>
            <form action={signOut}>
              <button type="submit" className={buttonClasses("secondary", "min-h-10 px-3")}>
                <LogOut aria-hidden />
                <span className="sr-only sm:not-sr-only">Se déconnecter</span>
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-4 md:py-8">{children}</main>
      <footer className="border-border mx-auto mt-4 flex max-w-4xl flex-col items-center gap-4 border-t px-4 py-6">
        <Link href="/espace/confidentialite" className="text-muted text-sm underline">
          Confidentialité
        </Link>
        <BrandFooter />
      </footer>
    </div>
  );
}
