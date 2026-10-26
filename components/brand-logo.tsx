import Image from "next/image";
import { cn } from "@/lib/utils";
import logo from "@/public/logo-usa-cars.png";

/**
 * Logo USA CARS (public/logo-usa-cars.png, recadré depuis le fichier fourni par USA CARS).
 * Fond blanc permanent : le logo reste lisible en mode sombre. Image servie telle quelle (`unoptimized`) :
 * l'optimisation d'images de Next.js n'est pas disponible sur Cloudflare Workers.
 */
export function BrandLogo({ className, priority }: { className?: string; priority?: boolean }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-md bg-white px-1.5 py-1", className)}>
      <Image src={logo} alt="USA CARS" unoptimized priority={priority} className="h-full w-auto" />
    </span>
  );
}
