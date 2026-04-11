"use client";

import { useEffect, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import type { StickyProfileHeaderData } from "@/components/StickyProfileHeader";

export type Profile = StickyProfileHeaderData;

/** 拉取 /api/profile，失败时返回 null（统一带超时与 credentials）。 */
export function useProfile(): Profile | null {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchWithTimeout("/api/profile", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Profile | null) => {
        if (!cancelled) setProfile(data ?? null);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return profile;
}
