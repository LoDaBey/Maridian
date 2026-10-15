"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/realtime/client";

export function RealtimeProvider() {
  const router = useRouter();
  const routerRef = useRef(router);

  useEffect(() => {
    routerRef.current = router;
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

    socket.on("sheets:changed", refresh);
    socket.on("user:updated", refresh);
    socket.on("session:revoked", onRevoked);

    return () => {
      socket.off("sheets:changed", refresh);
      socket.off("user:updated", refresh);
      socket.off("session:revoked", onRevoked);
    };
  }, []);

  return null;
}
