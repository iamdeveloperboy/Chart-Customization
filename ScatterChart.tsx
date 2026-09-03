import React, {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { useWindowDimensions } from 'react-native';
import { SkiaChart } from '@wuba/react-native-echarts';
import type { EChartsType } from 'echarts/core';
import echarts from '../chart/echarts';
import { resolveTheme } from '../chart/themes';
import type {
  ForecastChartHandle,
  ForecastPoint,
  ForecastPointPressPayload,
  ForecastSeries,
  TargetPeriod,
  ThemeName,
} from './types';

function paintNow(chart: EChartsType, width: number, height: number) {
  chart.resize({ width, height });
  const zr = chart.getZr?.();
  (zr as any)?.refreshImmediately?.() ?? zr?.refresh?.();
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pointHasRange(point: ForecastPoint): boolean {
  return Boolean(
    point.range &&
      Number.isFinite(point.minValue) &&
      Number.isFinite(point.maxValue),
  );
}

function valueKey(value: number): string {
  return Number(value).toFixed(2);
}

function peersAtValue(
  all: ForecastSeries[],
  dataIndex: number,
  key: string,
): ForecastSeries[] {
  return all.filter(s => {
    if (!s.visible) return false;
    const point = s.data[dataIndex];
    return (
      !!point && Number.isFinite(point.value) && valueKey(point.value) === key
    );
  });
}

function isPrimaryMarker(
  all: ForecastSeries[],
  series: ForecastSeries,
  dataIndex: number,
): boolean {
  const point = series.data[dataIndex];
  if (!point || !Number.isFinite(point.value)) return false;
  const peers = peersAtValue(all, dataIndex, valueKey(point.value));
  const preferred =
    peers.find(s => pointHasRange(s.data[dataIndex]!)) ?? peers[0];
  return preferred?.id === series.id;
}

function yAxisExtent(chartSeries: ForecastSeries[]): {
  min?: number;
  max?: number;
} {
  const values: number[] = [];
  for (const s of chartSeries) {
    if (!s.visible) continue;
    for (const p of s.data) {
      if (Number.isFinite(p.value)) values.push(p.value);
      if (pointHasRange(p)) {
        values.push(p.minValue!, p.maxValue!);
      }
    }
  }
  if (!values.length) return {};
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.08, 0.08);
  return {
    min: Number((lo - pad).toFixed(4)),
    max: Number((hi + pad).toFixed(4)),
  };
}

function renderRangeWhisker(_params: unknown, api: any) {
  const high = api.value(1);
  const low = api.value(2);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return undefined;
  const highPoint = api.coord([api.value(0), high]);
  const lowPoint = api.coord([api.value(0), low]);
  if (!highPoint || !lowPoint) return undefined;
  const cap = 7;
  const color = api.visual('color');
  const style = { stroke: color, fill: undefined, lineWidth: 2 };
  return {
    type: 'group',
    children: [
      {
        type: 'line',
        shape: {
          x1: highPoint[0],
          y1: highPoint[1],
          x2: lowPoint[0],
          y2: lowPoint[1],
        },
        style,
      },
      {
        type: 'line',
        shape: {
          x1: highPoint[0] - cap,
          y1: highPoint[1],
          x2: highPoint[0] + cap,
          y2: highPoint[1],
        },
        style,
      },
      {
        type: 'line',
        shape: {
          x1: lowPoint[0] - cap,
          y1: lowPoint[1],
          x2: lowPoint[0] + cap,
          y2: lowPoint[1],
        },
        style,
      },
    ],
  };
}

function formatPubDate(sourceDate?: string): string | undefined {
  if (!sourceDate) return undefined;
  const m = sourceDate.match(/^(\d{2}) ([A-Za-z]{3}) (\d{4})$/);
  if (!m) return sourceDate;
  return `${m[2]} ${m[1]}, ${m[3]}`;
}

/** Same 10px circle ECharts uses for `item.marker` in richText tooltips. */
function tooltipMarkerRich(chartSeries: ForecastSeries[]) {
  return Object.fromEntries(
    chartSeries.map((s, i) => [
      `fm${i}`,
      {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: s.color,
      },
    ]),
  );
}

function tooltipMarkerToken(index: number): string {
  return `{fm${index}|}  `;
}

function formatPeerTooltip(
  peer: ForecastSeries,
  point: ForecastPoint,
  marker: string,
): string {
  const unit = peer.unit;
  const unitSuffix = unit === '%' ? ' %' : unit ? ` ${unit}` : '';
  const report = point.reports?.[0];
  const pub = formatPubDate(report?.sourceDate);
  const lines = [
    `${marker}${peer.name}`,
    peer.indicator ? `  ${peer.indicator}` : null,
    report?.scenario
      ? `  Scenario: ${report.scenario}`
      : peer.scenario
        ? `  Scenario: ${peer.scenario}`
        : null,
    pub ? `  Publication Date: ${pub}` : null,
  ];
  if (pointHasRange(point)) {
    const rangeVal =
      point.rangeValue ??
      Number((point.maxValue! - point.minValue!).toFixed(2));
    lines.push(`  Min: ${point.minValue!.toFixed(2)}${unitSuffix}`);
    lines.push(`  Max: ${point.maxValue!.toFixed(2)}${unitSuffix}`);
    lines.push(`  Range: ${rangeVal.toFixed(2)}${unitSuffix}`);
  } else {
    lines.push(`  Value: ${point.value.toFixed(2)}${unitSuffix}`);
  }
  return lines.filter(Boolean).join('\n');
}

function nearestForecastPointAtPixel(
  chart: EChartsType,
  x: number,
  y: number,
  series: ForecastSeries[],
  maxDist: number,
): ForecastPointPressPayload | undefined {
  let best: ForecastPointPressPayload | undefined;
  let bestDist = maxDist;
  for (let si = 0; si < series.length; si += 1) {
    const s = series[si];
    if (!s.visible) continue;
    for (let di = 0; di < s.data.length; di += 1) {
      const point = s.data[di];
      if (!point || !Number.isFinite(point.value)) continue;
      const mid = chart.convertToPixel({ seriesIndex: si }, [di, point.value]);
      if (!mid || mid.length < 2) continue;
      let dist = Math.hypot(mid[0] - x, mid[1] - y);
      if (pointHasRange(point)) {
        const lo = chart.convertToPixel({ seriesIndex: si }, [
          di,
          point.minValue!,
        ]);
        const hi = chart.convertToPixel({ seriesIndex: si }, [
          di,
          point.maxValue!,
        ]);
        if (lo && hi) {
          dist = Math.min(
            dist,
            distToSegment(x, y, lo[0], lo[1], hi[0], hi[1]),
          );
        }
      }
      if (dist <= bestDist) {
        bestDist = dist;
        best = { series: s, point, dataIndex: di };
      }
    }
  }
  return best;
}

interface ForecastChartProps {
  categories: TargetPeriod[];
  series: ForecastSeries[];
  height?: number;
  width?: number;
  enableZoom?: boolean;
  enablePan?: boolean;
  enableTooltip?: boolean;
  enableLegend?: boolean;
  enableAnimation?: boolean;
  theme?: ThemeName;
  yAxisName?: string;
  onLegendSelectChanged?: (selected: Record<string, boolean>) => void;
  onPointPress?: (payload: ForecastPointPressPayload) => void;
}

const ForecastChart = forwardRef<ForecastChartHandle, ForecastChartProps>(
  (props, ref) => {
    const {
      categories,
      series,
      height = 360,
      width,
      enableZoom = true,
      enablePan = true,
      enableTooltip = true,
      enableLegend = true,
      enableAnimation = true,
      theme = 'light',
      yAxisName,
      onLegendSelectChanged,
      onPointPress,
    } = props;

    const windowWidth = useWindowDimensions().width;
    const chartWidth = width ?? windowWidth;
    const skiaRef = useRef<any>(null);
    const instanceRef = useRef<EChartsType | undefined>(undefined);
    const legendCallbackRef = useRef(onLegendSelectChanged);
    legendCallbackRef.current = onLegendSelectChanged;
    const seriesRef = useRef(series);
    seriesRef.current = series;
    const onPointPressRef = useRef(onPointPress);
    onPointPressRef.current = onPointPress;

    const resolvedTheme = useMemo(() => resolveTheme(theme), [theme]);

    const option = useMemo(() => {
      const labels = categories.map(p => p.label);
      const zoomEnabled = enableZoom || enablePan;
      const animation = enableAnimation && categories.length <= 80;

      const lineSeries = series.map(s => ({
        id: s.id,
        name: s.name,
        type: 'line' as const,
        data: s.data.map((p, di) => {
          if (!Number.isFinite(p.value)) return null;
          const primary = isPrimaryMarker(series, s, di);
          if (pointHasRange(p)) {
            return {
              value: p.value,
              symbol: primary ? 'diamond' : 'none',
              symbolSize: primary ? 16 : 0,
              itemStyle: {
                color: s.color,
                borderColor: '#1F2937',
                borderWidth: primary ? 1.5 : 0,
              },
            };
          }
          return {
            value: p.value,
            symbol: primary ? 'circle' : 'none',
            symbolSize: primary ? 14 : 0,
          };
        }),
        connectNulls: true,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 14,
        smooth: false,
        triggerLineEvent: false,
        z: 10,
        lineStyle: {
          color: s.color,
          width: 2,
          type: 'solid' as const,
          opacity: 1,
        },
        itemStyle: { color: s.color },
        emphasis: {
          focus: 'series' as const,
          itemStyle: { borderColor: s.color, borderWidth: 2 },
        },
        animation,
      }));

      const rangeSeries = series
        .filter(s => s.visible && s.data.some(pointHasRange))
        .map(s => ({
          id: `${s.id}|range`,
          name: `${s.name} range`,
          type: 'custom' as const,
          clip: true,
          silent: true,
          tooltip: { show: false },
          legendHoverLink: false,
          animation: false,
          z: 2,
          itemStyle: { color: s.color },
          renderItem: renderRangeWhisker,
          encode: { x: 0, y: [1, 2] },
          data: s.data.map((p, i) =>
            pointHasRange(p) ? [i, p.maxValue, p.minValue] : null,
          ),
        }));

      const chartSeries = [...lineSeries, ...rangeSeries];
      const yExtent = yAxisExtent(series);

      const gridLineStyle = {
        color: resolvedTheme.gridLineColor,
        width: 1,
        type: 'solid' as const,
      };

      return {
        animation,
        animationDuration: 500,
        animationDurationUpdate: 300,
        backgroundColor: 'transparent',
        legend: {
          show: enableLegend,
          type: 'scroll',
          bottom: zoomEnabled ? 30 : 4,
          left: 8,
          right: 8,
          icon: 'circle',
          itemWidth: 10,
          itemHeight: 10,
          data: series.map(s => s.name),
          textStyle: { color: resolvedTheme.textColor, fontSize: 10 },
          pageIconColor: resolvedTheme.textColor,
          pageTextStyle: { color: resolvedTheme.mutedTextColor },
          inactiveColor: resolvedTheme.mutedTextColor,
          selected: Object.fromEntries(series.map(s => [s.name, s.visible])),
        },
        grid: {
          left: yAxisName ? 28 : 12,
          right: 16,
          top: 16,
          bottom: (enableLegend ? 52 : 18) + (zoomEnabled ? 34 : 0),
          outerBoundsMode: 'same',
          outerBoundsContain: 'axisLabel',
        },
        tooltip: {
          show: enableTooltip,
          trigger: 'item',
          confine: true,
          backgroundColor: resolvedTheme.tooltipBackground,
          borderWidth: 0,
          padding: [8, 12],
          textStyle: {
            color: resolvedTheme.tooltipTextColor,
            fontSize: 12,
            rich: tooltipMarkerRich(series),
          },
          formatter: (raw: any) => {
            const item = Array.isArray(raw) ? raw[0] : raw;
            if (!item || item.seriesType === 'custom') return '';
            const idx = Number(item.dataIndex);
            const s = series.find(
              ser => ser.id === item.seriesId || ser.name === item.seriesName,
            );
            const point = s?.data[idx];
            if (!s || !point || !Number.isFinite(point.value)) return '';

            const header =
              point.periodLabel ??
              categories[idx]?.label ??
              String(item.axisValue ?? item.name ?? '');
            const peers = peersAtValue(series, idx, valueKey(point.value));
            const blocks = peers.map(peer => {
              const peerPoint = peer.data[idx]!;
              const marker = tooltipMarkerToken(series.indexOf(peer));
              return formatPeerTooltip(peer, peerPoint, marker);
            });
            return [header, ...blocks].join('\n');
          },
        },
        xAxis: {
          type: 'category',
          data: labels,
          boundaryGap: true,
          name: undefined,
          axisLine: { lineStyle: { color: resolvedTheme.axisLineColor } },
          axisTick: { alignWithLabel: true },
          axisLabel: {
            color: resolvedTheme.mutedTextColor,
            fontSize: 10,
            hideOverlap: true,
            rotate: labels.length > 12 ? 40 : 0,
          },
          splitLine: {
            show: true,
            lineStyle: gridLineStyle,
          },
        },
        yAxis: {
          type: 'value',
          scale: true,
          min: yExtent.min,
          max: yExtent.max,
          name: yAxisName,
          nameLocation: 'middle',
          nameGap: 44,
          nameTextStyle: { color: resolvedTheme.mutedTextColor, fontSize: 11 },
          axisLine: {
            show: true,
            lineStyle: { color: resolvedTheme.axisLineColor },
          },
          axisLabel: {
            color: resolvedTheme.mutedTextColor,
            fontSize: 10,
            formatter: (value: number) => value.toFixed(1),
          },
          splitLine: {
            show: true,
            lineStyle: gridLineStyle,
          },
        },
        dataZoom: zoomEnabled
          ? [
              {
                type: 'inside' as const,
                xAxisIndex: 0,
                zoomOnMouseWheel: enableZoom,
                zoomLock: !enableZoom,
                moveOnMouseMove: enablePan,
                moveOnMouseWheel: false,
                minSpan: 8,
                maxSpan: 100,
                filterMode: 'none' as const,
                throttle: 50,
              },
              {
                type: 'slider' as const,
                xAxisIndex: 0,
                height: 22,
                bottom: 4,
                borderColor: resolvedTheme.gridLineColor,
                backgroundColor: 'transparent',
                fillerColor: 'rgba(37, 99, 235, 0.15)',
                handleStyle: { color: '#2563EB' },
                moveHandleStyle: { color: resolvedTheme.axisLineColor },
                textStyle: { color: resolvedTheme.mutedTextColor, fontSize: 9 },
                labelFormatter: (value: number) =>
                  labels[Math.round(value)] ?? '',
                minSpan: 8,
                maxSpan: 100,
                filterMode: 'none' as const,
                throttle: 50,
              },
            ]
          : [],
        series: chartSeries,
      };
    }, [
      categories,
      series,
      resolvedTheme,
      enableZoom,
      enablePan,
      enableTooltip,
      enableLegend,
      enableAnimation,
      yAxisName,
    ]);

    const optionRef = useRef(option);
    optionRef.current = option;

    useEffect(() => {
      let cancelled = false;
      let raf = 0;
      let lastSeriesClickAt = 0;

      const mount = () => {
        if (cancelled) return;
        if (!skiaRef.current) {
          raf = requestAnimationFrame(mount);
          return;
        }
        const chart = echarts.init(skiaRef.current, undefined, {
          renderer: 'skia',
          width: chartWidth,
          height,
        } as any);
        chart.on('legendselectchanged', (event: any) => {
          legendCallbackRef.current?.(event.selected);
        });
        chart.on('click', (params: any) => {
          if (params?.componentType !== 'series') return;
          const s = seriesRef.current.find(
            item => item.id === params.seriesId || item.name === params.seriesName,
          );
          const idx = Number(params.dataIndex);
          const point = s?.data[idx];
          if (!s || !point || !Number.isFinite(point.value)) return;
          lastSeriesClickAt = Date.now();
          onPointPressRef.current?.({ series: s, point, dataIndex: idx });
        });
        const zr = chart.getZr?.();
        zr?.on('click', (event: any) => {
          if (Date.now() - lastSeriesClickAt < 80) return;
          const x = event?.offsetX ?? event?.zrX;
          const y = event?.offsetY ?? event?.zrY;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          const chartHeight =
            typeof chart.getHeight === 'function' ? chart.getHeight() : 0;
          if (chartHeight && y > chartHeight - 36) return;
          const payload = nearestForecastPointAtPixel(
            chart,
            x,
            y,
            seriesRef.current,
            28,
          );
          if (payload) onPointPressRef.current?.(payload);
        });
        if (optionRef.current) {
          chart.setOption(optionRef.current, { replaceMerge: ['series'] });
        }
        instanceRef.current = chart;
        raf = requestAnimationFrame(() => {
          if (!cancelled) paintNow(chart, chartWidth, height);
        });
      };

      mount();
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        instanceRef.current?.dispose();
        instanceRef.current = undefined;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const chart = instanceRef.current;
      if (!chart) return;
      paintNow(chart, chartWidth, height);
    }, [chartWidth, height]);

    useEffect(() => {
      const chart = instanceRef.current;
      if (!chart) return;
      chart.setOption(option, { replaceMerge: ['series'] });
      const raf = requestAnimationFrame(() => {
        paintNow(chart, chartWidth, height);
      });
      return () => cancelAnimationFrame(raf);
    }, [option, chartWidth, height]);

    const categoryKey = categories.map(c => c.id).join('|');
    useEffect(() => {
      instanceRef.current?.dispatchAction({
        type: 'dataZoom',
        start: 0,
        end: 100,
      });
    }, [categoryKey]);

    useImperativeHandle(
      ref,
      () => ({
        resetZoom: () => {
          instanceRef.current?.dispatchAction({
            type: 'dataZoom',
            start: 0,
            end: 100,
          });
        },
      }),
      [],
    );

    return <SkiaChart ref={skiaRef} width={chartWidth} height={height} />;
  },
);

ForecastChart.displayName = 'ForecastChart';

export default memo(ForecastChart);
