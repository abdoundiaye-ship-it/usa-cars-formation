import Image from "next/image";
import logo from "@/public/global-advisory-cci.jpg";

/**
 * Mention de copyright : application conçue par Global Advisory — Conseil & Commerce International (C&CI).
 * L'année est calculée côté serveur (ce composant n'est jamais rendu dans un composant client).
 */
export function BrandFooter({ className }: { className?: string }) {
  const year = new Date().getFullYear();
  return (
    <div className={`text-muted flex flex-col items-center gap-2 text-center text-xs ${className ?? ""}`}>
      <span className="inline-flex items-center rounded-md bg-white px-2 py-1">
        <Image src={logo} alt="Global Advisory — Conseil & Commerce International" unoptimized className="h-6 w-auto" />
      </span>
      <p>© {year} Global Advisory — Conseil &amp; Commerce International (C&amp;CI). Tous droits réservés.</p>
    </div>
  );
}
