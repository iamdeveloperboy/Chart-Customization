import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { SkiaChart } from "@wuba/react-native-echarts";
import type { EChartsType } from "echarts/core";
import echarts from "../echarts";
import type { SmoothAreaPoint, SmoothAreaPointPressHandler } from "./types";
import { AREA_BLUE, PRIMARY_BLUE, WHITE } from "./constants";

interface SmoothAreaChartProps {
  points: SmoothAreaPoint[];
  seriesName: string;
  width: number;
  height: number;
  onPointPress?: SmoothAreaPointPressHandler;
}

/** Show labels only when sparse enough to stay readable. */
const LABEL_POINT_LIMIT = 24;

/** When denser than this, start zoomed so the chart is pan/scrollable. */
const DENSE_POINT_LIMIT = 12;

function symbolSizeForCount(count: number, withLabels: boolean): number {
  if (count <= 8) return withLabels ? 34 : 18;
  if (count <= 20) return withLabels ? 28 : 14;
  if (count <= 40) return 12;
  return 8;
}

/** Round X (%) bounds to clean steps. */
function xAxisBounds(min: number, max: number): { min: number; max: number } {
  const span = Math.max(max - min, 1);
  const step = span <= 10 ? 5 : span <= 30 ? 5 : 10;
  return {
    min: Math.floor((min - step * 0.4) / step) * step,
    max: Math.ceil((max + step * 0.4) / step) * step,
  };
}

/**
 * Frequency hill chart:
 * - X: percentage value
 * - Y: how many reports share that percentage (3 → up, 1 → downhill)
 * - Circle label: report count at that %
 */
export default function SmoothAreaChart({
  points,
  seriesName,
  width,
  height,
  onPointPress,
}: SmoothAreaChartProps) {
  const skiaRef = useRef<any>(null);
  const chartRef = useRef<EChartsType | undefined>(undefined);
  const pointsRef = useRef(points);
  const onPointPressRef = useRef(onPointPress);
  onPointPressRef.current = onPointPress;

  const showPointLabels =
    points.length > 0 && points.length <= LABEL_POINT_LIMIT;
  const dense = points.length > DENSE_POINT_LIMIT;

  useEffect(() => {
    let cancelled = false;
    let raf = 0;

    const mount = () => {
      if (cancelled) return;
      if (!skiaRef.current) {
        raf = requestAnimationFrame(mount);
        return;
      }
      const chart = echarts.init(skiaRef.current, undefined, {
        renderer: "skia",
        width,
        height,
      } as any);

      chart.on("click", (params: any) => {
        if (params?.componentType !== "series") return;
        const idx = Number(params.dataIndex);
        const point = pointsRef.current[idx];
        if (point) onPointPressRef.current?.(point);
      });

      chartRef.current = chart;
    };

    mount();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      chartRef.current?.dispose();
      chartRef.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!points.length) {
      chart.clear();
      return;
    }

    // Already frequency-aggregated: sorted by % ascending.
    const ordered = [...points].sort((a, b) => a.value - b.value);
    pointsRef.current = ordered;

    const pctValues = ordered.map((p) => p.value);
    const pctMin = Math.min(...pctValues);
    const pctMax = Math.max(...pctValues);
    const xBounds = xAxisBounds(pctMin, pctMax);

    const countMax = Math.max(
      ...ordered.map((p) => p.count ?? p.reportNumber),
      1,
    );
    const size = symbolSizeForCount(ordered.length, showPointLabels);

    const zoomStart = 0;
    const zoomEnd = dense
      ? Math.max(
          20,
          Math.min(100, Math.round((DENSE_POINT_LIMIT / ordered.length) * 100)),
        )
      : 100;

    chart.setOption(
      {
        animation: ordered.length <= 60,
        backgroundColor: WHITE,
        grid: {
          left: 8,
          right: Math.max(16, Math.ceil(size / 2) + 8),
          top: 20,
          bottom: 48,
          outerBoundsMode: "same",
          outerBoundsContain: "axisLabel",
        },
        dataZoom: [
          {
            type: "inside",
            xAxisIndex: 0,
            start: zoomStart,
            end: zoomEnd,
            zoomOnMouseWheel: true,
            moveOnMouseMove: true,
            moveOnMouseWheel: false,
            zoomLock: false,
            minSpan: 8,
            maxSpan: 100,
            filterMode: "none",
            throttle: 50,
          },
          {
            type: "slider",
            xAxisIndex: 0,
            start: zoomStart,
            end: zoomEnd,
            height: 22,
            bottom: 6,
            borderColor: "#E5E7EB",
            backgroundColor: "transparent",
            fillerColor: "rgba(37, 99, 235, 0.15)",
            handleStyle: { color: PRIMARY_BLUE },
            moveHandleStyle: { color: "#9CA3AF" },
            dataBackground: {
              lineStyle: { color: "#9CA3AF", opacity: 0.4 },
              areaStyle: { color: "#E5E7EB", opacity: 0.5 },
            },
            selectedDataBackground: {
              lineStyle: { color: PRIMARY_BLUE, opacity: 0.5 },
              areaStyle: { color: PRIMARY_BLUE, opacity: 0.15 },
            },
            textStyle: { color: "#6B7280", fontSize: 9 },
            labelFormatter: (value: number) =>
              Number.isFinite(value) ? `${Number(value).toFixed(1)}%` : "",
            minSpan: 8,
            maxSpan: 100,
            filterMode: "none",
            throttle: 50,
            brushSelect: false,
          },
        ],
        tooltip: {
          trigger: "item",
          confine: true,
          formatter: (params: any) => {
            const idx = Number(params?.dataIndex);
            const point = ordered[idx];
            if (!point) return "";
            const count = point.count ?? point.reportNumber;
            const detail =
              point.reports && point.reports.length
                ? point.reports
                    .map(
                      (r) =>
                        `  #${r.reportNumber} ${r.value.toFixed(2)}%` +
                        (r.scenario ? ` (${r.scenario})` : ""),
                    )
                    .join("\n")
                : "";
            return (
              `${point.value.toFixed(2)}%\n` +
              `${count} report${count === 1 ? "" : "s"}` +
              (detail ? `\n${detail}` : "")
            );
          },
        },
        xAxis: {
          type: "value",
          min: xBounds.min,
          max: xBounds.max,
          scale: true,
          axisLine: { lineStyle: { color: "#D1D5DB" } },
          axisTick: { show: false },
          axisLabel: {
            color: "#6B7280",
            fontSize: 9,
            hideOverlap: true,
            formatter: (v: number) => `${Number(v.toFixed(1))}%`,
          },
          splitLine: {
            show: true,
            lineStyle: { color: "#EEF2F7" },
          },
        },
        yAxis: {
          type: "value",
          min: 0,
          max: countMax + (countMax > 1 ? 0.5 : 1),
          minInterval: 1,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: "#6B7280",
            fontSize: 9,
            margin: 4,
            formatter: (v: number) =>
              Number.isInteger(v) && v >= 0 ? String(v) : "",
          },
          splitLine: { lineStyle: { color: "#EEF2F7" } },
        },
        series: [
          {
            type: "line",
            name: seriesName,
            clip: false,
            // [percentage, reportCount] — hill up for many reports, down for few
            data: ordered.map((p) => {
              const count = p.count ?? p.reportNumber;
              return {
                value: [p.value, count],
                label: {
                  show: showPointLabels,
                  position: "inside",
                  color: WHITE,
                  fontSize: size >= 28 ? 11 : 9,
                  fontWeight: "700",
                  formatter: String(count),
                },
              };
            }),
            smooth: 0.45,
            symbol: "circle",
            symbolSize: size,
            showSymbol: true,
            triggerLineEvent: true,
            connectNulls: true,
            lineStyle: {
              width: ordered.length > 40 ? 1.5 : 2.5,
              color: PRIMARY_BLUE,
              cap: "round",
              join: "round",
            },
            itemStyle: {
              color: PRIMARY_BLUE,
              borderColor: PRIMARY_BLUE,
              borderWidth: 0,
            },
            label: { show: false },
            areaStyle: {
              color: AREA_BLUE,
              origin: "start",
            },
            emphasis: {
              scale: true,
              itemStyle: {
                color: PRIMARY_BLUE,
                borderColor: WHITE,
                borderWidth: 2,
                shadowBlur: 6,
                shadowColor: "rgba(37, 99, 235, 0.45)",
              },
            },
          },
        ],
      },
      { notMerge: true },
    );
    chart.resize({ width, height });
  }, [points, seriesName, showPointLabels, dense, width, height]);

  return (
    <View style={styles.card} collapsable={false}>
      <SkiaChart ref={skiaRef} width={width} height={height} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: WHITE,
  },
});
