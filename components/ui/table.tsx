import { cn } from "@/lib/utils";

/** Tableau à défilement horizontal interne : la page elle-même ne défile jamais horizontalement (400 px). */
export function Table({
  className,
  caption,
  children,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { caption?: string }) {
  return (
    <div className="border-border bg-card w-full overflow-x-auto rounded-xl border">
      <table className={cn("w-full border-collapse text-left text-sm", className)} {...props}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "border-border bg-background text-muted border-b px-3 py-2.5 text-xs font-semibold tracking-wide uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-border border-b px-3 py-2.5 align-top", className)} {...props} />;
}
