"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type NominatimSearchItem = {
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    suburb?: string;
    road?: string;
    neighbourhood?: string;
  };
};

function simplifyLocation(item: NominatimSearchItem): string {
  const addr = item.address ?? {};
  const city = addr.city || addr.town || addr.village || addr.county || addr.state || "";
  const area = addr.suburb || addr.neighbourhood || "";
  const road = addr.road || "";
  const compact = [city, area, road].filter(Boolean).join("·");
  return compact || item.display_name.split(",").slice(0, 3).join("·");
}

export default function LocationPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(value);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [searchItems, setSearchItems] = useState<NominatimSearchItem[]>([]);
  const [nearbyOptions, setNearbyOptions] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setSelected(value);
      setQuery("");
      setNearbyOptions([]);
      setSearchItems([]);
    }
  }, [value, open]);

  const locateNow = useCallback(async () => {
    if (!navigator.geolocation) {
      setError("当前浏览器不支持定位");
      return;
    }
    setLocating(true);
    setError("");
    setNearbyOptions([]);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const url = new URL("https://nominatim.openstreetmap.org/reverse");
          url.searchParams.set("format", "jsonv2");
          url.searchParams.set("addressdetails", "1");
          url.searchParams.set("accept-language", "zh-CN");
          url.searchParams.set("lat", String(pos.coords.latitude));
          url.searchParams.set("lon", String(pos.coords.longitude));
          const res = await fetch(url.toString());
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as NominatimSearchItem;
          const addr = data.address ?? {};
          const city = addr.city || addr.town || addr.village || addr.county || addr.state || "";
          const area = addr.suburb || addr.neighbourhood || "";
          const road = addr.road || "";
          const options = [
            [city, area].filter(Boolean).join("·"),
            [city, area, road].filter(Boolean).join("·"),
            simplifyLocation(data),
          ].filter(Boolean);
          const unique = Array.from(new Set(options));
          setNearbyOptions(unique);
          if (unique[0] && !selected) setSelected(unique[0]);
        } catch {
          setError("定位成功，但地址解析失败");
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setError("定位失败，请检查浏览器定位权限");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [selected]);

  useEffect(() => {
    if (!open) return;
    void locateNow();
  }, [locateNow, open]);

  function openPicker() {
    setOpen(true);
    setSelected(value);
    setQuery("");
    setError("");
  }

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setSearchItems([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      setError("");
      try {
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("addressdetails", "1");
        url.searchParams.set("limit", "6");
        url.searchParams.set("accept-language", "zh-CN");
        url.searchParams.set("q", q);
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as NominatimSearchItem[];
        setSearchItems(Array.isArray(data) ? data : []);
      } catch {
        setSearchItems([]);
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [query, open]);

  const dedupSearch = useMemo<string[]>(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const item of searchItems) {
      const text = simplifyLocation(item);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      list.push(text);
    }
    return list.slice(0, 6);
  }, [searchItems]);

  const allOptions = useMemo(() => {
    const combined = [...nearbyOptions, ...dedupSearch].filter(Boolean);
    return Array.from(new Set(combined)).slice(0, 10);
  }, [nearbyOptions, dedupSearch]);

  function applySelection() {
    const finalValue = selected.trim();
    onChange(finalValue);
    setOpen(false);
  }

  function cancelSelection() {
    setOpen(false);
    setError("");
  }

  function clearSelection() {
    onChange("");
    setOpen(false);
    setError("");
  }

  return (
    <div className="space-y-2">
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          {value ? (
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              📍 {value}
            </span>
          ) : (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">未添加位置</span>
          )}
          <button
            type="button"
            onClick={openPicker}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {value ? "修改位置" : "添加位置"}
          </button>
          {value && (
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              清除
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索地点（至少 2 个字）"
              className="w-full max-w-xs rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:text-zinc-50"
            />
            <button
              type="button"
              onClick={locateNow}
              disabled={locating}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {locating ? "定位中…" : "刷新附近地点"}
            </button>
          </div>

          {(locating || searching) && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {locating ? "正在获取地理位置…" : "正在搜索地点…"}
            </p>
          )}
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="max-h-44 overflow-auto rounded-lg border border-zinc-200 bg-white/90 p-1 dark:border-zinc-700 dark:bg-zinc-900/90">
            {allOptions.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                暂无候选地点，可继续搜索
              </p>
            ) : (
              allOptions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setSelected(item);
                  }}
                  className={`block w-full rounded px-2 py-1.5 text-left text-xs ${
                    selected === item
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                      : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  }`}
                >
                  {item}
                </button>
              ))
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={applySelection}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              确定
            </button>
            <button
              type="button"
              onClick={cancelSelection}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              取消
            </button>
          </div>
        </>
      )}
    </div>
  );
}
