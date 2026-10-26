import { describe, expect, it } from "vitest";
import { actionLabel, describeChanges, objectLabel } from "./format";

describe("présentation du journal d’audit", () => {
  it("changement de rôle : avant → après en français", () => {
    expect(describeChanges({ role: "ops" }, { role: "accounting" })).toEqual([
      { field: "role", label: "Rôle", before: "Agent opérations", after: "Comptabilité" },
    ]);
  });

  it("création : champs techniques masqués", () => {
    const changes = describeChanges(null, {
      id: "x",
      email: "a@exemple.test",
      active: true,
      created_at: "2026-10-17",
    });
    expect(changes.map((c) => c.field)).toEqual(["email", "active"]);
    expect(changes.find((c) => c.field === "active")?.after).toBe("Oui");
    expect(changes[0]?.before).toBeUndefined();
  });

  it("statut de paramètre", () => {
    expect(describeChanges(null, { status: "a_confirmer", value: 48 })).toEqual([
      { field: "status", label: "Statut", before: undefined, after: "À confirmer" },
      { field: "value", label: "Valeur", before: undefined, after: "48" },
    ]);
  });

  it("libellés d’action et d’objet, avec repli sur le code", () => {
    expect(actionLabel("update")).toBe("Modification");
    expect(actionLabel("action_inconnue")).toBe("action_inconnue");
    expect(objectLabel("settings")).toBe("Paramètre");
  });
});
