# AI Trading Advisor - Technical Specification

## Overview

The AI Trading Advisor provides context-aware market insights using a locally-hosted Ollama LLM (llama3:8b). Users can ask predefined questions or custom queries about market conditions, and receive intelligent responses based on current energy data.

---

## Architecture

### Components
1. **Ollama Server** - Local LLM runtime (llama3:8b model)
2. **AI Insights Module** - Node.js middleware for prompt engineering
3. **Socket.IO Integration** - Real-time Q&A communication
4. **Frontend UI** - Input field with datalist suggestions

### Data Flow
```
User Question → Socket.IO Client → Server → AI Insights Module → Ollama API → 
Context Assembly → Prompt Engineering → LLM Inference → Response → 
Socket.IO Server → Client → UI Display
```

---

## Ollama Integration

### Installation
```bash
# Windows (PowerShell)
winget install Ollama.Ollama

# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.ai/install.sh | sh
```

### Model Setup
```bash
# Pull llama3:8b model (4.7GB download)
ollama pull llama3:8b

# Verify installation
ollama list

# Test model
ollama run llama3:8b "Hello, how are you?"
```

### Server Configuration
```bash
# Start Ollama server (runs on http://localhost:11434)
ollama serve
```

**Autostart (Optional):**
- Windows: Add to Startup folder
- macOS/Linux: Create systemd service

---

## Configuration

### Environment Variables
```bash
# .env
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3:8b
OLLAMA_TIMEOUT=60000      # 60 seconds
OLLAMA_MAX_TOKENS=500     # Response length limit
OLLAMA_TEMPERATURE=0.7    # Creativity (0.0-1.0)
```

### Model Parameters
```javascript
const OLLAMA_CONFIG = {
  model: process.env.OLLAMA_MODEL || 'llama3:8b',
  temperature: parseFloat(process.env.OLLAMA_TEMPERATURE) || 0.7,
  max_tokens: parseInt(process.env.OLLAMA_MAX_TOKENS) || 500,
  top_p: 0.9,
  frequency_penalty: 0.5,
  presence_penalty: 0.5
};
```

---

## AI Insights Module

### Module Structure
```javascript
// utils/aiInsights.js
const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'llama3:8b';

class AIInsights {
  constructor() {
    this.apiUrl = `${OLLAMA_URL}/api/generate`;
  }

  async generateInsight(question, context) {
    const prompt = this.buildPrompt(question, context);
    
    try {
      const response = await axios.post(this.apiUrl, {
        model: MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          max_tokens: 500
        }
      }, {
        timeout: 60000
      });
      
      return response.data.response;
    } catch (error) {
      console.error('Ollama API error:', error.message);
      throw error;
    }
  }

  buildPrompt(question, context) {
    return `You are an energy trading advisor. Based on the following market data, answer the question concisely and professionally.

Market Data:
${JSON.stringify(context, null, 2)}

Question: ${question}

Answer:`;
  }
}

module.exports = new AIInsights();
```

---

## Prompt Engineering

### System Prompt Template
```javascript
const SYSTEM_PROMPT = `You are an expert energy trading advisor with deep knowledge of:
- European electricity markets (Poland, Hungary, Finland)
- Day-ahead pricing and forecasting
- Renewable energy integration (solar, wind)
- Load forecasting and demand patterns
- Market events and their impact on prices

Provide concise, data-driven insights. Use specific numbers from the market data when available.
Format your response in clear paragraphs, no more than 3-4 sentences.`;
```

### Context Assembly
```javascript
async function assembleMarketContext(country, period) {
  // Fetch latest data from TimescaleDB
  const data = await pool.query(`
    SELECT 
      AVG(actual_load) as avg_load,
      AVG(day_ahead_price) as avg_price,
      AVG(solar_generation + wind_onshore + wind_offshore) as avg_renewable,
      MAX(day_ahead_price) as max_price,
      MIN(day_ahead_price) as min_price
    FROM energy_data
    WHERE country = $1
      AND timestamp >= NOW() - INTERVAL '${period}'
    ORDER BY timestamp DESC
  `, [country]);

  // Fetch recent events
  const events = await pool.query(`
    SELECT event_type, category, title, affected_capacity
    FROM energy_events
    WHERE country = $1
      AND event_time >= NOW() - INTERVAL '7 days'
    ORDER BY event_time DESC
    LIMIT 5
  `, [country]);

  return {
    country: country,
    period: period,
    avgLoad: Math.round(data.rows[0].avg_load),
    avgPrice: Math.round(data.rows[0].avg_price * 100) / 100,
    avgRenewable: Math.round(data.rows[0].avg_renewable),
    renewableShare: Math.round((data.rows[0].avg_renewable / data.rows[0].avg_load) * 100),
    maxPrice: Math.round(data.rows[0].max_price * 100) / 100,
    minPrice: Math.round(data.rows[0].min_price * 100) / 100,
    priceVolatility: Math.round((data.rows[0].max_price - data.rows[0].min_price) * 100) / 100,
    recentEvents: events.rows.map(e => ({
      type: e.event_type,
      category: e.category,
      title: e.title,
      impact: e.affected_capacity ? `${e.affected_capacity}MW` : 'Unknown'
    }))
  };
}
```

### Complete Prompt Builder
```javascript
function buildPrompt(question, context) {
  const prompt = `${SYSTEM_PROMPT}

Current Market Context for ${context.country} (${context.period}):
- Average Load: ${context.avgLoad} MW
- Average Day-Ahead Price: €${context.avgPrice}/MWh
- Price Range: €${context.minPrice} - €${context.maxPrice}/MWh
- Price Volatility: €${context.priceVolatility}/MWh
- Renewable Generation: ${context.avgRenewable} MW (${context.renewableShare}% of load)

Recent Market Events:
${context.recentEvents.map((e, i) => `${i + 1}. [${e.category}] ${e.title} - Impact: ${e.impact}`).join('\n')}

User Question: ${question}

Provide a concise, data-driven answer (3-4 sentences max):`;

  return prompt;
}
```

---

## Predefined Questions

### Question Templates
```javascript
const PREDEFINED_QUESTIONS = [
  "What's the current market outlook?",
  "Should I buy or sell energy now?",
  "What are the main price drivers today?",
  "How do renewable forecasts affect prices?",
  "What's the impact of recent events?",
  "Is this a good time to trade?",
  "What are the risks in the current market?",
  "How does load compare to forecast?",
  "What's driving price volatility?",
  "Should I expect prices to rise or fall?",
  "What's the renewable energy outlook?",
  "How do events impact trading strategy?",
  "What are the supply-demand dynamics?",
  "Is the market overbought or oversold?",
  "What's your short-term price forecast?"
];
```

### Frontend Datalist
```html
<div id="aiAdvisor" class="card ai-advisor">
  <h3><i class="fas fa-brain"></i> AI Trading Advisor</h3>
  
  <div class="ai-input-container">
    <input 
      type="text" 
      id="aiQuestion" 
      list="questionSuggestions"
      placeholder="Ask a trading question..."
      autocomplete="off"
    />
    <datalist id="questionSuggestions">
      <option value="What's the current market outlook?">
      <option value="Should I buy or sell energy now?">
      <option value="What are the main price drivers today?">
      <option value="How do renewable forecasts affect prices?">
      <option value="What's the impact of recent events?">
      <option value="Is this a good time to trade?">
      <option value="What are the risks in the current market?">
      <option value="How does load compare to forecast?">
      <option value="What's driving price volatility?">
      <option value="Should I expect prices to rise or fall?">
      <option value="What's the renewable energy outlook?">
      <option value="How do events impact trading strategy?">
      <option value="What are the supply-demand dynamics?">
      <option value="Is the market overbought or oversold?">
      <option value="What's your short-term price forecast?">
    </datalist>
    <button id="askAiBtn" class="ask-btn">
      <i class="fas fa-paper-plane"></i> Ask
    </button>
  </div>
  
  <div id="aiResponse" class="ai-response">
    <p style="color: rgba(255, 255, 255, 0.5); text-align: center;">
      Ask a question to get AI-powered trading insights
    </p>
  </div>
</div>
```

---

## Socket.IO Integration

### Server-Side Handler
```javascript
// server.js
const aiInsights = require('./utils/aiInsights');

io.on('connection', (socket) => {
  socket.on('askAI', async (data) => {
    const { question, country, period } = data;
    
    try {
      // Show loading state
      socket.emit('aiThinking', { status: 'thinking' });
      
      // Assemble context from current market data
      const context = await assembleMarketContext(country, period);
      
      // Generate AI response
      const answer = await aiInsights.generateInsight(question, context);
      
      // Send response to client
      socket.emit('aiResponse', {
        question: question,
        answer: answer,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('AI advisor error:', error);
      
      let errorMessage = 'Failed to generate insight. ';
      
      if (error.code === 'ECONNREFUSED') {
        errorMessage += 'Ollama server is not running. Please start it with: ollama serve';
      } else if (error.response?.status === 404) {
        errorMessage += 'Model not found. Please run: ollama pull llama3:8b';
      } else {
        errorMessage += error.message;
      }
      
      socket.emit('aiError', { error: errorMessage });
    }
  });
});
```

### Client-Side Handler
```javascript
// public/index.html
const askAiBtn = document.getElementById('askAiBtn');
const aiQuestion = document.getElementById('aiQuestion');
const aiResponse = document.getElementById('aiResponse');

// Ask question
askAiBtn.addEventListener('click', () => {
  const question = aiQuestion.value.trim();
  
  if (!question) {
    alert('Please enter a question');
    return;
  }
  
  // Send to server
  socket.emit('askAI', {
    question: question,
    country: currentCountry,
    period: currentPeriod
  });
  
  // Clear input
  aiQuestion.value = '';
});

// Enter key support
aiQuestion.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    askAiBtn.click();
  }
});

// Thinking state
socket.on('aiThinking', () => {
  aiResponse.innerHTML = `
    <div class="ai-thinking">
      <i class="fas fa-spinner fa-spin"></i>
      <span>Analyzing market data...</span>
    </div>
  `;
});

// Response received
socket.on('aiResponse', (data) => {
  const timestamp = new Date(data.timestamp).toLocaleTimeString();
  
  aiResponse.innerHTML = `
    <div class="ai-answer">
      <div class="ai-question-label">
        <strong>Q:</strong> ${data.question}
      </div>
      <div class="ai-answer-text">
        <strong>A:</strong> ${data.answer}
      </div>
      <div class="ai-timestamp">${timestamp}</div>
    </div>
  `;
});

// Error handling
socket.on('aiError', (data) => {
  aiResponse.innerHTML = `
    <div class="ai-error">
      <i class="fas fa-exclamation-triangle"></i>
      <p>${data.error}</p>
    </div>
  `;
});
```

---

## UI Components

### CSS Styling
```css
.ai-advisor {
  display: flex;
  flex-direction: column;
  min-height: 300px;
}

.ai-input-container {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.ai-input-container input {
  flex: 1;
  padding: 0.75rem;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(0, 212, 255, 0.3);
  border-radius: 4px;
  color: #ffffff;
  font-size: 0.9rem;
}

.ai-input-container input:focus {
  outline: none;
  border-color: rgba(0, 212, 255, 0.6);
}

.ask-btn {
  padding: 0.75rem 1.5rem;
  background: linear-gradient(135deg, #00d4ff, #0099cc);
  border: none;
  border-radius: 4px;
  color: #ffffff;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.ask-btn:hover {
  background: linear-gradient(135deg, #00ffff, #00d4ff);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 212, 255, 0.4);
}

.ask-btn:active {
  transform: translateY(0);
}

.ai-response {
  flex: 1;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(0, 212, 255, 0.2);
  border-radius: 4px;
  overflow-y: auto;
}

.ai-thinking {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: rgba(0, 212, 255, 0.8);
  font-style: italic;
}

.ai-answer {
  line-height: 1.6;
}

.ai-question-label {
  color: rgba(0, 212, 255, 0.9);
  margin-bottom: 0.5rem;
}

.ai-answer-text {
  color: #ffffff;
  margin-bottom: 0.75rem;
}

.ai-timestamp {
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.75rem;
  text-align: right;
}

.ai-error {
  color: #ff4444;
  text-align: center;
}

.ai-error i {
  font-size: 2rem;
  margin-bottom: 0.5rem;
  display: block;
}
```

---

## Error Handling

### Ollama Not Running
```javascript
try {
  const response = await axios.post(ollamaUrl, payload, { timeout: 5000 });
} catch (error) {
  if (error.code === 'ECONNREFUSED') {
    throw new Error('Ollama server is not running. Please start it with: ollama serve');
  }
  throw error;
}
```

### Model Not Installed
```javascript
try {
  const response = await axios.post(ollamaUrl, { model: MODEL, ... });
} catch (error) {
  if (error.response?.status === 404) {
    throw new Error(`Model "${MODEL}" not found. Install with: ollama pull ${MODEL}`);
  }
  throw error;
}
```

### Timeout Handling
```javascript
const TIMEOUT_MS = 60000; // 60 seconds

try {
  const response = await axios.post(ollamaUrl, payload, {
    timeout: TIMEOUT_MS
  });
} catch (error) {
  if (error.code === 'ECONNABORTED') {
    throw new Error('AI request timed out. The model may be too slow or overloaded.');
  }
  throw error;
}
```

### Rate Limiting
```javascript
// Prevent spam
const rateLimiter = new Map();
const RATE_LIMIT_WINDOW = 10000; // 10 seconds
const MAX_REQUESTS = 3;

socket.on('askAI', async (data) => {
  const socketId = socket.id;
  const now = Date.now();
  
  // Get request history
  if (!rateLimiter.has(socketId)) {
    rateLimiter.set(socketId, []);
  }
  
  const requests = rateLimiter.get(socketId);
  
  // Remove old requests
  const recentRequests = requests.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  // Check limit
  if (recentRequests.length >= MAX_REQUESTS) {
    socket.emit('aiError', {
      error: 'Too many requests. Please wait 10 seconds before asking again.'
    });
    return;
  }
  
  // Add current request
  recentRequests.push(now);
  rateLimiter.set(socketId, recentRequests);
  
  // Process request
  // ... (existing code)
});
```

---

## Performance Characteristics

### Response Times
- **Average:** 2-5 seconds (llama3:8b on modern CPU)
- **First Request:** 5-10 seconds (model loading)
- **Subsequent Requests:** 2-4 seconds (model in memory)

### Hardware Requirements
- **Minimum:** 8GB RAM, 4-core CPU
- **Recommended:** 16GB RAM, 8-core CPU
- **GPU (Optional):** NVIDIA GPU with CUDA for 10x faster inference

### Resource Usage
```javascript
// Monitor Ollama process
const si = require('systeminformation');

async function getOllamaStats() {
  const processes = await si.processes();
  const ollamaProc = processes.list.find(p => p.name.includes('ollama'));
  
  if (ollamaProc) {
    return {
      cpu: ollamaProc.cpu,
      memory: ollamaProc.mem,
      pid: ollamaProc.pid
    };
  }
  
  return null;
}
```

---

## Optimization Strategies

### Model Selection
```javascript
// Smaller models for faster responses
const MODELS = {
  'llama3:8b': { size: '4.7GB', speed: 'medium', quality: 'high' },
  'mistral:7b': { size: '4.1GB', speed: 'fast', quality: 'good' },
  'phi3:mini': { size: '2.3GB', speed: 'very fast', quality: 'fair' }
};
```

### Context Pruning
```javascript
// Reduce context size for faster inference
function pruneContext(context) {
  return {
    avgLoad: context.avgLoad,
    avgPrice: context.avgPrice,
    renewableShare: context.renewableShare,
    priceVolatility: context.priceVolatility,
    recentEvents: context.recentEvents.slice(0, 3)  // Only 3 most recent
  };
}
```

### Caching Responses
```javascript
// Cache responses for common questions
const responseCache = new Map();
const CACHE_TTL = 300000; // 5 minutes

function getCacheKey(question, country, period) {
  return `${question}_${country}_${period}`;
}

async function getCachedResponse(question, country, period) {
  const key = getCacheKey(question, country, period);
  const cached = responseCache.get(key);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.response;
  }
  
  return null;
}

function cacheResponse(question, country, period, response) {
  const key = getCacheKey(question, country, period);
  responseCache.set(key, {
    response: response,
    timestamp: Date.now()
  });
}
```

---

## Testing

### Mock Ollama Server
```javascript
// test/mockOllama.js
const express = require('express');
const app = express();
app.use(express.json());

app.post('/api/generate', (req, res) => {
  const { prompt } = req.body;
  
  // Simulate 2-second delay
  setTimeout(() => {
    res.json({
      response: 'This is a mock AI response for testing purposes.'
    });
  }, 2000);
});

app.listen(11434, () => {
  console.log('Mock Ollama server running on port 11434');
});
```

### Unit Tests
```javascript
const aiInsights = require('../utils/aiInsights');

test('generate insight with valid context', async () => {
  const context = {
    country: 'PL',
    avgLoad: 12500,
    avgPrice: 85.5,
    renewableShare: 28
  };
  
  const response = await aiInsights.generateInsight(
    'What is the current market outlook?',
    context
  );
  
  expect(response).toBeTruthy();
  expect(typeof response).toBe('string');
});

test('handle Ollama connection error', async () => {
  // Stop Ollama server before test
  await expect(
    aiInsights.generateInsight('test question', {})
  ).rejects.toThrow('Ollama server is not running');
});
```

---

## Security Considerations

### Input Sanitization
```javascript
function sanitizeQuestion(question) {
  // Remove HTML tags
  question = question.replace(/<[^>]*>/g, '');
  
  // Limit length
  if (question.length > 500) {
    question = question.substring(0, 500);
  }
  
  // Remove special characters that could break prompts
  question = question.replace(/[\{\}\[\]]/g, '');
  
  return question.trim();
}
```

### Prompt Injection Prevention
```javascript
function detectPromptInjection(question) {
  const suspiciousPatterns = [
    /ignore.*previous.*instructions/i,
    /you.*are.*now/i,
    /system.*prompt/i,
    /\[system\]/i,
    /\[\/system\]/i
  ];
  
  return suspiciousPatterns.some(pattern => pattern.test(question));
}

socket.on('askAI', async (data) => {
  const { question } = data;
  
  if (detectPromptInjection(question)) {
    socket.emit('aiError', {
      error: 'Invalid question detected. Please ask a legitimate trading question.'
    });
    return;
  }
  
  // Continue with request...
});
```

### Response Filtering
```javascript
function filterResponse(response) {
  // Remove any personal information (unlikely but safety check)
  response = response.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED]');
  
  // Remove potentially malicious scripts
  response = response.replace(/<script.*?>.*?<\/script>/gi, '');
  
  return response;
}
```

---

## Future Enhancements

### Multi-Turn Conversations
```javascript
// Maintain conversation history
const conversations = new Map();

socket.on('askAI', async (data) => {
  const conversationId = socket.id;
  
  if (!conversations.has(conversationId)) {
    conversations.set(conversationId, []);
  }
  
  const history = conversations.get(conversationId);
  history.push({ role: 'user', content: data.question });
  
  // Build prompt with conversation history
  const prompt = buildConversationalPrompt(history, context);
  
  const response = await aiInsights.generateInsight(prompt, context);
  
  history.push({ role: 'assistant', content: response });
  
  // Limit history to last 5 exchanges
  if (history.length > 10) {
    history.splice(0, history.length - 10);
  }
  
  socket.emit('aiResponse', { answer: response });
});
```

### Voice Input
```javascript
// Use Web Speech API for voice questions
const recognition = new webkitSpeechRecognition();
recognition.continuous = false;
recognition.lang = 'en-US';

recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  aiQuestion.value = transcript;
  askAiBtn.click();
};

voiceBtn.addEventListener('click', () => {
  recognition.start();
});
```

### Sentiment Analysis
```javascript
async function analyzeSentiment(answer) {
  // Detect bullish/bearish sentiment in AI response
  const bullishWords = ['buy', 'increase', 'rise', 'high', 'strong', 'positive'];
  const bearishWords = ['sell', 'decrease', 'fall', 'low', 'weak', 'negative'];
  
  const lowerAnswer = answer.toLowerCase();
  
  const bullishCount = bullishWords.filter(w => lowerAnswer.includes(w)).length;
  const bearishCount = bearishWords.filter(w => lowerAnswer.includes(w)).length;
  
  if (bullishCount > bearishCount) return 'BULLISH';
  if (bearishCount > bullishCount) return 'BEARISH';
  return 'NEUTRAL';
}
```
