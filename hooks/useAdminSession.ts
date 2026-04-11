"use client";

import { useEffect, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

/** 拉取 /api/auth/session 判断是否管理员；返回 ok + loading。 */
export function useAdminSession(): { isAdmin: boolean; loading: boolean } {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetchWithTimeout("/api/auth/session", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { ok: false }))
      .then((data: { ok?: boolean }) => {
        if (!cancelled) setIsAdmin(!!data?.ok);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { isAdmin, loading };
}
