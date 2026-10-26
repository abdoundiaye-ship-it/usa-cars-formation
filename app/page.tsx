import { redirect } from "next/navigation";
import { getAccess } from "@/lib/auth/access";

export const dynamic = "force-dynamic";

/** Accueil : oriente vers la connexion, l’espace client ou l’espace interne. */
export default async function HomePage() {
  const access = await getAccess().catch(() => null);
  redirect(!access ? "/connexion" : access.role === "client" ? "/espace" : "/tableau-de-bord");
}
