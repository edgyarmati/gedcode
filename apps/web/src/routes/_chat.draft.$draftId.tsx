import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { useComposerDraftStore, DraftId } from "../composerDraftStore";
import { SidebarInset } from "../components/ui/sidebar";
import { createThreadSelectorAcrossEnvironments } from "../storeSelectors";
import { useStore } from "../store";

function DraftChatThreadRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorAcrossEnvironments(draftSession?.threadId ?? null),
      [draftSession?.threadId],
    ),
  );
  const serverThreadStarted = threadHasStarted(serverThread);
  const canonicalThreadRef = draftSession?.promotedTo
    ? serverThreadStarted
      ? draftSession.promotedTo
      : null
    : serverThread
      ? {
          environmentId: serverThread.environmentId,
          threadId: serverThread.id,
        }
      : null;
  const canonicalEnvironmentId = canonicalThreadRef?.environmentId ?? null;
  const canonicalThreadId = canonicalThreadRef?.threadId ?? null;

  useEffect(() => {
    if (!canonicalEnvironmentId || !canonicalThreadId) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: canonicalEnvironmentId,
        threadId: canonicalThreadId,
      },
      replace: true,
    });
  }, [canonicalEnvironmentId, canonicalThreadId, navigate]);

  useEffect(() => {
    if (draftSession || canonicalEnvironmentId || canonicalThreadId) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalEnvironmentId, canonicalThreadId, draftSession, navigate]);

  if (canonicalThreadRef) {
    return (
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          environmentId={canonicalThreadRef.environmentId}
          threadId={canonicalThreadRef.threadId}
          routeKind="server"
        />
      </SidebarInset>
    );
  }

  if (!draftSession) {
    return null;
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <ChatView
        draftId={draftId}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        routeKind="draft"
      />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: DraftChatThreadRouteView,
});
