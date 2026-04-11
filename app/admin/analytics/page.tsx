"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type VisitRow = {
  id: string;
  createdAt: string;
  ip: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  path: string;
  queryString: string | null;
  referrer: string | null;
  userAgent: string | null;
  acceptLanguage: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  visitorId: string | null;
  isBot: boolean;
  screenWidth: number | null;
  screenHeight: number | null;
};

type GeoPoint = { lat: number; lng: number; count: number; city: string | null; country: string | null };

type Report = {
  summary: {
    total: number;
    humanTotal: number;
    botTotal: number;
    uniqueIp: number;
    uniqueVisitors: number;
  };
  topPaths: { key: string; count: number }[];
  topCountries: { key: string; count: number }[];
  topRegions: { key: string; count: number }[];
  daily: { date: string; count: number }[];
  geoPoints: GeoPoint[];
  rows: VisitRow[];
  totalRows: number;
};

function toYmd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function clip(s: string | null, n: number) {
  if (!s) return "—";
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/* ── Leaflet 地图（CDN 按需加载） ── */
function VisitorMap({ points }: { points: GeoPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<ReturnType<typeof Object> | null>(null);
  const [ready, setReady] = useState(false);

  // 加载 Leaflet CSS + JS（仅一次）
  useEffect(() => {
    // 「读外部状态写回 React」的合法用法（CDN 脚本可能已被别处加载过），
    // react-hooks/set-state-in-effect 启发式会误报，下面那行 setReady(true) 显式关掉
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).L) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReady(true);
      return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    link.crossOrigin = "";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    script.crossOrigin = "";
    script.onload = () => setReady(true);
    document.head.appendChild(script);
  }, []);

  // 初始化 / 更新地图
  useEffect(() => {
    if (!ready || !containerRef.current || points.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const L = (window as any).L;
    if (!L) return;

    // 销毁旧实例
    if (mapRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mapRef.current as any).remove();
      mapRef.current = null;
    }

    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://osm.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 18,
    }).addTo(map);

    const markers: unknown[] = [];
    for (const p of points) {
      const r = Math.min(14, 4 + Math.log2(p.count + 1) * 2.5);
      const m = L.circleMarker([p.lat, p.lng], {
        radius: r,
        color: "#dc2626",
        fillColor: "#f87171",
        fillOpacity: 0.55,
        weight: 1.5,
      }).addTo(map);
      m.bindPopup(
        `<b>${p.city || "未知"}${p.country ? ` · ${p.country}` : ""}</b><br/>${p.count} 次访问`,
      );
      markers.push(m);
    }

    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 6);
    } else {
      const bounds = L.latLngBounds(points.map((p: GeoPoint) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    }

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mapRef.current as any).remove();
        mapRef.current = null;
      }
    };
  }, [ready, points]);

  if (points.length === 0) return null;

  return (
    <div className="mb-8 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-sm font-medium text-zinc-900 dark:text-zinc-50">
        访客地图
        <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
          {points.length} 个位置，{points.reduce((s, p) => s + p.count, 0)} 次访问
        </span>
      </h2>
      <div ref={containerRef} className="h-[420px] w-full rounded-lg" />
    </div>
  );
}

function downloadCsv(rows: VisitRow[]) {
  const headers = [
    "时间(UTC)",
    "IP",
    "国家",
    "地区",
    "城市",
    "纬度",
    "经度",
    "路径",
    "查询串",
    "来源",
    "UA",
    "语言",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "访客ID",
    "爬虫",
    "屏宽",
    "屏高",
  ];
  const esc = (v: string | number | boolean | null | undefined) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.createdAt,
        r.ip ?? "",
        r.country ?? "",
        r.region ?? "",
        r.city ?? "",
        r.latitude ?? "",
        r.longitude ?? "",
        r.path,
        r.queryString ?? "",
        r.referrer ?? "",
        r.userAgent ?? "",
        r.acceptLanguage ?? "",
        r.utmSource ?? "",
        r.utmMedium ?? "",
        r.utmCampaign ?? "",
        r.visitorId ?? "",
        r.isBot ? "1" : "0",
        r.screenWidth ?? "",
        r.screenHeight ?? "",
      ]
        .map(esc)
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `visits-${toYmd(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function AdminAnalyticsPage() {
  const [from, setFrom] = useState(() => toYmd(new Date(Date.now() - 7 * 86400000)));
  const [to, setTo] = useState(() => toYmd(new Date()));
  const [includeBots, setIncludeBots] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("from", from);
    p.set("to", to);
    if (!includeBots) p.set("bots", "0");
    p.set("page", String(page));
    p.set("pageSize", String(pageSize));
    return p.toString();
  }, [from, to, includeBots, page, pageSize]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/analytics?${qs}`, { credentials: "include" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data as { error?: string } | null)?.error ?? `加载失败 (${res.status})`);
        setReport(null);
        return;
      }
      setReport(data as Report);
    } catch {
      setError("网络错误");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = report ? Math.max(1, Math.ceil(report.totalRows / pageSize)) : 1;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">访客流量</h1>
        </div>
        <Link
          href="/admin"
          className="text-sm text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← 返回文章列表
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">开始日期</span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">结束日期</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-50"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={includeBots}
            onChange={(e) => {
              setIncludeBots(e.target.checked);
              setPage(1);
            }}
            className="rounded border-zinc-400"
          />
          包含疑似爬虫 / 自动化 UA
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          刷新
        </button>
        <button
          type="button"
          disabled={!report?.rows.length}
          onClick={() => report && downloadCsv(report.rows)}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          导出本页 CSV
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}

      {loading && !report && <p className="text-sm text-zinc-500">加载中…</p>}

      {report && (
        <>
          <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: "总请求", value: report.summary.total },
              { label: "疑似真人", value: report.summary.humanTotal },
              { label: "疑似爬虫", value: report.summary.botTotal },
              { label: "独立 IP", value: report.summary.uniqueIp },
              { label: "独立访客 ID", value: report.summary.uniqueVisitors },
            ].map((x) => (
              <div
                key={x.label}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{x.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {x.value}
                </p>
              </div>
            ))}
          </section>

          <VisitorMap points={report.geoPoints ?? []} />

          <div className="mb-8 grid gap-6 lg:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">按天（UTC）</h2>
              <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs text-zinc-600 dark:text-zinc-400">
                {report.daily.map((d) => (
                  <li key={d.date} className="flex justify-between gap-2">
                    <span>{d.date}</span>
                    <span className="tabular-nums text-zinc-900 dark:text-zinc-200">{d.count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">热门路径</h2>
              <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs text-zinc-600 dark:text-zinc-400">
                {report.topPaths.map((p) => (
                  <li key={p.key} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate" title={p.key}>
                      {p.key}
                    </span>
                    <span className="shrink-0 tabular-nums text-zinc-900 dark:text-zinc-200">{p.count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">国家/地区</h2>
              <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs text-zinc-600 dark:text-zinc-400">
                {report.topCountries.map((p) => (
                  <li key={p.key} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{p.key}</span>
                    <span className="shrink-0 tabular-nums text-zinc-900 dark:text-zinc-200">{p.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mb-4 hidden rounded-xl border border-zinc-200 bg-white p-4 lg:block dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">省/州（含国家）</h2>
            <ul className="mt-3 grid max-h-40 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto text-xs text-zinc-600 dark:text-zinc-400 xl:grid-cols-3">
              {report.topRegions.map((p) => (
                <li key={p.key} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate" title={p.key}>
                    {p.key}
                  </span>
                  <span className="shrink-0 tabular-nums">{p.count}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="min-w-[900px] w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950/80">
                  <th className="px-2 py-2 font-medium text-zinc-600 dark:text-zinc-400">时间</th>
                  <th className="px-2 py-2 font-medium text-zinc-600 dark:text-zinc-400">IP</th>
                  <th className="px-2 py-2 font-medium text-zinc-600 dark:text-zinc-400">位置</th>
                  <th className="px-2 py-2 font-medium text-zinc-600 dark:text-zinc-400">路径</th>
                  <th className="px-2 py-2 font-medium text-zinc-600 dark:text-zinc-400">来源</th>
                  <th className="px-2 py-2 font-medium text-zinc-600 dark:text-zinc-400">UA</th>
                  <th className="px-2 py-2 font-medium text-zinc-600 dark:text-zinc-400">访客</th>
                  <th className="px-2 py-2 font-medium text-zinc-600 dark:text-zinc-400">屏</th>
                  <th className="px-2 py-2 font-medium text-zinc-600 dark:text-zinc-400">爬虫</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-zinc-100 dark:border-zinc-800/80"
                  >
                    <td className="whitespace-nowrap px-2 py-2 text-zinc-600 dark:text-zinc-400">
                      {new Date(r.createdAt).toISOString().replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-zinc-800 dark:text-zinc-200">
                      {r.ip ?? "—"}
                    </td>
                    <td className="max-w-[140px] px-2 py-2 text-zinc-700 dark:text-zinc-300">
                      <span className="line-clamp-2" title={[r.country, r.region, r.city].filter(Boolean).join(" · ")}>
                        {[r.country, r.region, r.city].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </td>
                    <td className="max-w-[200px] px-2 py-2 text-zinc-800 dark:text-zinc-200">
                      <span className="line-clamp-2 font-mono" title={r.queryString ? `${r.path}?${r.queryString}` : r.path}>
                        {r.queryString ? `${r.path}?${r.queryString}` : r.path}
                      </span>
                    </td>
                    <td className="max-w-[120px] px-2 py-2 text-zinc-600 dark:text-zinc-400">
                      <span className="line-clamp-2" title={r.referrer ?? ""}>
                        {clip(r.referrer, 48)}
                      </span>
                    </td>
                    <td className="max-w-[160px] px-2 py-2 text-zinc-600 dark:text-zinc-400">
                      <span className="line-clamp-2" title={r.userAgent ?? ""}>
                        {clip(r.userAgent, 64)}
                      </span>
                    </td>
                    <td className="max-w-[100px] px-2 py-2 font-mono text-zinc-600 dark:text-zinc-400">
                      {clip(r.visitorId, 12)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-zinc-600 dark:text-zinc-400">
                      {r.screenWidth && r.screenHeight ? `${r.screenWidth}×${r.screenHeight}` : "—"}
                    </td>
                    <td className="px-2 py-2 text-zinc-600 dark:text-zinc-400">{r.isBot ? "是" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600 dark:text-zinc-400">
            <span>
              第 {page} / {totalPages} 页，共 {report.totalRows} 条
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-zinc-300 px-3 py-1 disabled:opacity-40 dark:border-zinc-600"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-zinc-300 px-3 py-1 disabled:opacity-40 dark:border-zinc-600"
              >
                下一页
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
