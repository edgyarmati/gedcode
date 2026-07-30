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
  const [openShelves, setOpenShelves] = useState<ReadonlySet<string>>(() => new Set());
  const primaryView = controlledPrimaryView ?? localPrimaryView;
  const setPrimaryView = (view: "inbox" | "orchestrator") => {
    setLocalPrimaryView(view);
    onPrimaryViewChange?.(view);
  };
  const renderEntry = (entry: ShelfEntry) => {
    const item = typeof entry === "string" ? { id: entry } : entry;
    return (
      <li key={item.id}>
        <button
          className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
          type="button"
          onClick={() => item.route && onNavigate(item.route)}
        >
          {item.title ?? item.id}
        </button>
      </li>
    );
  };

  return (
    <div
      className={`flex min-h-0 flex-col gap-3 px-2 py-2 ${
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
        <>
          <div className="grid grid-cols-2 rounded-lg bg-muted/60 p-1">
            <button
              className="rounded-md px-2 py-1 text-xs aria-pressed:bg-background"
              type="button"
              aria-pressed={category === "normal"}
              onClick={() => setCategory("normal")}
            >
              Normal tasks
            </button>
            <button
              className="rounded-md px-2 py-1 text-xs aria-pressed:bg-background"
              type="button"
              aria-pressed={category === "orchestrator"}
              onClick={() => setCategory("orchestrator")}
            >
              Orchestrator tasks
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto">
            {category === "orchestrator" ? (
              <ul className="space-y-0.5">{entries.orchestrator.map(renderEntry)}</ul>
            ) : (
              <div className="space-y-2">
                <ul className="space-y-0.5">{entries.normal.shelves.active.map(renderEntry)}</ul>
                {entries.normal.selected?.shelf !== undefined &&
                entries.normal.selected.shelf !== "active" ? (
                  <ul aria-label="Selected normal task" className="rounded-md bg-accent/50 p-0.5">
                    {renderEntry(entries.normal.selected)}
                  </ul>
                ) : null}
                {(["snoozed", "settled"] as const).map((shelf) => {
                  const open = openShelves.has(shelf);
                  return (
                    <section key={shelf}>
                      <button
                        className="flex w-full items-center gap-1 rounded px-1 py-1 text-xs font-medium text-muted-foreground"
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
                        {shelf === "snoozed" ? "Snoozed" : "Settled"}
                      </button>
                      {open ? (
                        <ul className="space-y-0.5">
                          {entries.normal.shelves[shelf].map(renderEntry)}
                        </ul>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
