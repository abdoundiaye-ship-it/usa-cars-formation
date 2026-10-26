"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

/** Lien d’accès affiché une seule fois, avec copie dans le presse-papiers. */
export function AccessLink({ link, label = "Lien d’accès" }: { link: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id={id} readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Lien copié" : "Copier le lien"}
        </Button>
      </div>
    </div>
  );
}
