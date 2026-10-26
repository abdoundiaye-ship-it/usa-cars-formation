import { FunctionsHttpError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { reportFilters, reportsFor } from "@/lib/reports";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { REPORTS, type ReportKey } from "@/supabase/functions/_shared/reports.ts";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * US-6.1 / P6-1 : export Excel d'un rapport. Le fichier est construit par la fonction Supabase export-report, au
 * nom de l'utilisateur (la base vérifie le rôle et journalise l'export).
 */
export async function GET(request: NextRequest) {
  const access = await getInternalAccess(SCREEN_ROLES.reports);
  if (!access) return NextResponse.redirect(new URL("/acces-refuse", request.url), 303);

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const key = reportsFor(access.role).find((k) => k === params.rapport) as ReportKey | undefined;
  if (!key) return NextResponse.redirect(new URL("/acces-refuse", request.url), 303);
  const today = new Date().toISOString().slice(0, 10); // Africa/Dakar = UTC
  const filters = reportFilters(params, today);
  const period = REPORTS[key].period;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.functions.invoke<Blob>("export-report", {
    body: {
      report: key,
      ...(period === "range" ? { from: filters.from, to: filters.to } : {}),
      ...(period === "as_of" ? { asOf: filters.asOf } : {}),
    },
  });
  if (error || !(data instanceof Blob)) {
    if (error instanceof FunctionsHttpError && error.context.status === 403) {
      return NextResponse.redirect(new URL("/acces-refuse", request.url), 303);
    }
    return NextResponse.redirect(new URL(`/rapports?rapport=${key}&export=erreur`, request.url), 303);
  }

  const suffix = period === "range" ? `${filters.from}_${filters.to}` : period === "as_of" ? filters.asOf : today;
  return new NextResponse(data, {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="USA-CARS-${key.replace(/_/g, "-")}-${suffix}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
