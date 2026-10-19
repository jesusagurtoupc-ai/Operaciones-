"use client";

import { useEffect, useState } from "react";

export type Me = { username: string; rol: "admin" | "lectura" };

let cache: Promise<Me | null> | null = null;

/** Olvida el usuario guardado (se llama al iniciar o cerrar sesión). */
export function resetMe() {
  cache = null;
}

/** Devuelve el usuario en sesión (null mientras carga). */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    if (!cache) {
      cache = fetch("/api/auth/me")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d?.user as Me) ?? null)
        .catch(() => null);
    }
    let vivo = true;
    cache.then((u) => vivo && setMe(u));
    return () => {
      vivo = false;
    };
  }, []);
  return me;
}
