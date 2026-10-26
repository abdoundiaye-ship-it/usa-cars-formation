import { Badge, Card, EmptyState } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { COST_CATEGORY_LABELS, SECTION_LABELS } from "@/lib/finance/labels";
import { dossierMargin, type SectionMargin } from "@/lib/finance/margin";
import { formatUsd } from "@/lib/format";
import type { DossierForfaitsRow, InternalCostRow } from "@/lib/supabase/database.types";
import { DeleteCostButton, ForfaitsForm, InternalCostForm } from "../finance-forms";

const usdOrDash = (cents: number | null) => (cents === null ? "—" : formatUsd(cents));

function MarginLine({ label, m }: { label: string; m: SectionMargin }) {
  return (
    <tr>
      <Td>{label}</Td>
      <Td className="amount text-right">{usdOrDash(m.forfaitCents)}</Td>
      <Td className="amount text-right">{formatUsd(m.costsCents)}</Td>
      <Td
        className={`amount text-right ${m.marginCents !== null && m.marginCents < 0 ? "text-danger font-medium" : ""}`}
      >
        {usdOrDash(m.marginCents)}
        {m.marginPercent !== null && (
          <span className="text-muted text-xs"> ({m.marginPercent.toLocaleString("fr-FR")} %)</span>
        )}
      </Td>
    </tr>
  );
}

/**
 * US-3.1 / US-3.2 : forfaits saisis par l'agent (I4) et structure interne des coûts, avec la marge implicite.
 * Bloc INTERNE (CLAUDE.md règle 2) : la page n'est accessible qu'aux rôles internes et la RLS exclut le client.
 */
export function FinanceSection({
  dossierId,
  forfaits,
  costs,
  canEdit,
}: {
  dossierId: string;
  forfaits: DossierForfaitsRow | null;
  costs: InternalCostRow[];
  canEdit: boolean;
}) {
  const margin = dossierMargin(forfaits, costs);
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Forfaits et coûts internes</h2>
        <Badge tone="warning">Interne — jamais visible du client</Badge>
      </div>

      {canEdit ? (
        <ForfaitsForm dossierId={dossierId} forfaits={forfaits} />
      ) : (
        <p className="text-sm">
          Forfait A : {usdOrDash(forfaits?.forfait_a_cents ?? null)} · Forfait B :{" "}
          {usdOrDash(forfaits?.forfait_b_cents ?? null)}
          {forfaits?.insurance_cents != null && ` · Assurance : ${formatUsd(forfaits.insurance_cents)}`}
        </p>
      )}

      <h3 className="font-medium">Marge implicite (information interne)</h3>
      <Table caption="Marge implicite par section">
        <thead>
          <tr>
            <Th>Section</Th>
            <Th className="text-right">Forfait</Th>
            <Th className="text-right">Coûts</Th>
            <Th className="text-right">Marge</Th>
          </tr>
        </thead>
        <tbody>
          <MarginLine label="A — Acquisition" m={margin.A} />
          <MarginLine label="B — Logistique et maritime" m={margin.B} />
          <MarginLine label="Total" m={margin.total} />
        </tbody>
      </Table>

      <h3 className="font-medium">Structure des coûts</h3>
      {costs.length === 0 ? (
        <EmptyState title="Aucun coût saisi">Facultatif, mais recommandé pour suivre la marge (US-3.1).</EmptyState>
      ) : (
        <Table caption="Coûts internes">
          <thead>
            <tr>
              <Th>Poste</Th>
              <Th className="text-right">Montant</Th>
              <Th className="hidden sm:table-cell">État</Th>
              {canEdit && <Th>Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {(["A", "B"] as const).flatMap((section) =>
              costs
                .filter((c) => c.section === section)
                .map((c) => (
                  <tr key={c.id}>
                    <Td>
                      {COST_CATEGORY_LABELS[c.category]}
                      <p className="text-muted text-xs">
                        {SECTION_LABELS[section]}
                        {c.label && ` · ${c.label}`}
                      </p>
                    </Td>
                    <Td className="amount text-right">{formatUsd(c.amount_cents)}</Td>
                    <Td className="hidden sm:table-cell">{c.status === "final" ? "Définitif" : "Estimé"}</Td>
                    {canEdit && (
                      <Td>
                        <details>
                          <summary className="text-primary cursor-pointer text-xs">Modifier</summary>
                          <div className="mt-2">
                            <InternalCostForm dossierId={dossierId} cost={c} />
                          </div>
                        </details>
                        <DeleteCostButton
                          dossierId={dossierId}
                          costId={c.id}
                          label={COST_CATEGORY_LABELS[c.category]}
                        />
                      </Td>
                    )}
                  </tr>
                )),
            )}
          </tbody>
        </Table>
      )}
      {canEdit && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Ajouter un coût…</summary>
          <div className="mt-3">
            <InternalCostForm dossierId={dossierId} />
          </div>
        </details>
      )}
    </Card>
  );
}
