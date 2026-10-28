import Image from "next/image";
import { cn } from "@/lib/utils";
import logo from "@/public/global-advisory-cci.jpg";

/**
 * Mention de copyright : application conçue par Global Advisory — Conseil & Commerce International (C&CI).
 * L'année est calculée côté serveur (ce composant n'est jamais rendu dans un composant client).
 * `className` permet d'adapter la couleur du texte au fond (ex. menu latéral marine).
 */
export function BrandFooter({ className }: { className?: string }) {
  const year = new Date().getFullYear();
  return (
    <div className={cn("text-muted flex flex-col items-center gap-1 text-center text-xs", className)}>
      <span className="inline-flex items-center rounded-sm bg-white px-0.5">
        <Image src={logo} alt="Global Advisory — Conseil & Commerce International" unoptimized className="h-5 w-auto" />
      </span>
      <p>© {year} Global Advisory — Conseil &amp; Commerce International (C&amp;CI). Tous droits réservés.</p>
    </div>
  );
}
