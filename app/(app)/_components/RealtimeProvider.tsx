"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSocket } from "@/lib/realtime/client";

export function RealtimeProvider() {
  const router = useRouter();
  const pathname = usePathname();
  const routerRef = useRef(router);
  const pathRef = useRef(pathname);

  useEffect(() => {
    routerRef.current = router;
    pathRef.current = pathname;
  });

  useEffect(() => {
    const socket = getSocket();

    const refresh = () => {
      routerRef.current.refresh();
    };
    const onRevoked = () => {
      // A full load drops the cached app page. A client navigation can be
      // sent back to "/" while the revoked cookie is still stored.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- revoked sessions must not reuse the cached page
      window.location.assign("/login");
    };

    // Access to a sheet or workspace was taken away: leave it if it's open.
    const onAccessRevoked = (payload: { sheetIds?: string[]; workspaceId?: string }) => {
      const path = pathRef.current;
      const openSheet = path.match(/^\/s\/([^/]+)/)?.[1];
      const openWorkspace = path.match(/^\/w\/([^/]+)/)?.[1];
      const lost =
        (openSheet && payload.sheetIds?.includes(openSheet)) ||
        (openWorkspace && payload.workspaceId === openWorkspace);
      if (lost) {
        // A full load avoids a refresh racing the redirect on the page that's gone.
        window.location.assign("/");
        return;
      }
      routerRef.current.refresh();
    };

    socket.on("sheets:changed", refresh);
    socket.on("user:updated", refresh);
    socket.on("workspaces:changed", refresh);
    socket.on("access:changed", refresh);
    socket.on("access:revoked", onAccessRevoked);
    socket.on("session:revoked", onRevoked);

    return () => {
      socket.off("sheets:changed", refresh);
      socket.off("user:updated", refresh);
      socket.off("workspaces:changed", refresh);
      socket.off("access:changed", refresh);
      socket.off("access:revoked", onAccessRevoked);
      socket.off("session:revoked", onRevoked);
    };
  }, []);

  return null;
}
