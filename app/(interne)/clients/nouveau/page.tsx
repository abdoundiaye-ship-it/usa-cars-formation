import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui/feedback";
import { requireInternal } from "@/lib/auth/access";
import { SCREEN_ROLES } from "@/lib/auth/roles";
import { ClientForm } from "../client-form";

export const metadata: Metadata = { title: "Nouveau client" };

export default async function NouveauClientPage() {
  await requireInternal(SCREEN_ROLES.operationsWrite);
  return (
    <>
      <PageHeader
        title="Nouveau client"
        description="Le numéro WhatsApp sert aux notifications et à la validation des documents (contrat, art. 17 et 31)."
      />
      <Card>
        <ClientForm />
      </Card>
    </>
  );
}
