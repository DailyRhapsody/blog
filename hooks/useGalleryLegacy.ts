"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

export type GalleryLegacyItem = {
  id: number;
  createdAt: string;
  isPublic?: boolean;
  images: string[];
};

/** 拉取 /api/gallery 旧版相册条目；失败时返回空数组。组件卸载后忽略 setState 避免泄漏。 */
export function useGalleryLegacy(): {
  items: GalleryLegacyItem[];
  refresh: () => void;
} {
  const [items, setItems] = useState<GalleryLegacyItem[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    fetchWithTimeout("/api/gallery", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!mountedRef.current) return;
        setItems(Array.isArray(data) ? (data as GalleryLegacyItem[]) : []);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setItems([]);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, refresh };
}
