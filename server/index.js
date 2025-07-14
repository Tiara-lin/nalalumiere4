import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080; // Railway 預設使用 8080，注意！

// ✅ CORS 設定
const corsOptions = {
  origin: 'https://tiara-lin.github.io',
  credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ✅ 手動 Header 保險
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://tiara-lin.github.io');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.use(express.json());

// ✅ MongoDB 初始化
let db;
const client = new MongoClient(process.env.MONGODB_URI);

async function connectToMongoDB() {
  try {
    await client.connect();
    db = client.db(process.env.DB_NAME || 'instagram_analytics');
    console.log('✅ Connected to MongoDB');

    await db.collection('user_interactions').createIndex({ timestamp: -1 });
    await db.collection('user_interactions').createIndex({ ip_address: 1 });
    await db.collection('user_interactions').createIndex({ post_id: 1 });
    await db.collection('user_sessions').createIndex({ ip_address: 1 });
    await db.collection('user_sessions').createIndex({ session_start: -1 });
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

function getClientIP(req) {
  return (
    req.headers['x-forwarded-for'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.ip
  );
}

function getDeviceInfo(req) {
  const userAgent = req.headers['user-agent'] || '';
  const isMobile = /Mobile|Android|iPhone|iPad/.test(userAgent);
  const browser = userAgent.match(/(Chrome|Firefox|Safari|Edge|Opera)/i)?.[0] || 'Unknown';
  return {
    user_agent: userAgent,
    is_mobile: isMobile,
    browser,
    device_type: isMobile ? 'mobile' : 'desktop'
  };
}

app.post('/api/track/session', async (req, res) => {
  try {
    const ip_address = getClientIP(req);
    const device_info = getDeviceInfo(req);
    const { page_url } = req.body;

    const sessionData = {
      ip_address,
      session_start: new Date(),
      page_url,
      ...device_info,
      session_id: `${ip_address}_${Date.now()}`
    };

    await db.collection('user_sessions').insertOne(sessionData);
    res.json({ success: true, session_id: sessionData.session_id });
  } catch (error) {
    console.error('Session tracking error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/track/interaction', async (req, res) => {
  try {
    const ip_address = getClientIP(req);
    const device_info = getDeviceInfo(req);
    const { action_type, post_id, post_username, session_id, additional_data } = req.body;

    const interactionData = {
      ip_address,
      action_type,
      post_id,
      post_username,
      session_id,
      timestamp: new Date(),
      additional_data: additional_data || {},
      ...device_info
    };

    await db.collection('user_interactions').insertOne(interactionData);
    res.json({ success: true, message: 'Interaction tracked successfully' });
  } catch (error) {
    console.error('Interaction tracking error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/track/post-view', async (req, res) => {
  try {
    const ip_address = getClientIP(req);
    const device_info = getDeviceInfo(req);
    const { post_id, post_username, session_id, view_duration, scroll_percentage, media_type } = req.body;

    const viewData = {
      ip_address,
      action_type: 'post_view',
      post_id,
      post_username,
      session_id,
      timestamp: new Date(),
      view_duration,
      scroll_percentage,
      media_type,
      ...device_info
    };

    await db.collection('user_interactions').insertOne(viewData);
    res.json({ success: true, message: 'Post view tracked successfully' });
  } catch (error) {
    console.error('Post view tracking error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/session/scroll-stats', async (req, res) => {
  try {
    const scrolls = await db.collection('user_interactions').aggregate([
      { $match: { action_type: 'final_max_scroll' } },
      {
        $group: {
          _id: null,
          avgScroll: { $avg: '$additional_data.max_scroll_percentage' },
          maxScroll: { $max: '$additional_data.max_scroll_percentage' },
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    const result = scrolls[0] || { avgScroll: 0, maxScroll: 0, count: 0 };
    res.json({
      success: true,
      data: {
        average_max_scroll: result.avgScroll,
        highest_max_scroll: result.maxScroll,
        total_sessions: result.count
      }
    });
  } catch (error) {
    console.error('Session scroll stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/posts/stats', async (req, res) => {
  try {
    const ids = req.query.ids?.split(',').map(id => id.trim()).filter(Boolean);
    if (!ids || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing or invalid post IDs' });
    }

    const interactionStats = await db.collection('user_interactions').aggregate([
      { $match: { post_id: { $in: ids } } },
      {
        $group: {
          _id: { post_id: '$post_id', action_type: '$action_type' },
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    const results = {};
    ids.forEach(id => {
      results[id] = { post_id: id, views: 0, likes: 0, saves: 0, shares: 0, comments: 0 };
    });

    interactionStats.forEach(({ _id, count }) => {
      const { post_id, action_type } = _id;
      if (results[post_id]) {
        if (action_type === 'post_view') results[post_id].views = count;
        if (action_type === 'like') results[post_id].likes = count;
        if (action_type === 'save') results[post_id].saves = count;
        if (action_type === 'share') results[post_id].shares = count;
        if (action_type === 'comment') results[post_id].comments = count;
      }
    });

    res.json({ success: true, data: Object.values(results) });
  } catch (error) {
    console.error('Bulk post stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ 健康檢查 - 改用簡單測試
app.get('/api/health', async (req, res) => {
  try {
    const result = await db.listCollections().toArray();
    res.json({ success: true, collections: result.length, timestamp: new Date() });
  } catch (err) {
    res.status(503).json({ success: false, error: 'MongoDB not responding', detail: err.message });
  }
});

// ⛔️ SIGINT shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Gracefully shutting down...');
  await client.close();
  process.exit(0);
});

// ✅ 啟動伺服器
async function startServer() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await connectToMongoDB();
    console.log('🚀 Starting Express...');
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
