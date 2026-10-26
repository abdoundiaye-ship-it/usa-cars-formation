import { BrandFooter } from "./brand-footer";
import { BrandLogo } from "./brand-logo";

/** Mise en page des écrans d’authentification (centrés, lisibles dès 400 px). */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div>
        <BrandLogo priority className="h-20" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-muted mt-2 text-sm">{description}</p>}
      </div>
      <div className="border-border bg-card rounded-xl border p-4 sm:p-6">{children}</div>
      <BrandFooter className="mt-2" />
    </main>
  );
}
