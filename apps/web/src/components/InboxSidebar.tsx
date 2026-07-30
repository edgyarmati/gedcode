import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

type Route = {
  readonly to: string;
  readonly params: Readonly<Record<string, string>>;
};

type Entry = {
  readonly id: string;
  readonly title?: string;
  readonly projectId?: string;
  readonly status?: string;
  readonly route?: Route;
};

type ShelfEntry = Entry | string;

export function InboxSidebar({
  entries,
  onNavigate,
  primaryView: controlledPrimaryView,
  onPrimaryViewChange,
}: {
  readonly entries: {
    readonly normal: {
      readonly shelves: {
        readonly active: ReadonlyArray<ShelfEntry>;
        readonly snoozed: ReadonlyArray<ShelfEntry>;
        readonly settled: ReadonlyArray<ShelfEntry>;
      };
      readonly selected: (Entry & { readonly shelf?: string }) | null;
    };
    readonly orchestrator: ReadonlyArray<Entry>;
  };
  readonly onNavigate: (route: Route) => void;
  readonly primaryView?: "inbox" | "orchestrator";
  readonly onPrimaryViewChange?: (view: "inbox" | "orchestrator") => void;
}) {
  const [localPrimaryView, setLocalPrimaryView] = useState<"inbox" | "orchestrator">("inbox");
  const [category, setCategory] = useState<"normal" | "orchestrator">("normal");
  const [openShelves, setOpenShelves] = useState<ReadonlySet<string>>(() => new Set(["settled"]));
  const primaryView = controlledPrimaryView ?? localPrimaryView;
  const setPrimaryView = (view: "inbox" | "orchestrator") => {
    setLocalPrimaryView(view);
    onPrimaryViewChange?.(view);
  };
  const renderEntry = (entry: ShelfEntry, compact = false) => {
    const item = typeof entry === "string" ? { id: entry } : entry;
    const selected = entries.normal.selected?.id === item.id;
    return (
      <li key={item.id}>
        <button
          aria-current={selected ? "page" : undefined}
          className={`flex w-full min-w-0 items-center gap-2 rounded-lg text-left transition-colors hover:bg-accent ${
            compact
              ? "px-2.5 py-1.5 text-xs text-muted-foreground"
              : "border border-transparent px-2.5 py-2 text-sm aria-[current=page]:border-border aria-[current=page]:bg-accent/70"
          }`}
          type="button"
          onClick={() => item.route && onNavigate(item.route)}
        >
          {item.status ? (
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-emerald-500/80" />
          ) : null}
          <span className="min-w-0 flex-1 truncate">{item.title ?? item.id}</span>
          {item.status && !compact ? (
            <span className="shrink-0 text-[10px] capitalize text-muted-foreground">
              {item.status.replaceAll("-", " ")}
            </span>
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <div
      className={`flex min-h-0 flex-col px-2 py-2 ${
        primaryView === "inbox" ? "flex-1" : "shrink-0"
      }`}
    >
      <div
        className="relative grid h-9 grid-cols-2 rounded-full bg-muted p-1"
        data-animated-long-pill="true"
        data-testid="inbox-primary-switch"
      >
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-background shadow-sm transition-transform duration-200"
          style={{ transform: primaryView === "orchestrator" ? "translateX(100%)" : undefined }}
        />
        {(["inbox", "orchestrator"] as const).map((view) => (
          <button
            key={view}
            className="relative z-10 rounded-full text-xs font-medium"
            type="button"
            aria-pressed={primaryView === view}
            onClick={() => setPrimaryView(view)}
          >
            {view === "inbox" ? "Inbox" : "Orchestrator"}
          </button>
        ))}
      </div>

      {primaryView === "orchestrator" ? null : (
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-4 border-b border-sidebar-border/70 px-2">
            <button
              className="-mb-px border-b-2 border-transparent px-0.5 py-2 text-xs font-medium text-muted-foreground aria-pressed:border-foreground aria-pressed:text-foreground"
              type="button"
              aria-pressed={category === "normal"}
              onClick={() => setCategory("normal")}
            >
              Normal tasks
            </button>
            <button
              className="-mb-px border-b-2 border-transparent px-0.5 py-2 text-xs font-medium text-muted-foreground aria-pressed:border-foreground aria-pressed:text-foreground"
              type="button"
              aria-pressed={category === "orchestrator"}
              onClick={() => setCategory("orchestrator")}
            >
              Orchestrator tasks
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pt-2">
            {category === "orchestrator" ? (
              entries.orchestrator.length === 0 ? (
                <p className="px-2.5 py-3 text-xs text-muted-foreground">
                  No active Orchestrator tasks
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {entries.orchestrator.map((entry) => renderEntry(entry))}
                </ul>
              )
            ) : (
              <div>
                {entries.normal.shelves.active.length === 0 ? (
                  <p className="px-2.5 py-3 text-xs text-muted-foreground">No active tasks</p>
                ) : (
                  <ul className="space-y-0.5">
                    {entries.normal.shelves.active.map((entry) => renderEntry(entry))}
                  </ul>
                )}
                {entries.normal.selected?.shelf !== undefined &&
                entries.normal.selected.shelf !== "active" ? (
                  <ul aria-label="Selected normal task" className="mt-1 rounded-md bg-accent/40">
                    {renderEntry(entries.normal.selected)}
                  </ul>
                ) : null}
                {(["snoozed", "settled"] as const).map((shelf) => {
                  const shelfEntries = entries.normal.shelves[shelf];
                  if (shelfEntries.length === 0) return null;
                  const open = openShelves.has(shelf);
                  return (
                    <section className="mt-3" key={shelf}>
                      <button
                        className="flex w-full items-center gap-2 px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                        type="button"
                        aria-expanded={open}
                        onClick={() =>
                          setOpenShelves((current) => {
                            const next = new Set(current);
                            if (open) next.delete(shelf);
                            else next.add(shelf);
                            return next;
                          })
                        }
                      >
                        <ChevronDownIcon
                          className={`size-3 transition-transform ${open ? "" : "-rotate-90"}`}
                        />
                        <span>{shelf === "snoozed" ? "Snoozed" : "Settled"}</span>
                        <span className="tabular-nums text-muted-foreground/60">
                          {shelfEntries.length}
                        </span>
                        <span
                          aria-hidden
                          className={`h-px flex-1 ${
                            shelf === "snoozed" ? "bg-blue-500/35" : "bg-sidebar-border"
                          }`}
                        />
                      </button>
                      {open ? (
                        <ul className="space-y-0.5">
                          {shelfEntries.map((entry) => renderEntry(entry, true))}
                        </ul>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
