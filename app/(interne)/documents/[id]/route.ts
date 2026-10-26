import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getInternalAccess } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { DOCUMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/server/documents";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Téléchargement d'un document (US-2.8) : l'accès est vérifié par la RLS de la table documents, puis
 * l'utilisateur est redirigé vers un lien signé qui expire (le bucket reste privé).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = () => NextResponse.redirect(new URL("/acces-refuse", request.url), 303);
  if (!(await getInternalAccess(SCREEN_ROLES.dossiers))) return denied();

  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new NextResponse("Document introuvable.", { status: 404 });

  const supabase = await createSupabaseServerClient();
  const { data: document } = await supabase
    .from("documents")
    .select("storage_path, file_name")
    .eq("id", id.data)
    .maybeSingle();
  if (!document) return new NextResponse("Document introuvable.", { status: 404 });

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS, { download: document.file_name });
  if (error || !data) return new NextResponse("Le document n’a pas pu être préparé. Réessayez.", { status: 502 });

  return NextResponse.redirect(data.signedUrl, 303);
}
