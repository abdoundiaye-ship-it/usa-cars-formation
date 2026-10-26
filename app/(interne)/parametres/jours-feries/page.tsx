import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { requireInternal } from "@/lib/auth/access";
import { canAccess, SCREEN_ROLES } from "@/lib/auth/roles";
import { formatDate } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DeleteHolidayButton, HolidayForm } from "./holiday-forms";

export const metadata: Metadata = { title: "Jours fériés" };

/** Fêtes à date lunaire : dates annoncées chaque année, à saisir par l'administrateur. */
const LUNAR_HOLIDAYS = ["Tamkharit", "Maouloud", "Korité", "Tabaski", "Grand Magal"];

/**
 * Calendrier des jours fériés (décision du 20/10/2026) : les délais en jours ouvrés (remboursements, remise des
 * documents) excluent les week-ends et ces dates.
 */
export default async function JoursFeriesPage() {
  const access = await requireInternal(SCREEN_ROLES.settings);
  const canWrite = canAccess(access.role, SCREEN_ROLES.holidaysWrite);
  const supabase = await createSupabaseServerClient();
  const year = new Date().getUTCFullYear();
  const { data: holidays, error } = await supabase
    .from("public_holidays")
    .select("*")
    .gte("day", `${year}-01-01`)
    .order("day");
  const thisYear = (holidays ?? []).filter((h) => h.day.startsWith(String(year)));
  const missing = LUNAR_HOLIDAYS.filter((name) => !thisYear.some((h) => h.label.includes(name)));

  return (
    <>
      <PageHeader
        title="Jours fériés"
        description="Exclus, avec les week-ends, des délais en jours ouvrés : remboursements et remise des documents."
      >
        <Link href="/parametres" className="text-primary text-sm font-medium underline">
          ← Paramètres
        </Link>
      </PageHeader>
      <div className="flex flex-col gap-6">
        {missing.length > 0 && (
          <Alert tone="warning">
            Fêtes à date lunaire non encore saisies pour {year} : {missing.join(", ")}. Ajoutez-les dès que leur date
            est annoncée.
          </Alert>
        )}
        {canWrite && (
          <Card className="flex flex-col gap-4">
            <h2 className="font-semibold">Ajouter un jour férié</h2>
            <HolidayForm />
          </Card>
        )}
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">Calendrier</h2>
          {error ? (
            <Alert tone="danger">Le calendrier n’a pas pu être chargé. Rechargez la page.</Alert>
          ) : !holidays?.length ? (
            <EmptyState title="Aucun jour férié à venir" />
          ) : (
            <Table caption="Jours fériés à partir de cette année">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Fête</Th>
                  {canWrite && <Th>Actions</Th>}
                </tr>
              </thead>
              <tbody>
                {holidays.map((h) => (
                  <tr key={h.day}>
                    <Td className="whitespace-nowrap">{formatDate(`${h.day}T12:00:00Z`)}</Td>
                    <Td>{h.label}</Td>
                    {canWrite && (
                      <Td>
                        <DeleteHolidayButton day={h.day} label={h.label} />
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
