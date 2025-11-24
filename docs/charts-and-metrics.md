# Charts and Metrics - Technical Specification

## Overview

The dashboard features three main time-series charts (Load, Price, Renewables) and a real-time metrics panel. All charts use Chart.js v4 with dynamic data updates and event annotations.

---

## Architecture

### Chart Configuration
```javascript
const chartConfig = {
  type: 'line',
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: 'white' } },
      tooltip: { /* custom config */ },
      annotation: { /* event markers */ }
    },
    scales: {
      x: { type: 'time', /* time axis config */ },
      y: { /* value axis config */ }
    }
  }
};
```

### Data Structure
```javascript
// Chart data point format
{
  x: Date,           // JavaScript Date object
  y: number | null   // Metric value (null for missing data)
}
```

---

## Chart 1: Load vs Forecast

### Purpose
Compare actual electricity consumption against day-ahead load forecasts to assess prediction accuracy.

### Data Sources
- **Actual Load**: ENTSO-E A65 document type
- **Forecast Load**: ENTSO-E A71 document type
- **Resolution**: 15-minute intervals (raw data) to daily (aggregated)

### Datasets
```javascript
[
  {
    label: 'Actual Load',
    borderColor: '#00d4ff',
    backgroundColor: 'rgba(0, 212, 255, 0.1)',
    data: chartData.map(d => ({
      x: new Date(d.timestamp),
      y: d.countries[selectedCountry]?.load_actual
    })).filter(point => point.y !== null)
  },
  {
    label: 'Forecast Load',
    borderColor: '#00ffcc',
    backgroundColor: 'rgba(0, 255, 204, 0.1)',
    borderDash: [5, 5],  // Dashed line for forecast
    data: chartData.map(d => ({
      x: new Date(d.timestamp),
      y: d.countries[selectedCountry]?.load_forecast
    })).filter(point => point.y !== null)
  }
]
```

### Y-Axis Configuration
- **Label**: "Load (MW)"
- **Unit**: Megawatts
- **Scale**: Linear, auto-scaled to data range
- **Grid**: White lines at 10% opacity

### Visual Features
- **Actual**: Solid cyan line with filled area
- **Forecast**: Dashed teal line with filled area
- **Point Size**: Dynamic (0-3px based on data density)
- **Line Width**: Dynamic (1-2px based on data volume)

### Metrics Derived
- **Forecast Accuracy**: `100 - |actual - forecast| / actual * 100`
- **Mean Absolute Error (MAE)**: Average of `|actual - forecast|`
- **Peak Load Time**: Timestamp of maximum actual load
- **Average Load**: Mean of actual values over period

---

## Chart 2: Day-Ahead Prices

### Purpose
Monitor electricity market prices to identify trading opportunities and price volatility.

### Data Source
- **Type**: ENTSO-E A44 document type
- **Market**: Day-ahead spot market
- **Resolution**: Hourly prices
- **Currency**: EUR/MWh

### Dataset
```javascript
[
  {
    label: 'Day-Ahead Price',
    borderColor: '#ff6b6b',
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    data: chartData.map(d => ({
      x: new Date(d.timestamp),
      y: d.countries[selectedCountry]?.price_day_ahead
    })).filter(point => point.y !== null)
  }
]
```

### Y-Axis Configuration
- **Label**: "Price (€/MWh)"
- **Unit**: Euros per Megawatt-hour
- **Scale**: Linear, zero baseline optional
- **Formatter**: 2 decimal places

### Visual Features
- **Line Color**: Red (#ff6b6b) to indicate price risk
- **Filled Area**: Light red gradient
- **Spike Highlighting**: Automatic via event annotations
- **Hover Tooltip**: Shows exact price and timestamp

### Metrics Derived
- **Average Price**: Mean of all hourly prices
- **Price Volatility**: Standard deviation / mean
- **Peak Price**: Maximum price and timestamp
- **Off-Peak Price**: Minimum price and timestamp
- **Price Spikes**: Prices > 2 standard deviations above mean

### Event Correlation
Price spike events (💰 icon) are automatically placed on chart when:
- Price > €100/MWh, or
- Price > mean + 2 * standard deviation

---

## Chart 3: Renewable Generation

### Purpose
Track wind and solar generation to understand renewable energy penetration and variability.

### Data Sources
- **Solar**: ENTSO-E A75, production type B16
- **Wind Onshore**: ENTSO-E A75, production type B19
- **Wind Offshore**: ENTSO-E A75, production type B18
- **Resolution**: 15-minute intervals

### Datasets
```javascript
[
  {
    label: 'Solar Generation',
    borderColor: '#ffd93d',
    backgroundColor: 'rgba(255, 217, 61, 0.1)',
    data: chartData.map(d => ({
      x: new Date(d.timestamp),
      y: d.countries[selectedCountry]?.solar_generation
    })).filter(point => point.y !== null)
  },
  {
    label: 'Wind Generation',
    borderColor: '#6bcf7f',
    backgroundColor: 'rgba(107, 207, 127, 0.1)',
    data: chartData.map(d => ({
      x: new Date(d.timestamp),
      y: d.countries[selectedCountry]?.wind_generation
    })).filter(point => point.y !== null)
  }
]
```

### Wind Generation Calculation
```javascript
// For Poland (has both onshore and offshore)
wind_generation = pl_wind_onshore_generation + pl_wind_offshore_generation;

// For countries with only onshore
wind_generation = country_wind_generation;
```

### Y-Axis Configuration
- **Label**: "Generation (MW)"
- **Unit**: Megawatts
- **Scale**: Linear, starts at zero
- **Stacking**: Not stacked (overlapping lines)

### Visual Features
- **Solar**: Yellow/gold line representing daytime generation
- **Wind**: Green line representing variable wind generation
- **Zero Handling**: Nighttime solar shows zero (not null)
- **Missing Data**: Gaps in line for unavailable data

### Metrics Derived
- **Renewable Penetration**: `(solar + wind) / load * 100`
- **Capacity Factor**: `actual_generation / installed_capacity`
- **Peak Solar**: Maximum solar output and time
- **Peak Wind**: Maximum wind output and time
- **Variability**: Standard deviation over rolling window

---

## Real-Time Metrics Panel

### Purpose
Display key performance indicators calculated from the selected time period and country.

### Metric 1: Average Load
```javascript
const avgLoad = dataHistory.reduce((sum, point) => {
  const load = point.countries[selectedCountry]?.load_actual;
  return load != null ? sum + load : sum;
}, 0) / loadCount;
```
- **Display**: Rounded to nearest MW with thousands separator
- **Format**: "15,234 MW"
- **Update**: On country or period change

### Metric 2: Average Price
```javascript
const avgPrice = dataHistory.reduce((sum, point) => {
  const price = point.countries[selectedCountry]?.price_day_ahead;
  return price != null ? sum + price : sum;
}, 0) / priceCount;
```
- **Display**: 2 decimal places
- **Format**: "€45.67/MWh"
- **Update**: On country or period change

### Metric 3: Renewable Share
```javascript
const renewableShare = dataHistory.reduce((sum, point) => {
  const solar = point.countries[selectedCountry]?.solar_generation ?? 0;
  const wind = point.countries[selectedCountry]?.wind_generation ?? 0;
  const load = point.countries[selectedCountry]?.load_actual;
  
  if (load != null && load > 0) {
    return sum + ((solar + wind) / load * 100);
  }
  return sum;
}, 0) / countWithLoad;
```
- **Display**: 1 decimal place with % symbol
- **Format**: "23.4%"
- **Range**: 0-100% (can exceed 100% during low load + high generation)

### Metric 4: Forecast Accuracy
```javascript
const accuracy = dataHistory.reduce((sum, point) => {
  const actual = point.countries[selectedCountry]?.load_actual;
  const forecast = point.countries[selectedCountry]?.load_forecast;
  
  if (actual != null && forecast != null && actual > 0) {
    const error = Math.abs((actual - forecast) / actual * 100);
    return sum + Math.max(0, 100 - error);
  }
  return sum;
}, 0) / forecastCount;
```
- **Display**: 1 decimal place with % symbol
- **Format**: "95.8%"
- **Range**: 0-100% (higher is better)

### Grid Layout
```css
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
}
```

### Metric Card Structure
```html
<div class="metric-card">
  <div class="metric-value">15,234</div>
  <div class="metric-label">Load (MW)</div>
</div>
```

### Styling
- **Background**: Cyan translucent (#00d4ff at 10% opacity)
- **Border**: Cyan at 30% opacity
- **Value Font**: 1.3rem, bold, cyan color
- **Label Font**: 0.75rem, 80% opacity

---

## Chart Performance Optimization

### Dynamic Point Rendering
```javascript
const pointRadius = chartData.length > 500 ? 0 :     // No points for large datasets
                    chartData.length > 200 ? 1 :     // Small points for medium datasets
                    3;                                // Full points for small datasets

const lineWidth = chartData.length > 1000 ? 1 : 2;   // Thinner lines for dense data
```

### Update Modes
```javascript
chart.update('none');  // Skip animations for performance
// vs
chart.update('active'); // Animate changes
```

### Data Aggregation by Period
| Period | Resolution | Aggregation | Data Points |
|--------|-----------|-------------|-------------|
| 24 hours | 15 min | None | ~96 |
| 7 days | 1 hour | AVG | ~168 |
| 30 days | 4 hours | AVG | ~180 |
| 90 days | 1 day | AVG | ~90 |
| 6 months | 1 day | AVG | ~180 |
| 1 year | 1 day | AVG | ~365 |

---

## Event Annotations

### Annotation Structure
```javascript
annotations[`event_${index}`] = {
  type: 'line',
  xMin: eventTime,      // Vertical line at event time
  xMax: eventTime,
  borderColor: color,   // Category-specific color
  borderWidth: 2,
  borderDash: [5, 5],   // Dashed for unplanned, solid for planned
  label: {
    display: true,
    content: icon,      // Emoji icon only
    position: 'start',  // Top of chart
    backgroundColor: color,
    color: '#fff',
    font: { size: 14, weight: 'bold' },
    padding: 4
  }
};
```

### Event Filtering
```javascript
const countryEvents = eventData.filter(e => {
  const category = e.event_category || 'GENERATION';
  return e.country === country && eventFilters[category];
});
```

Events are dynamically shown/hidden based on user's filter selection.

### Tooltip Enhancement
```javascript
chart.options.plugins.tooltip.callbacks.afterBody = function(tooltipItems) {
  const xValue = tooltipItems[0].parsed.x;
  const eventTime = new Date(xValue);
  
  // Find events within 30 minutes
  const nearbyEvents = countryEvents.filter(event => {
    const evtTime = new Date(event.event_time);
    const timeDiff = Math.abs(evtTime - eventTime);
    return timeDiff <= 30 * 60 * 1000; // 30 minutes
  });
  
  // Return formatted event details
  return formatEventTooltip(nearbyEvents);
};
```

---

## Modal Expansion

### Trigger
```javascript
document.querySelectorAll('.card.clickable').forEach(card => {
  card.addEventListener('click', function(e) {
    if (e.target.closest('select, input, button')) return; // Ignore controls
    
    const chartType = this.getAttribute('data-chart');
    openModal(chartType);
  });
});
```

### Modal Chart Creation
```javascript
function openModal(chartType) {
  // Destroy existing modal chart
  if (modalChartInstance) {
    modalChartInstance.destroy();
  }
  
  // Create new chart with same data but larger canvas
  modalChartInstance = new Chart(modalChartCanvas, {
    type: 'line',
    data: { datasets: datasets },
    options: { /* enhanced options */ }
  });
  
  // Apply same event annotations
  addEventAnnotations(modalChartInstance, selectedCountry);
  modalChartInstance.update('none');
}
```

### Close Actions
- Click X button
- Press Escape key
- Click outside modal (on backdrop)

---

## X-Axis (Time) Configuration

### Time Scale Setup
```javascript
x: {
  type: 'time',
  time: {
    displayFormats: {
      hour: 'HH:mm',
      day: 'MMM DD',
      month: 'MMM YYYY'
    },
    tooltipFormat: 'MMM DD, YYYY HH:mm'
  },
  ticks: {
    color: 'white',
    maxRotation: 45,
    autoSkip: true,
    autoSkipPadding: 50
  },
  grid: {
    color: 'rgba(255, 255, 255, 0.1)',
    drawBorder: false
  }
}
```

### Adapter
- **Library**: `chartjs-adapter-date-fns`
- **Format**: Uses date-fns for parsing and formatting
- **Timezone**: Client local timezone (not UTC)

---

## Responsive Design

### Desktop (>768px)
- 3-column grid for main charts
- Full-width metrics grid (2x2)
- Hover effects on clickable cards

### Mobile (<768px)
- Single column layout
- Stacked charts
- Touch-friendly controls
- Simplified tooltips
