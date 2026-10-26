import { ChevronRight, Folder, Search, Ship, Users, type LucideIcon } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/feedback";
import { requireInternal } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { CONTAINER_STATUS_LABELS, STAGE_LABELS } from "@/lib/dossiers/labels";
import { likePattern, normalizeQuery, SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from "@/lib/search";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Recherche" };

const LIMIT = 10;

interface Hit {
  href: Route;
  title: string;
  detail: string;
}

function Results({ title, icon: Icon, hits }: { title: string; icon: LucideIcon; hits: Hit[] }) {
  if (hits.length === 0) return null;
  return (
    <Card className="p-0 sm:p-0">
      <h2 className="flex items-center gap-2 px-4 pt-4 pb-2 font-bold sm:px-6">
        <Icon aria-hidden className="text-primary size-5" />
        {title}
        <span className="text-muted text-sm font-normal">
          {hits.length === LIMIT ? `${LIMIT} premiers` : hits.length}
        </span>
      </h2>
      <ul>
        {hits.map((hit) => (
          <li key={hit.href} className="border-border border-t">
            <Link href={hit.href} className="hover:bg-background flex items-center gap-3 px-4 py-3 sm:px-6">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{hit.title}</span>
                <span className="text-muted block truncate text-sm">{hit.detail}</span>
              </span>
              <ChevronRight aria-hidden className="text-muted size-4 shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Recherche globale (barre supérieure) : dossiers (référence, VIN, lot, client), clients (nom, téléphone, e-mail),
 * conteneurs (numéro, B/L). Lecture sous RLS : chacun ne trouve que ce qu'il peut lire.
 */
export default async function RecherchePage({ searchParams }: PageProps<"/recherche">) {
  await requireInternal(SCREEN_ROLES.dashboard);
  const params = await searchParams;
  const raw = typeof params.q === "string" ? params.q : "";
  const q = normalizeQuery(raw);

  let dossiers: Hit[] = [];
  let clients: Hit[] = [];
  let containers: Hit[] = [];
  let failed = false;

  if (q) {
    const p = likePattern(q);
    const supabase = await createSupabaseServerClient();
    const [clientRes, containerRes] = await Promise.all([
      supabase
        .from("clients")
        .select("id, name, notify_phone, notify_email")
        .or(`name.ilike.${p},notify_phone.ilike.${p},notify_email.ilike.${p}`)
        .order("name")
        .limit(LIMIT),
      supabase
        .from("containers")
        .select("id, number, bl_number, status, port_of_loading")
        .or(`number.ilike.${p},bl_number.ilike.${p}`)
        .order("number")
        .limit(LIMIT),
    ]);
    const clientIds = (clientRes.data ?? []).map((c) => c.id);
    const clientFilter = clientIds.length ? `,client_id.in.(${clientIds.join(",")})` : "";
    const dossierRes = await supabase
      .from("dossiers")
      .select("id, reference, stage, make, model, model_year, vin, clients(name)")
      .or(`reference.ilike.${p},vin.ilike.${p},lot_number.ilike.${p}${clientFilter}`)
      .order("updated_at", { ascending: false })
      .limit(LIMIT);
    failed = Boolean(clientRes.error || containerRes.error || dossierRes.error);

    dossiers = (dossierRes.data ?? []).map((d) => ({
      href: `/dossiers/${d.id}` as Route,
      title: d.reference,
      detail: [
        d.clients?.name,
        [d.make, d.model, d.model_year].filter(Boolean).join(" ") || null,
        STAGE_LABELS[d.stage],
        d.vin ? `VIN ${d.vin}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }));
    clients = (clientRes.data ?? []).map((c) => ({
      href: `/clients/${c.id}` as Route,
      title: c.name,
      detail: [c.notify_phone, c.notify_email].filter(Boolean).join(" · "),
    }));
    containers = (containerRes.data ?? []).map((c) => ({
      href: `/conteneurs/${c.id}` as Route,
      title: c.number,
      detail: [CONTAINER_STATUS_LABELS[c.status], c.port_of_loading, c.bl_number ? `B/L ${c.bl_number}` : null]
        .filter(Boolean)
        .join(" · "),
    }));
  }
  const total = dossiers.length + clients.length + containers.length;

  return (
    <>
      <PageHeader title="Recherche" description="Dossier, VIN, n° de lot, client, téléphone, conteneur ou B/L." />
      <form action="/recherche" role="search" className="mb-6 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="recherche-page" className="sr-only">
          Rechercher
        </label>
        <div className="border-border bg-card focus-within:outline-primary flex min-h-11 flex-1 items-center gap-2 rounded-lg border px-3 focus-within:outline-2">
          <Search aria-hidden className="text-muted size-5 shrink-0" />
          <input
            id="recherche-page"
            name="q"
            type="search"
            defaultValue={raw}
            maxLength={SEARCH_MAX_LENGTH}
            placeholder="Ex. DEMO-2026-0003, Diallo, DEMU2468135"
            className="placeholder:text-muted w-full bg-transparent outline-none"
          />
        </div>
        <Button type="submit">Rechercher</Button>
      </form>

      {!q ? (
        <EmptyState title="Que cherchez-vous ?" icon={Search}>
          Saisissez au moins {SEARCH_MIN_LENGTH} caractères.
        </EmptyState>
      ) : failed ? (
        <Alert tone="danger">La recherche n’a pas pu aboutir. Réessayez dans un instant.</Alert>
      ) : total === 0 ? (
        <EmptyState title={`Aucun résultat pour « ${q} »`} icon={Search}>
          Vérifiez l’orthographe ou cherchez une partie de la référence.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <Results title="Dossiers" icon={Folder} hits={dossiers} />
          <Results title="Clients" icon={Users} hits={clients} />
          <Results title="Conteneurs" icon={Ship} hits={containers} />
        </div>
      )}
    </>
  );
}
