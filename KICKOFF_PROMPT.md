# Message de lancement à coller dans Claude Code

> Les décisions de USA CARS du 17/10/2026 sont intégrées dans `docs/00_points_de_clarification.md`. Avant de lancer : cloner le dépôt GitHub, y copier ce package, et placer les clés du projet Supabase de production `hzgkhtaefpbqztwagwph` dans `.env.local` (jamais dans le message ni dans le dépôt).

---

Tu vas développer l’application de gestion et de tracking de USA CARS décrite dans ce dépôt.

1. Lis d’abord `CLAUDE.md`, puis `docs/00_points_de_clarification.md` (les réponses font foi), `docs/10_regles_metier.md`, `docs/13_workflow_statuts.md`, `docs/12_roles_permissions.md`, `docs/17_plan_phases.md`, `specs/parametres_contractuels.json` et `specs/schema_initial.sql`. Les documents source complets sont dans `docs/sources/` et le prototype dans `reference/prototype/`.
2. Avant d’écrire du code, rends-moi :
   - un résumé en 10 lignes maximum de ta compréhension du métier ;
   - la liste des contradictions ou trous que tu détectes entre les documents ;
   - les points de clarification encore ouverts qui bloquent les phases 0 et 1, et ton avis sur les interprétations I3, I4 et I5 encore à confirmer ;
   - ton plan détaillé pour la **phase 0** (structure du dépôt, dépendances, scripts, CI).
3. Attends ma validation, puis réalise la phase 0. Ensuite, phase par phase selon `docs/17_plan_phases.md`, en me présentant un plan avant chaque phase et un compte rendu à la fin (fait, hypothèses, écarts, questions).

Contraintes à respecter en permanence : montants USD en centimes entiers ; aucun coût interne ni marge visible du rôle client (garanti par RLS et testé) ; aucune valeur contractuelle en dur ; audit des actions sensibles ; données de seed fictives (`DEMO-`, `DEMU`, `@exemple.test`) ; interface en français.
