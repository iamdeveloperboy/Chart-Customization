import { BarChart, LineChart, PieChart, PopulationPyramid, RadarChart, BubbleChart, CandleStickChart } from "react-native-gifted-charts";

// ...
const data=[ {value:50}, {value:80}, {value:90}, {value:70} ]

<BarChart data = {data} />
<LineChart data = {data} />
<PieChart data = {data} />
<PopulationPyramid data = {[{left:10,right:12}, {left:9,right:8}]} />
<RadarChart data = {[50, 80, 90, 70]} />
<BubbleChart data = {[
  {x: 20, y: 4, r: 10},
  {x: 40, y: 6, r: 20},
]} />
<CandleStickChart data = {[
  {open: 82, close: 76, high: 90, low: 60},
  {open: 50, close: 57, high: 71, low: 44},
]} />

// For Horizontal Bar chart, just add the prop horizontal to the <BarChart/> component

<BarChart data = {data} horizontal />

// For Area chart, just add the prop areaChart to the <LineChart/> component

<LineChart data = {data} areaChart />

// For Donut chart, just add the prop donut to the <PieChart/> component

<PieChart data = {data} donut />

// For Scatter chart, just add the prop scatterChart to the <BubbleChart/> component

<BubbleChart
  data = {[
    {x: 20, y: 4, r: 10},
    {x: 40, y: 6, r: 20},
  ]}
  scatterChart
/>
