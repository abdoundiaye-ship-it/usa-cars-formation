/**
 * Fonction Supabase export-report (US-6.1, décision P6-1) : fichier Excel d'un rapport.
 *
 * Lit le rapport AU NOM DE L'UTILISATEUR (son jeton : la base vérifie le rôle, docs/12 ; la marge n'est jamais
 * calculée hors administrateur et direction), construit le fichier .xlsx et journalise l'export.
 * Exécutée ici plutôt que dans l'application : la construction d'un classeur dépasse la limite de calcul de
 * l'offre gratuite de Cloudflare Workers. Réponse en application/octet-stream (lue comme un fichier par le client).
 */
import { exportType, exportValue, isReportKey, REPORTS, reportArgs } from "../_shared/reports.ts";
import { SupabaseRest } from "../_shared/rest.ts";
import { buildXlsx } from "../_shared/xlsx.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

const frDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

Deno.serve(async (request) => {
  if (request.method !== "POST") return reply(405, { message: "Méthode non autorisée." });
  const authorization = request.headers.get("Authorization");
  if (!authorization) return reply(401, { message: "Connexion requise." });

  let body: { report?: unknown; from?: unknown; to?: unknown; asOf?: unknown };
  try {
    body = await request.json();
  } catch {
    return reply(400, { message: "Requête invalide." });
  }
  if (!isReportKey(body.report)) return reply(400, { message: "Rapport inconnu." });
  const dates = { from: body.from, to: body.to, asOf: body.asOf };
  for (const value of Object.values(dates)) {
    if (value !== undefined && value !== null && !(typeof value === "string" && DATE.test(value))) {
      return reply(400, { message: "Date invalide." });
    }
  }
  const filters = dates as { from?: string; to?: string; asOf?: string };
  const report = REPORTS[body.report];
  if (report.period === "range" && (!filters.from || !filters.to)) {
    return reply(400, { message: "Indiquez la période du rapport." });
  }

  const api = new SupabaseRest(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, authorization);
  const { data: rows, error } = await api.rpc<Record<string, unknown>[]>(report.rpc, reportArgs(body.report, filters));
  if (error) {
    if (error.code === "42501") return reply(403, { message: "Rapport non accessible avec votre rôle." });
    console.error("export-report: lecture impossible", error.message);
    return reply(500, { message: "Le rapport n’a pas pu être lu." });
  }

  const today = new Date().toISOString().slice(0, 10); // Africa/Dakar = UTC
  const period =
    report.period === "range"
      ? `Période du ${frDate(filters.from!)} au ${frDate(filters.to!)}`
      : report.period === "as_of"
        ? `Situation au ${frDate(filters.asOf ?? today)}`
        : `Situation au ${frDate(today)}`;
  const bytes = buildXlsx({
    sheetName: report.title,
    title: `USA CARS — ${report.title}`,
    subtitle: `${period} · édité le ${frDate(today)} · ${rows.length} ligne(s)`,
    columns: report.columns.map((c) => ({ label: c.label, type: exportType(c), width: c.width })),
    rows: rows.map((row) => report.columns.map((c) => exportValue(c, row))),
  });

  const { error: logError } = await api.rpc("log_report_export", {
    p_report: body.report,
    p_filters: { ...filters, lignes: rows.length },
  });
  if (logError) {
    // Règle 5 : pas d'export sans trace dans le journal d'audit.
    console.error("export-report: journalisation impossible", logError.message);
    return reply(500, { message: "L’export n’a pas pu être journalisé ; réessayez." });
  }

  return new Response(bytes as BodyInit, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
});
