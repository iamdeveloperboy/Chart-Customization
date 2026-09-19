import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { SkiaChart } from '@wuba/react-native-echarts';
import type { EChartsType } from 'echarts/core';
import echarts from '../echarts';
import type { SmoothAreaPoint, SmoothAreaPointPressHandler } from './types';
import { AREA_BLUE, PRIMARY_BLUE, WHITE } from './constants';
import { formatSmoothPointInfo } from './data';

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
  // Keep circles large enough to tap even when Y = 1 (single report).
  if (count <= 8) return withLabels ? 34 : 22;
  if (count <= 20) return withLabels ? 28 : 16;
  if (count <= 40) return 14;
  return 10;
}

/** Tight X bounds around percentage values so points spread across the chart. */
function xAxisBounds(min: number, max: number): { min: number; max: number } {
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 0.25);
    return {
      min: Number((min - pad).toFixed(2)),
      max: Number((max + pad).toFixed(2)),
    };
  }
  const span = max - min;
  const pad = Math.max(span * 0.12, 0.05);
  return {
    min: Number((min - pad).toFixed(2)),
    max: Number((max + pad).toFixed(2)),
  };
}

interface TipBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function pointCount(point: SmoothAreaPoint): number {
  return point.count ?? point.reportNumber;
}

function hitTestBox(
  x: number,
  y: number,
  box: TipBox | null,
  pad = 8,
): boolean {
  if (!box) return false;
  return (
    x >= box.x - pad &&
    x <= box.x + box.width + pad &&
    y >= box.y - pad &&
    y <= box.y + box.height + pad
  );
}

function resolveSeriesPoint(
  params: any,
  points: SmoothAreaPoint[],
): SmoothAreaPoint | undefined {
  const attached = params?.data?.payload as SmoothAreaPoint | undefined;
  if (attached) return attached;
  const idx = Number(params?.dataIndex);
  if (!Number.isInteger(idx) || idx < 0) return undefined;
  return points[idx];
}

function nearestSmoothPointAtPixel(
  chart: EChartsType,
  x: number,
  y: number,
  points: SmoothAreaPoint[],
  maxDist: number,
): SmoothAreaPoint | undefined {
  let best: SmoothAreaPoint | undefined;
  let bestDist = maxDist;
  for (const point of points) {
    const pix = chart.convertToPixel({ seriesIndex: 0 }, [
      point.value,
      pointCount(point),
    ]);
    if (!pix || pix.length < 2) continue;
    const dist = Math.hypot(pix[0] - x, pix[1] - y);
    if (dist <= bestDist) {
      bestDist = dist;
      best = point;
    }
  }
  return best;
}

function estimateTipBox(
  chart: EChartsType,
  point: SmoothAreaPoint,
): TipBox | null {
  const pix = chart.convertToPixel({ seriesIndex: 0 }, [
    point.value,
    pointCount(point),
  ]);
  if (!pix || pix.length < 2) return null;
  const lines = formatSmoothPointInfo(point).split('\n');
  const width = Math.min(
    280,
    Math.max(160, ...lines.map(line => line.length * 7.2)),
  );
  const height = lines.length * 18 + 24;
  return {
    x: pix[0] - width - 10,
    y: pix[1] - height / 2,
    width,
    height,
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
  const lastTipPointRef = useRef<SmoothAreaPoint | null>(null);
  const lastTipBoxRef = useRef<TipBox | null>(null);
  const symbolSizeRef = useRef(22);
  onPointPressRef.current = onPointPress;

  const showPointLabels = points.length > 0 && points.length <= LABEL_POINT_LIMIT;
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
        renderer: 'skia',
        width,
        height,
      } as any);

      let lastSeriesClickAt = 0;
      const emitPoint = (point: SmoothAreaPoint | undefined) => {
        if (!point) return;
        lastTipPointRef.current = point;
        onPointPressRef.current?.(point);
      };

      chart.on('click', (params: any) => {
        if (params?.componentType !== 'series') return;
        const point = resolveSeriesPoint(params, pointsRef.current);
        if (!point) return;
        lastSeriesClickAt = Date.now();
        emitPoint(point);
      });

      // Tooltip sits left of the circle, so a tap on the bubble is not a
      // series hit. Map that tap (and near-miss taps) back to a payload.
      const zr = chart.getZr?.();
      zr?.on('click', (event: any) => {
        if (Date.now() - lastSeriesClickAt < 80) return;
        const x = event?.offsetX ?? event?.zrX;
        const y = event?.offsetY ?? event?.zrY;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const chartHeight =
          typeof chart.getHeight === 'function' ? chart.getHeight() : 0;
        if (chartHeight && y > chartHeight - 36) return;

        const tipBox =
          lastTipBoxRef.current ??
          (lastTipPointRef.current
            ? estimateTipBox(chart, lastTipPointRef.current)
            : null);
        if (hitTestBox(x, y, tipBox)) {
          emitPoint(lastTipPointRef.current ?? undefined);
          return;
        }

        const maxDist = Math.max(36, symbolSizeRef.current / 2 + 16);
        emitPoint(
          nearestSmoothPointAtPixel(chart, x, y, pointsRef.current, maxDist),
        );
      });
      chart.on('datazoom', () => {
        lastTipBoxRef.current = null;
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
      lastTipPointRef.current = null;
      lastTipBoxRef.current = null;
      chart.clear();
      return;
    }

    // Already frequency-aggregated: sorted by % ascending.
    const ordered = [...points].sort((a, b) => a.value - b.value);
    pointsRef.current = ordered;

    const pctValues = ordered.map(p => p.value);
    const pctMin = Math.min(...pctValues);
    const pctMax = Math.max(...pctValues);
    const xBounds = xAxisBounds(pctMin, pctMax);

    const countMax = Math.max(
      ...ordered.map(p => p.count ?? p.reportNumber),
      1,
    );
    const size = symbolSizeForCount(ordered.length, showPointLabels);
    symbolSizeRef.current = size;

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
          outerBoundsMode: 'same',
          outerBoundsContain: 'axisLabel',
        },
        dataZoom: [
          {
            type: 'inside',
            xAxisIndex: 0,
            start: zoomStart,
            end: zoomEnd,
            zoomOnMouseWheel: true,
            moveOnMouseMove: true,
            moveOnMouseWheel: false,
            zoomLock: false,
            minSpan: 8,
            maxSpan: 100,
            filterMode: 'none',
            throttle: 50,
          },
          {
            type: 'slider',
            xAxisIndex: 0,
            start: zoomStart,
            end: zoomEnd,
            height: 22,
            bottom: 6,
            borderColor: '#E5E7EB',
            backgroundColor: 'transparent',
            fillerColor: 'rgba(37, 99, 235, 0.15)',
            handleStyle: { color: PRIMARY_BLUE },
            moveHandleStyle: { color: '#9CA3AF' },
            dataBackground: {
              lineStyle: { color: '#9CA3AF', opacity: 0.4 },
              areaStyle: { color: '#E5E7EB', opacity: 0.5 },
            },
            selectedDataBackground: {
              lineStyle: { color: PRIMARY_BLUE, opacity: 0.5 },
              areaStyle: { color: PRIMARY_BLUE, opacity: 0.15 },
            },
            textStyle: { color: '#6B7280', fontSize: 9 },
            labelFormatter: (value: number) =>
              Number.isFinite(value) ? `${Number(value).toFixed(1)}%` : '',
            minSpan: 8,
            maxSpan: 100,
            filterMode: 'none',
            throttle: 50,
            brushSelect: false,
          },
        ],
        tooltip: {
          trigger: 'item',
          triggerOn: 'click',
          confine: true,
          enterable: false,
          backgroundColor: PRIMARY_BLUE,
          borderWidth: 0,
          borderRadius: 8,
          padding: [10, 12],
          textStyle: {
            color: WHITE,
            fontSize: 12,
            lineHeight: 18,
          },
          formatter: (params: any) => {
            const point = resolveSeriesPoint(params, ordered);
            if (!point) return '';
            lastTipPointRef.current = point;
            return formatSmoothPointInfo(point);
          },
          // Keep the bubble left of the marker, and remember its box so a
          // later tap on the tooltip can still resolve the same payload.
          position: (
            pos: number[],
            _params: unknown,
            _el: unknown,
            _rect: unknown,
            layout?: { contentSize?: number[]; viewSize?: number[] },
          ) => {
            const tw = layout?.contentSize?.[0];
            const th = layout?.contentSize?.[1];
            const vw = layout?.viewSize?.[0];
            const vh = layout?.viewSize?.[1];
            if (
              !pos ||
              !Number.isFinite(tw) ||
              !Number.isFinite(th) ||
              !Number.isFinite(vw) ||
              !Number.isFinite(vh)
            ) {
              return 'left';
            }
            const [cx, cy] = pos;
            let x = cx - tw - 10;
            let y = cy - th / 2;
            x = Math.max(8, Math.min(x, vw - tw - 8));
            y = Math.max(8, Math.min(y, vh - th - 8));
            lastTipBoxRef.current = { x, y, width: tw, height: th };
            return [x, y];
          },
        },
        xAxis: {
          type: 'value',
          min: xBounds.min,
          max: xBounds.max,
          scale: true,
          axisLine: { lineStyle: { color: '#D1D5DB' } },
          axisTick: { show: false },
          axisLabel: {
            color: '#6B7280',
            fontSize: 9,
            hideOverlap: true,
            formatter: (v: number) => `${Number(v.toFixed(2))}%`,
          },
          splitLine: {
            show: true,
            lineStyle: { color: '#EEF2F7' },
          },
        },
        yAxis: {
          type: 'value',
          min: 0,
          max: countMax + Math.max(0.6, countMax * 0.15),
          minInterval: 1,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: '#6B7280',
            fontSize: 9,
            margin: 4,
            formatter: (v: number) =>
              Number.isInteger(v) && v >= 0 ? String(v) : '',
          },
          splitLine: { lineStyle: { color: '#EEF2F7' } },
        },
        series: [
          {
            type: 'line',
            name: seriesName,
            clip: false,
            // [percentage, reportCount] — hill up for many reports, down for few
            data: ordered.map(p => {
              const count = p.count ?? p.reportNumber;
              return {
                value: [p.value, count],
                payload: p,
                label: {
                  show: showPointLabels,
                  position: 'inside',
                  color: WHITE,
                  fontSize: size >= 28 ? 11 : 9,
                  fontWeight: '700',
                  formatter: String(count),
                },
              };
            }),
            smooth: 0.45,
            symbol: 'circle',
            symbolSize: size,
            showSymbol: true,
            triggerLineEvent: false,
            connectNulls: true,
            lineStyle: {
              width: ordered.length > 40 ? 1.5 : 2.5,
              color: PRIMARY_BLUE,
              cap: 'round',
              join: 'round',
            },
            itemStyle: {
              color: PRIMARY_BLUE,
              borderColor: PRIMARY_BLUE,
              borderWidth: 0,
            },
            label: { show: false },
            areaStyle: {
              color: AREA_BLUE,
              origin: 'start',
            },
            emphasis: {
              scale: true,
              itemStyle: {
                color: PRIMARY_BLUE,
                borderColor: WHITE,
                borderWidth: 2,
                shadowBlur: 6,
                shadowColor: 'rgba(37, 99, 235, 0.45)',
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
    overflow: 'hidden',
    backgroundColor: WHITE,
  },
});
