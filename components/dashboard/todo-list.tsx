"use client";

import { CircleCheck } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { SEVERITY_DISPLAY } from "@/components/dashboard/severity";
import { Badge } from "@/components/ui/feedback";
import type { Severity, TodoItem } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

const FILTERS: (Severity | "all")[] = ["all", "danger", "warning", "info"];

/** Liste « À traiter » (US-2.9), triée par gravité, filtrable par urgence. */
export function TodoList({ items }: { items: TodoItem[] }) {
  const [filter, setFilter] = useState<Severity | "all">("all");
  const count = (f: Severity | "all") => (f === "all" ? items.length : items.filter((i) => i.severity === f).length);
  const shown = filter === "all" ? items : items.filter((i) => i.severity === filter);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <span
          aria-hidden
          className="bg-success-soft text-success flex size-10 items-center justify-center rounded-full"
        >
          <CircleCheck className="size-5" />
        </span>
        <p className="font-semibold">Rien à traiter</p>
        <p className="text-muted text-sm">Aucune échéance dépassée ni alerte de suivi.</p>
      </div>
    );
  }

  return (
    <>
      <div role="group" aria-label="Filtrer par urgence" className="flex flex-wrap gap-2 px-4 pb-3 sm:px-6">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold transition-colors",
              filter === f
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-background",
            )}
          >
            {f === "all" ? "Tout" : SEVERITY_DISPLAY[f].label} · {count(f)}
          </button>
        ))}
      </div>
      <ul>
        {shown.map((item) => {
          const severity = SEVERITY_DISPLAY[item.severity];
          return (
            <li
              key={`${item.kind}-${item.href}`}
              className="border-border flex flex-col gap-1.5 border-t px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
            >
              <Badge tone={severity.tone} icon={severity.icon} className="self-start sm:w-24 sm:self-center">
                {severity.label}
              </Badge>
              <span className="min-w-0 flex-1 text-sm">
                <Link
                  href={item.href as Route}
                  className="text-primary font-semibold underline-offset-2 hover:underline"
                >
                  {item.subject}
                </Link>
                <span className="text-muted"> · </span>
                {item.label}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
