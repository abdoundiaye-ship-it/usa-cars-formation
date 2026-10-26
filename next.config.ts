import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  // Preuves d'acceptation et documents téléversés par les actions serveur : 20 Mo au plus (bucket « documents »).
  experimental: { serverActions: { bodySizeLimit: "21mb" } },
  // Un package-lock.json existe dans le dossier utilisateur : on fixe explicitement la racine du projet.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
