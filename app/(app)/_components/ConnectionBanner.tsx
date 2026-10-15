"use client";

import { useEffect, useState } from "react";
import { getSocket } from "@/lib/realtime/client";

type BannerPhase = "hidden" | "reconnecting" | "lost";

export function ConnectionBanner() {
  const [phase, setPhase] = useState<BannerPhase>("hidden");

  useEffect(() => {
    const socket = getSocket();
    let shortTimer = 0;
    let longTimer = 0;
    let armed = false;

    const clearTimers = () => {
      window.clearTimeout(shortTimer);
      window.clearTimeout(longTimer);
    };
    const arm = () => {
      if (armed || socket.connected) {
        return;
      }
      armed = true;
      shortTimer = window.setTimeout(() => setPhase("reconnecting"), 2000);
      longTimer = window.setTimeout(() => setPhase("lost"), 15000);
    };
    const onConnect = () => {
      armed = false;
      clearTimers();
      setPhase("hidden");
    };

    socket.on("disconnect", arm);
    socket.on("connect_error", arm);
    socket.on("connect", onConnect);
    if (!socket.connected) {
      arm();
    }

    return () => {
      clearTimers();
      socket.off("disconnect", arm);
      socket.off("connect_error", arm);
      socket.off("connect", onConnect);
    };
  }, []);

  if (phase === "hidden") {
    return null;
  }

  return (
    <p role="status" className="bg-amber-50 px-3 py-1 text-center text-sm text-amber-900">
      {phase === "lost" ? "Connection lost. Your changes are kept and will sync." : "Reconnecting…"}
    </p>
  );
}
