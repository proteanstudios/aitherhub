import { useMemo, useState } from "react";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";

/**
 * AnalyticsSection – renders KPI cards, sub-metrics, a time-series chart,
 * and a product breakdown table above the report section.
 *
 * Props:
 *   reports1  – array of phase objects (each with csv_metrics, time_start, time_end)
 *   videoData – the full video detail object
 */
export default function AnalyticsSection({ reports1, videoData }) {
  const [collapsed, setCollapsed] = useState(false);

  // ── Aggregate metrics from all phases ──────────────────────────
  const agg = useMemo(() => {
    if (!reports1 || reports1.length === 0) return null;

    let totalGmv = 0;
    let totalOrders = 0;
    let totalViewers = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let totalShares = 0;
    let totalFollowers = 0;
    let totalClicks = 0;
    let maxTime = 0;
    let hasAnyData = false;
    const productMap = {};

    // Time-series data for chart
    const timeSeriesGmv = [];
    const timeSeriesViewers = [];

    for (const item of reports1) {
      const m = item.csv_metrics;
      if (!m) continue;

      if (m.gmv > 0 || m.order_count > 0 || m.viewer_count > 0 || m.like_count > 0) {
        hasAnyData = true;
      }

      totalGmv += m.gmv || 0;
      totalOrders += m.order_count || 0;
      totalViewers = Math.max(totalViewers, m.viewer_count || 0);
      totalLikes += m.like_count || 0;
      totalComments += m.comment_count || 0;
      totalShares += m.share_count || 0;
      totalFollowers += m.new_followers || 0;
      totalClicks += m.product_clicks || 0;

      if (item.time_end != null && Number(item.time_end) > maxTime) {
        maxTime = Number(item.time_end);
      }

      // Build time series
      const midTime = item.time_start != null && item.time_end != null
        ? (Number(item.time_start) + Number(item.time_end)) / 2
        : item.time_start != null ? Number(item.time_start) : null;

      if (midTime != null) {
        timeSeriesGmv.push({ x: midTime, y: m.gmv || 0 });
        timeSeriesViewers.push({ x: midTime, y: m.viewer_count || 0 });
      }

      // Collect product names
      if (m.product_names && Array.isArray(m.product_names)) {
        for (const name of m.product_names) {
          if (!productMap[name]) {
            productMap[name] = { name, gmv: 0, orders: 0, clicks: 0, phases: 0 };
          }
          productMap[name].gmv += m.gmv || 0;
          productMap[name].orders += m.order_count || 0;
          productMap[name].clicks += m.product_clicks || 0;
          productMap[name].phases += 1;
        }
      }
    }

    if (!hasAnyData) return null;

    // Sort time series
    timeSeriesGmv.sort((a, b) => a.x - b.x);
    timeSeriesViewers.sort((a, b) => a.x - b.x);

    // Cumulative GMV
    let cumGmv = 0;
    const cumulativeGmv = timeSeriesGmv.map((p) => {
      cumGmv += p.y;
      return { x: p.x, y: cumGmv };
    });

    const durationMin = Math.round(maxTime / 60);
    const cvr = totalClicks > 0 ? ((totalOrders / totalClicks) * 100).toFixed(1) : "0.0";
    const avgOrderValue = totalOrders > 0 ? Math.round(totalGmv / totalOrders) : 0;
    const gmvPerHour = durationMin > 0 ? Math.round(totalGmv / (durationMin / 60)) : 0;
    const gpm = totalViewers > 0 ? Math.round(totalGmv / totalViewers) : 0;

    const products = Object.values(productMap).sort((a, b) => b.gmv - a.gmv);

    return {
      totalGmv, totalOrders, totalViewers, totalLikes, totalComments,
      totalShares, totalFollowers, totalClicks, durationMin, cvr,
      avgOrderValue, gmvPerHour, gpm, products,
      cumulativeGmv, timeSeriesViewers,
    };
  }, [reports1]);

  // ── Format helpers ─────────────────────────────────────────────
  const fmtTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const fmtElapsed = (seconds) => {
    const m = Math.floor(seconds / 60);
    return `配信${m}分頃`;
  };

  // ── Don't render if no data ────────────────────────────────────
  if (!agg) return null;

  // ── Highcharts options ─────────────────────────────────────────
  const chartOptions = {
    chart: {
      height: 180,
      backgroundColor: "transparent",
      style: { fontFamily: "inherit" },
    },
    title: { text: null },
    credits: { enabled: false },
    legend: {
      align: "right",
      verticalAlign: "top",
      floating: true,
      itemStyle: { fontSize: "10px", color: "#6b7280" },
    },
    xAxis: {
      type: "linear",
      labels: {
        formatter: function () {
          return fmtTime(this.value);
        },
        style: { fontSize: "10px", color: "#9ca3af" },
      },
      lineColor: "#e5e7eb",
      tickColor: "#e5e7eb",
    },
    yAxis: [
      {
        title: { text: null },
        labels: {
          formatter: function () {
            return "¥" + (this.value >= 1000 ? Math.round(this.value / 1000) + "k" : this.value);
          },
          style: { fontSize: "10px", color: "#f97316" },
        },
        gridLineColor: "#f3f4f6",
      },
      {
        title: { text: null },
        opposite: true,
        labels: {
          style: { fontSize: "10px", color: "#3b82f6" },
        },
        gridLineWidth: 0,
      },
    ],
    tooltip: {
      shared: true,
      formatter: function () {
        const time = fmtTime(this.x);
        const elapsed = fmtElapsed(this.x);
        let s = `<b>${time}</b> (${elapsed})<br/>`;
        for (const p of this.points) {
          const val = p.series.name === "売上（累積）"
            ? "¥" + Math.round(p.y).toLocaleString()
            : p.y.toLocaleString() + "人";
          s += `<span style="color:${p.color}">\u25CF</span> ${p.series.name}: <b>${val}</b><br/>`;
        }
        return s;
      },
    },
    plotOptions: {
      areaspline: {
        fillOpacity: 0.15,
        marker: { enabled: false, radius: 2 },
        lineWidth: 2,
      },
    },
    series: [
      {
        name: "売上（累積）",
        type: "areaspline",
        color: "#f97316",
        data: agg.cumulativeGmv.map((p) => [p.x, p.y]),
        yAxis: 0,
      },
      {
        name: "視聴者数",
        type: "areaspline",
        color: "#3b82f6",
        data: agg.timeSeriesViewers.map((p) => [p.x, p.y]),
        yAxis: 1,
      },
    ],
  };

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="w-full mt-6 mx-auto mb-4">
      <div className="rounded-2xl bg-gray-50 border border-gray-200">
        {/* Header */}
        <div
          onClick={() => setCollapsed((s) => !s)}
          className="flex items-center justify-between p-5 cursor-pointer hover:bg-gray-100 transition-all duration-200"
        >
          <div className="flex items-center gap-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="w-5 h-5 text-gray-700">
              <path d="M3 3v18h18" />
              <path d="m19 9-5 5-4-4-3 3" />
            </svg>
            <div>
              <div className="text-gray-900 text-xl font-semibold">アナリティクス</div>
              <div className="text-gray-500 text-sm mt-1">
                配信時間 {agg.durationMin}分 ・ {agg.totalOrders}件の注文
              </div>
            </div>
          </div>
          <button type="button" className="text-gray-400 p-2 rounded focus:outline-none transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.5"
              className={`w-6 h-6 transform transition-transform duration-200 ${!collapsed ? "rotate-180" : ""}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {!collapsed && (
          <div className="px-5 pb-5 space-y-4">
            {/* ── KPI Cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* GMV */}
              <div className="rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-gray-500 text-xs font-medium mb-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-500">
                    <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  売上 (GMV)
                </div>
                <div className="text-2xl font-bold text-gray-900">¥{Math.round(agg.totalGmv).toLocaleString()}</div>
                <div className="text-xs text-gray-400 mt-1">{agg.totalOrders}件の注文</div>
              </div>

              {/* Viewers */}
              <div className="rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-gray-500 text-xs font-medium mb-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                  </svg>
                  視聴者数
                </div>
                <div className="text-2xl font-bold text-gray-900">{agg.totalViewers.toLocaleString()}</div>
                <div className="text-xs text-gray-400 mt-1">ピーク視聴者</div>
              </div>

              {/* Likes */}
              <div className="rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-gray-500 text-xs font-medium mb-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                    fill="currentColor" stroke="none" className="text-pink-500">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  いいね
                </div>
                <div className="text-2xl font-bold text-gray-900">{agg.totalLikes.toLocaleString()}</div>
                <div className="text-xs text-gray-400 mt-1">コメント {agg.totalComments}</div>
              </div>

              {/* Product Clicks */}
              <div className="rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-gray-500 text-xs font-medium mb-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2" className="text-green-500">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                  商品クリック
                </div>
                <div className="text-2xl font-bold text-gray-900">{agg.totalClicks.toLocaleString()}</div>
                <div className="text-xs text-gray-400 mt-1">CVR {agg.cvr}%</div>
              </div>
            </div>

            {/* ── Sub Metrics ── */}
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {[
                { label: "GPM", value: `¥${agg.gpm}` },
                { label: "新規フォロワー", value: `+${agg.totalFollowers}` },
                { label: "シェア", value: agg.totalShares.toString() },
                { label: "客単価", value: `¥${agg.avgOrderValue.toLocaleString()}` },
                { label: "配信時間", value: `${agg.durationMin}分` },
                { label: "売上/時間", value: `¥${agg.gmvPerHour.toLocaleString()}/h` },
              ].map((item, i) => (
                <div key={i} className="rounded-lg bg-white border border-gray-100 px-3 py-2 text-center">
                  <div className="text-[10px] text-gray-400 font-medium">{item.label}</div>
                  <div className="text-sm font-semibold text-gray-700 mt-0.5">{item.value}</div>
                </div>
              ))}
            </div>

            {/* ── Chart ── */}
            {agg.cumulativeGmv.length > 1 && (
              <div className="rounded-xl bg-white border border-gray-200 p-3 shadow-sm">
                <HighchartsReact highcharts={Highcharts} options={chartOptions} />
              </div>
            )}

            {/* ── Product Breakdown ── */}
            {agg.products.length > 0 && (
              <div className="rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-500">
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                  <span className="text-sm font-semibold text-gray-700">商品別売上</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left text-xs text-gray-400 font-medium py-2 pr-4">商品名</th>
                        <th className="text-right text-xs text-gray-400 font-medium py-2 px-2">売上</th>
                        <th className="text-right text-xs text-gray-400 font-medium py-2 px-2">注文</th>
                        <th className="text-right text-xs text-gray-400 font-medium py-2 px-2">クリック</th>
                        <th className="text-right text-xs text-gray-400 font-medium py-2 pl-2">登場回数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agg.products.map((p, i) => (
                        <tr key={i} className="border-b border-gray-50 last:border-0">
                          <td className="py-2 pr-4">
                            <span className="inline-flex items-center gap-1.5 text-gray-700">
                              <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
                              {p.name}
                            </span>
                          </td>
                          <td className="text-right py-2 px-2 text-gray-700 font-medium">¥{Math.round(p.gmv).toLocaleString()}</td>
                          <td className="text-right py-2 px-2 text-gray-600">{p.orders}件</td>
                          <td className="text-right py-2 px-2 text-gray-600">{p.clicks}</td>
                          <td className="text-right py-2 pl-2 text-gray-500">{p.phases}回</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
