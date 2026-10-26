import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getClientAccess } from "@/lib/auth/access";
import { DOCUMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/server/documents";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Portail — téléchargement d'un document visible du client (US-4.3) : la RLS (table et bucket) ne laisse passer
 * que ses documents marqués « visible client » ; lien signé qui expire, bucket privé.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getClientAccess())) return NextResponse.redirect(new URL("/connexion/client", request.url), 303);
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new NextResponse("Document introuvable.", { status: 404 });

  const supabase = await createSupabaseServerClient();
  const { data: document } = await supabase
    .from("documents")
    .select("storage_path, file_name")
    .eq("id", id.data)
    .eq("visible_client", true)
    .maybeSingle();
  if (!document) return new NextResponse("Document introuvable.", { status: 404 });

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS, { download: document.file_name });
  if (error || !data) return new NextResponse("Le document n’a pas pu être préparé. Réessayez.", { status: 502 });
  return NextResponse.redirect(data.signedUrl, 303);
}
