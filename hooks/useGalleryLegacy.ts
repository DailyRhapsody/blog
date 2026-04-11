"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

export type GalleryLegacyItem = {
  id: number;
  createdAt: string;
  isPublic?: boolean;
  images: string[];
};

/** 拉取 /api/gallery 旧版相册条目；失败时返回空数组。 */
export function useGalleryLegacy(): {
  items: GalleryLegacyItem[];
  refresh: () => void;
} {
  const [items, setItems] = useState<GalleryLegacyItem[]>([]);

  const refresh = useCallback(() => {
    fetchWithTimeout("/api/gallery", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        setItems(Array.isArray(data) ? (data as GalleryLegacyItem[]) : []);
      })
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, refresh };
}
