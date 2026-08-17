forwardRef<ChartHandle, ChartProps>((props, ref) => {
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

    const chartSeries = series.map(s => ({
      id: s.id,
      name: s.name,
      type: 'line' as const,
      data: s.data.map(p => (Number.isFinite(p.value) ? p.value : null)),
      connectNulls: true,
      showSymbol: true,
      symbol: 'circle',
      symbolSize: 10,
      smooth: false,
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
        trigger: 'axis',
        confine: true,
        backgroundColor: resolvedTheme.tooltipBackground,
        borderWidth: 0,
        padding: [8, 12],
        textStyle: {
          color: resolvedTheme.tooltipTextColor,
          fontSize: 12,
        },
        axisPointer: {
          type: 'cross',
          lineStyle: {
            color: resolvedTheme.crosshairColor,
            width: 1,
            type: 'dashed',
          },
          crossStyle: {
            color: resolvedTheme.crosshairColor,
            width: 1,
            type: 'dashed',
          },
          label: {
            backgroundColor: resolvedTheme.tooltipBackground,
            color: resolvedTheme.tooltipTextColor,
            fontSize: 10,
          },
        },
        formatter: (raw: any) => {
          const items = Array.isArray(raw) ? raw : [raw];
          if (items.length === 0) return '';
          const idx = Number(items[0].dataIndex);
          const header = categories[idx]?.label ?? String(items[0].axisValue);
          const unitByName = new Map(series.map(s => [s.name, s.unit]));
          const sourceByName = new Map(series.map(s => [s.name, s.source]));
          const lines = [header];
          for (const item of items) {
            const y = item.value;
            if (y == null || !Number.isFinite(Number(y))) continue;
            const unit = unitByName.get(item.seriesName);
            const suffix = unit === '%' ? '%' : unit ? ` ${unit}` : '';
            lines.push(
              `${item.marker}${item.seriesName}: ${Number(y).toFixed(
                2,
              )}${suffix}`,
            );
            const source = sourceByName.get(item.seriesName);
            if (source && !item.seriesName.startsWith(source)) {
              lines.push(`  Source: ${source}`);
            }
          }
          return lines.join('\n');
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
          item =>
            item.id === params.seriesId || item.name === params.seriesName,
        );
        const point = s?.data[Number(params.dataIndex)];
        if (s && point) {
          onPointPressRef.current?.({
            series: s,
            point,
            dataIndex: Number(params.dataIndex),
          });
        }
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
});
