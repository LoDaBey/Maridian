"use client";

import { ProtectionProvider } from "@/components/grid/ProtectionContext";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { SaveStatus } from "@/app/(app)/_components/SaveStatus";
import { Grid } from "@/components/grid/Grid";
import { ItemCard } from "@/components/item/ItemCard";
import { MeProvider } from "@/components/grid/MeContext";
import type { SheetViewer } from "@/components/grid/types";
import { subscribeSheetToast, useSheetDispatch, useSheetSession } from "@/lib/realtime/sheet-session";
import { ensurePresenceListening } from "@/stores/presence-store";
import { SheetStoreContext } from "@/stores/sheet-store";

export function SheetClient({
  sheetId,
  workbookId,
  workbookName,
  me,
}: {
  sheetId: string;
  workbookId: string;
  workbookName: string;
  me: SheetViewer;
}) {
  ensurePresenceListening();
  const store = useSheetSession(sheetId, me.id);

  if (!store) {
    return (
      <MeProvider me={me}>
        <p className="p-6 text-sm text-muted">Loading sheet…</p>
      </MeProvider>
    );
  }

  return (
    <MeProvider me={me}>
      <SheetStoreContext.Provider value={store}>
        <SheetSessionView sheetId={sheetId} workbookId={workbookId} workbookName={workbookName} />
      </SheetStoreContext.Provider>
    </MeProvider>
  );
}

function SheetSessionView({
  sheetId,
  workbookId,
  workbookName,
}: {
  sheetId: string;
  workbookId: string;
  workbookName: string;
}) {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef(0);
  const router = useRouter();
  const searchParams = useSearchParams();
  const itemId = searchParams.get("item");
  const dispatch = useSheetDispatch();
  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setToast(null);
    }, 4000);
  }, []);

  useEffect(() => {
    return subscribeSheetToast(sheetId, showToast);
  }, [sheetId, showToast]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProtectionProvider sheetId={sheetId}>
      <Grid
        sheetId={sheetId}
        workbookId={workbookId}
        workbookName={workbookName}
        onToast={showToast}
        onOpenItem={(rowId) => router.replace(`/s/${sheetId}?item=${rowId}`)}
      />
      <AnimatePresence>
        {itemId ? (
          <ItemCard
            key="item-sidebar"
            sheetId={sheetId}
            rowId={itemId}
            onClose={() => router.replace(`/s/${sheetId}`)}
            onCommit={(rowId, columnId, value) => dispatch("cell.set", { rowId, columnId, value })}
            onInvalid={showToast}
          />
        ) : null}
      </AnimatePresence>
      </ProtectionProvider>
      <SaveStatus />
      {toast ? (
        <p
          role="status"
          className="fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-text px-3 py-2 text-sm text-white shadow"
        >
          {toast}
        </p>
      ) : null}
    </div>
  );
}
