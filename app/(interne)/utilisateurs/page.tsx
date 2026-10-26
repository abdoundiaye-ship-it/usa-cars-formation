import type { Metadata } from "next";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui/feedback";
import { Table, Td, Th } from "@/components/ui/table";
import { requireInternal } from "@/lib/auth/access";
import { isInternalRole, ROLE_LABELS, SCREEN_ROLES } from "@/lib/auth/roles";
import { formatDateTime } from "@/lib/format";
import { listAuthUsersSummary, type AuthUserSummary } from "@/lib/server/users";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AccessLinkForm, ActiveToggle, InviteUserForm, ResendInviteForm, RoleForm } from "./user-forms";

export const metadata: Metadata = { title: "Utilisateurs" };

export default async function UtilisateursPage() {
  const access = await requireInternal(SCREEN_ROLES.users);
  const isAdmin = access.role === "admin";

  const supabase = await createSupabaseServerClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, active, created_at")
    .order("full_name");
  const authUsers: Map<string, AuthUserSummary> = isAdmin ? await listAuthUsersSummary() : new Map();

  return (
    <>
      <PageHeader
        title="Utilisateurs"
        description={
          isAdmin
            ? "Invitez les membres de l’équipe et attribuez-leur un rôle. Chaque modification est journalisée."
            : "Liste des comptes (consultation)."
        }
      />

      {isAdmin && (
        <Card className="mb-6">
          <h2 className="mb-4 font-semibold">Créer un utilisateur</h2>
          <InviteUserForm />
        </Card>
      )}

      {error ? (
        <Alert tone="danger">La liste des utilisateurs n’a pas pu être chargée. Rechargez la page.</Alert>
      ) : !profiles?.length ? (
        <EmptyState title="Aucun utilisateur">Invitez un premier utilisateur avec le formulaire ci-dessus.</EmptyState>
      ) : (
        <Table caption="Utilisateurs de l’application">
          <thead>
            <tr>
              <Th>Utilisateur</Th>
              <Th>Rôle</Th>
              <Th>État</Th>
              {isAdmin && <Th>Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const auth = authUsers.get(p.id);
              const neverSignedIn = isAdmin && auth !== undefined && !auth.lastSignInAt;
              const self = p.id === access.userId;
              return (
                <tr key={p.id}>
                  <Td>
                    <p className="font-medium">
                      {p.full_name}
                      {self && <span className="text-muted"> (vous)</span>}
                    </p>
                    <p className="text-muted text-xs break-all">{p.email}</p>
                    {auth?.lastSignInAt && (
                      <p className="text-muted text-xs">Dernière connexion : {formatDateTime(auth.lastSignInAt)}</p>
                    )}
                  </Td>
                  <Td>
                    {isAdmin && !self && isInternalRole(p.role) ? (
                      <RoleForm userId={p.id} role={p.role} name={p.full_name} />
                    ) : (
                      <span>{ROLE_LABELS[p.role]}</span>
                    )}
                  </Td>
                  <Td>
                    {!p.active ? (
                      <Badge tone="danger">Désactivé</Badge>
                    ) : neverSignedIn ? (
                      <Badge tone="warning">Invitation envoyée</Badge>
                    ) : (
                      <Badge tone="success">Actif</Badge>
                    )}
                  </Td>
                  {isAdmin && (
                    <Td>
                      {self ? (
                        <span className="text-muted text-xs">—</span>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <ActiveToggle
                            key={`${p.id}-${p.active}`}
                            userId={p.id}
                            active={p.active}
                            name={p.full_name}
                          />
                          {p.active && <AccessLinkForm userId={p.id} />}
                          {neverSignedIn && p.active && <ResendInviteForm userId={p.id} />}
                        </div>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
