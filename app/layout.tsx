import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/** Police de la charte : lisible pour les chiffres et les tableaux ; hébergée avec l'application (aucun appel externe). */
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "USA CARS", template: "%s · USA CARS" },
  description: "Gestion et suivi des dossiers véhicules, des États-Unis jusqu’au port de Dakar.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
