import { Plus, Search, Users } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert, Badge, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Input } from "@/components/ui/field";
import { Table, Td, Th } from "@/components/ui/table";
import { requireInternal } from "@/lib/auth/access";
import { canAccess, SCREEN_ROLES } from "@/lib/auth/roles";
import { CLIENT_KIND_LABELS } from "@/lib/dossiers/labels";
import { likePattern, normalizeQuery } from "@/lib/search";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { missingClientInformation } from "@/lib/validation/operations";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const access = await requireInternal(SCREEN_ROLES.clients);
  const canWrite = canAccess(access.role, SCREEN_ROLES.operationsWrite);
  const params = await searchParams;
  const rawQ = typeof params.q === "string" ? params.q : "";
  const q = normalizeQuery(rawQ);

  const supabase = await createSupabaseServerClient();
  let query = supabase.from("clients").select("*").order("name").limit(200);
  if (q) {
    const p = likePattern(q);
    query = query.or(`name.ilike.${p},notify_phone.ilike.${p},notify_email.ilike.${p}`);
  }
  const { data: clients, error } = await query;

  return (
    <>
      <PageHeader title="Clients" description="Fiches des clients (particuliers et sociétés).">
        {canWrite && (
          <Link href="/clients/nouveau" className={buttonClasses("primary")}>
            <Plus aria-hidden />
            Nouveau client
          </Link>
        )}
      </PageHeader>

      <form role="search" className="mb-4 flex flex-col gap-2 sm:flex-row" action="/clients">
        <label htmlFor="q" className="sr-only">
          Rechercher un client
        </label>
        <Input id="q" name="q" defaultValue={rawQ} placeholder="Nom, téléphone ou e-mail" className="sm:max-w-sm" />
        <Button type="submit" variant="secondary">
          <Search aria-hidden />
          Rechercher
        </Button>
      </form>

      {error ? (
        <Alert tone="danger">La liste des clients n’a pas pu être chargée. Rechargez la page.</Alert>
      ) : !clients?.length ? (
        <EmptyState title={q ? "Aucun client trouvé" : "Aucun client"} icon={Users}>
          {q ? "Essayez avec une autre partie du nom ou du numéro." : canWrite && "Créez la première fiche client."}
        </EmptyState>
      ) : (
        <Table caption="Clients">
          <thead>
            <tr>
              <Th>Client</Th>
              <Th className="hidden sm:table-cell">Type</Th>
              <Th>WhatsApp</Th>
              <Th className="hidden md:table-cell">Fiche</Th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const missing = missingClientInformation(c);
              return (
                <tr key={c.id}>
                  <Td>
                    <Link
                      href={`/clients/${c.id}` as Route}
                      className="text-primary font-medium underline-offset-2 hover:underline"
                    >
                      {c.name}
                    </Link>
                    {c.notify_email && <p className="text-muted text-xs break-all">{c.notify_email}</p>}
                  </Td>
                  <Td className="hidden sm:table-cell">{CLIENT_KIND_LABELS[c.kind]}</Td>
                  <Td className="whitespace-nowrap">{c.notify_phone}</Td>
                  <Td className="hidden md:table-cell">
                    {missing.length ? (
                      <Badge tone="warning">À compléter</Badge>
                    ) : (
                      <Badge tone="success">Complète</Badge>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
