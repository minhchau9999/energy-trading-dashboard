# Market News - Technical Specification

## Overview

The Market News feature provides real-time energy market headlines from RSS feeds and ENTSO-E urgent market messages. News items are displayed in a scrollable feed with automatic updates and FIFO queue management.

---

## Architecture

### Components
1. **News Parser** - Fetches and parses RSS feeds
2. **Socket.IO Server** - Broadcasts news to connected clients
3. **Frontend Feed** - Displays scrollable news list
4. **Modal View** - Expanded news display

### Data Flow
```
RSS Feed → News Parser → Socket.IO Server → Connected Clients → UI Update
```

---

## RSS Feed Integration

### News Sources

#### Primary: Energy Live News
```javascript
const NEWS_FEED_URL = 'https://www.energylivenews.com/feed/';
```

**Coverage:**
- UK and European energy markets
- Policy changes and government announcements
- Technology and innovation
- Market analysis and commentary
- Corporate news and deals

**Update Frequency:** Real-time (articles published throughout the day)

#### Secondary: ENTSO-E Urgent Market Messages
```javascript
const ENTSOE_UMM_URL = 'https://web-api.transparency.entsoe.eu/api';
```

**Coverage:**
- Generation unit outages
- Transmission line outages
- Cross-border capacity reductions
- System warnings

---

## RSS Parser Implementation

### Library
```javascript
const Parser = require('rss-parser');
const parser = new Parser({
  timeout: 10000,
  customFields: {
    item: [
      ['description', 'contentSnippet'],
      ['pubDate', 'publishedDate']
    ]
  }
});
```

### Parsing Function
```javascript
async function fetchNews() {
  try {
    const feed = await parser.parseURL(NEWS_FEED_URL);
    
    return feed.items.map(item => ({
      headline: item.title,
      link: item.link,
      timestamp: new Date(item.pubDate),
      source: 'Energy Live News',
      category: categorizeNews(item.title)
    }));
  } catch (error) {
    console.error('Failed to fetch news:', error.message);
    return [];
  }
}
```

### News Categorization
```javascript
function categorizeNews(title) {
  const lowerTitle = title.toLowerCase();
  
  if (lowerTitle.includes('nuclear')) return 'NUCLEAR';
  if (lowerTitle.includes('wind') || lowerTitle.includes('solar')) return 'RENEWABLE';
  if (lowerTitle.includes('gas') || lowerTitle.includes('coal')) return 'THERMAL';
  if (lowerTitle.includes('grid') || lowerTitle.includes('transmission')) return 'TRANSMISSION';
  if (lowerTitle.includes('price') || lowerTitle.includes('market')) return 'MARKET';
  
  return 'GENERAL';
}
```

---

## ENTSO-E Outage Parsing

### Fetching Outages
```javascript
async function fetchEntsoeOutages(country, days = 7) {
  const params = {
    documentType: 'A80',  // Generation unavailability
    biddingZone_domain: BIDDING_ZONES[country],
    periodStart: formatEntsoeDate(startDate),
    periodEnd: formatEntsoeDate(endDate),
    securityToken: process.env.ENTSOE_API_KEY
  };
  
  const response = await axios.get(ENTSOE_UMM_URL, { params });
  return parseOutageXML(response.data);
}
```

### XML Parsing
```javascript
function parseOutageXML(xml) {
  const parser = new XMLParser();
  const data = parser.parse(xml);
  
  const outages = [];
  const unavailabilities = data.GL_MarketDocument?.TimeSeries || [];
  
  for (const series of unavailabilities) {
    const assetName = series.Asset_RegisteredResource?.mRID?.['#text'] || 'Unknown';
    const capacity = parseInt(series.available_capacity?.quantity) || 0;
    const startTime = series.Period?.timeInterval?.start;
    const endTime = series.Period?.timeInterval?.end;
    
    outages.push({
      headline: `${assetName} - ${capacity}MW unavailable`,
      link: '#',
      timestamp: new Date(startTime),
      source: 'ENTSO-E',
      category: 'OUTAGE',
      details: {
        assetName,
        capacity,
        startTime,
        endTime
      }
    });
  }
  
  return outages;
}
```

---

## Server-Side Broadcasting

### Refresh Interval
```javascript
// server.js
const NEWS_REFRESH_INTERVAL = 30000; // 30 seconds

setInterval(async () => {
  try {
    const newsItems = await fetchNews();
    
    // Broadcast each news item to all connected clients
    newsItems.forEach(item => {
      io.emit('marketNews', {
        headline: item.headline,
        link: item.link,
        timestamp: item.timestamp,
        source: item.source
      });
    });
  } catch (error) {
    console.error('News broadcast error:', error);
  }
}, NEWS_REFRESH_INTERVAL);
```

### Initial Load
```javascript
io.on('connection', async (socket) => {
  console.log('Client connected:', socket.id);
  
  // Send last 10 news items to new client
  const recentNews = await getRecentNews(10);
  recentNews.forEach(item => {
    socket.emit('marketNews', item);
  });
});
```

---

## Client-Side Implementation

### Socket.IO Event Listener
```javascript
socket.on('marketNews', (news) => {
  const li = document.createElement('li');
  const link = document.createElement('a');
  
  link.href = news.link || '#';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = news.headline;
  link.style.color = '#00d4ff';
  link.style.textDecoration = 'none';
  link.style.transition = 'color 0.3s';
  
  // Hover effect
  link.onmouseover = function() { this.style.color = '#00ffff'; };
  link.onmouseout = function() { this.style.color = '#00d4ff'; };
  
  li.appendChild(link);
  newsList.prepend(li);  // Add to top (newest first)
  
  // FIFO: Remove oldest if exceeds 30 items
  if (newsList.children.length > 30) {
    newsList.removeChild(newsList.lastChild);
  }
});
```

### HTML Structure
```html
<div class="card compact-card news-feed clickable" data-gadget="news">
  <h3><i class="fas fa-newspaper"></i> Market News</h3>
  <ul id="newsList">
    <li>Welcome to the Energy Trading Dashboard!</li>
  </ul>
</div>
```

### CSS Styling
```css
.news-feed ul {
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.news-feed ul::-webkit-scrollbar {
  width: 6px;
}

.news-feed ul::-webkit-scrollbar-track {
  background: rgba(0, 212, 255, 0.1);
}

.news-feed ul::-webkit-scrollbar-thumb {
  background: rgba(0, 212, 255, 0.5);
  border-radius: 3px;
}

.news-feed li {
  padding: 0.5rem;
  border-bottom: 1px solid rgba(0, 212, 255, 0.2);
  font-size: 0.85rem;
  color: #e0e0e0;
}

.news-feed li:last-child {
  border-bottom: none;
}
```

---

## FIFO Queue Management

### Data Structure
```javascript
// Client-side in-memory queue
const newsQueue = [];
const MAX_NEWS_ITEMS = 30;
```

### Add to Queue
```javascript
function addNewsItem(item) {
  // Add to beginning (newest first)
  newsQueue.unshift(item);
  
  // Remove oldest items if exceeds limit
  if (newsQueue.length > MAX_NEWS_ITEMS) {
    newsQueue.splice(MAX_NEWS_ITEMS);
  }
  
  // Update DOM
  renderNewsList();
}
```

### Remove from Queue
```javascript
function removeOldestNewsItem() {
  if (newsQueue.length > MAX_NEWS_ITEMS) {
    newsQueue.pop();  // Remove from end (oldest)
  }
}
```

---

## Modal Expansion

### Trigger
```javascript
document.querySelector('.news-feed.clickable').addEventListener('click', (e) => {
  if (e.target.tagName === 'A') return;  // Don't intercept link clicks
  
  openGadgetModal('news');
});
```

### Modal Content Generation
```javascript
function openGadgetModal(gadgetType) {
  if (gadgetType === 'news') {
    gadgetModalTitle.innerHTML = '<i class="fas fa-newspaper"></i> Market News';
    
    const newsItems = Array.from(document.querySelectorAll('#newsList li'));
    let content = '<div style="padding: 1rem;">';
    
    if (newsItems.length > 0) {
      content += '<ul style="list-style: none; padding: 0; margin: 0;">';
      
      newsItems.forEach(item => {
        const link = item.querySelector('a');
        const timestamp = new Date().toLocaleString(); // Get from data attribute if stored
        
        content += `
          <li style="padding: 1rem; border-bottom: 1px solid rgba(0, 212, 255, 0.2); font-size: 0.95rem;">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
              <span style="color: #00d4ff; font-size: 0.8rem;">${timestamp}</span>
              <span style="color: rgba(255, 255, 255, 0.5); font-size: 0.75rem;">Energy Live News</span>
            </div>
            <a href="${link.href}" target="_blank" rel="noopener noreferrer" 
               style="color: #ffffff; text-decoration: none; font-size: 1rem; display: block; line-height: 1.4;">
              ${link.textContent}
            </a>
          </li>
        `;
      });
      
      content += '</ul>';
    } else {
      content += '<p style="text-align: center; color: rgba(255, 255, 255, 0.6);">No news items available</p>';
    }
    
    content += '</div>';
    
    gadgetModalContent.innerHTML = content;
  }
}
```

---

## Error Handling

### Network Errors
```javascript
async function fetchNews() {
  try {
    const feed = await parser.parseURL(NEWS_FEED_URL, {
      timeout: 10000
    });
    return processFeed(feed);
  } catch (error) {
    if (error.code === 'ENOTFOUND') {
      console.error('News feed unavailable - DNS resolution failed');
    } else if (error.code === 'ETIMEDOUT') {
      console.error('News feed timeout - server not responding');
    } else if (error.response?.status === 403) {
      console.error('News feed access forbidden - possible rate limit');
    } else {
      console.error('News fetch error:', error.message);
    }
    
    // Return empty array to continue operation
    return [];
  }
}
```

### SSL Certificate Issues
```javascript
// Development only - bypass SSL verification
if (process.env.NODE_ENV === 'development') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
```

**Production**: Use proper SSL certificates

### Parser Errors
```javascript
try {
  const feed = await parser.parseURL(url);
  
  // Validate feed structure
  if (!feed.items || !Array.isArray(feed.items)) {
    throw new Error('Invalid RSS feed structure');
  }
  
  return feed.items;
} catch (error) {
  console.error('RSS parsing error:', error);
  return [];
}
```

---

## Performance Optimization

### Caching Strategy
```javascript
// Server-side cache
const newsCache = {
  items: [],
  lastFetch: null,
  ttl: 30000  // 30 seconds
};

async function getCachedNews() {
  const now = Date.now();
  
  if (!newsCache.lastFetch || now - newsCache.lastFetch > newsCache.ttl) {
    newsCache.items = await fetchNews();
    newsCache.lastFetch = now;
  }
  
  return newsCache.items;
}
```

### Throttling Broadcasts
```javascript
// Limit broadcast rate to prevent overwhelming clients
const broadcastQueue = [];
let isBroadcasting = false;

function queueBroadcast(news) {
  broadcastQueue.push(news);
  
  if (!isBroadcasting) {
    processBroadcastQueue();
  }
}

async function processBroadcastQueue() {
  isBroadcasting = true;
  
  while (broadcastQueue.length > 0) {
    const news = broadcastQueue.shift();
    io.emit('marketNews', news);
    
    // Wait 100ms between broadcasts
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  isBroadcasting = false;
}
```

---

## Future Enhancements

### Multi-Source Aggregation
```javascript
const NEWS_SOURCES = [
  { url: 'https://www.energylivenews.com/feed/', name: 'Energy Live News' },
  { url: 'https://www.powertechnology.com/feed/', name: 'Power Technology' },
  { url: 'https://www.rechargenews.com/feed/', name: 'Recharge' }
];

async function fetchAllNews() {
  const promises = NEWS_SOURCES.map(source => 
    fetchNewsFromSource(source.url, source.name)
  );
  
  const results = await Promise.allSettled(promises);
  
  return results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => b.timestamp - a.timestamp);
}
```

### News Filtering
```javascript
// Filter by category
function filterNewsByCategory(newsItems, category) {
  return newsItems.filter(item => item.category === category);
}

// Filter by keywords
function filterNewsByKeywords(newsItems, keywords) {
  return newsItems.filter(item => 
    keywords.some(keyword => 
      item.headline.toLowerCase().includes(keyword.toLowerCase())
    )
  );
}
```

### Search Functionality
```javascript
function searchNews(query) {
  const lowerQuery = query.toLowerCase();
  
  return newsQueue.filter(item => 
    item.headline.toLowerCase().includes(lowerQuery) ||
    item.contentSnippet?.toLowerCase().includes(lowerQuery)
  );
}
```

### Persistent Storage
```javascript
// Store in TimescaleDB for historical analysis
async function saveNewsToDatabase(newsItem) {
  await pool.query(`
    INSERT INTO news_items (headline, link, timestamp, source, category)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (link) DO NOTHING
  `, [newsItem.headline, newsItem.link, newsItem.timestamp, newsItem.source, newsItem.category]);
}
```

---

## Testing

### Mock RSS Feed
```javascript
// test/mockRssFeed.js
const mockFeed = {
  items: [
    {
      title: 'Nuclear plant outage in France',
      link: 'https://example.com/article1',
      pubDate: new Date().toISOString(),
      contentSnippet: 'A 1000MW nuclear reactor has been shut down for maintenance.'
    },
    {
      title: 'Record wind generation in Nordic markets',
      link: 'https://example.com/article2',
      pubDate: new Date().toISOString(),
      contentSnippet: 'Wind power reaches 80% of total generation in Denmark.'
    }
  ]
};

module.exports = mockFeed;
```

### Unit Test
```javascript
const { fetchNews, categorizeNews } = require('../utils/newsParser');

test('categorize nuclear news correctly', () => {
  const category = categorizeNews('Nuclear plant outage in France');
  expect(category).toBe('NUCLEAR');
});

test('handle RSS feed timeout', async () => {
  const news = await fetchNews('http://invalid-url.com/feed');
  expect(news).toEqual([]);
});
```
