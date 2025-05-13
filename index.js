const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

const allowedOrigins = [
  'https://btc-sd-final.vercel.app', // Your frontend's production URL
  'http://localhost:3000',           // For local development
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (e.g., server-to-server requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: false, // Set to true if you need cookies or auth headers
}));




app.use(express.json());

const LUNARCRUSH_BEARER_TOKEN = process.env.LUNARCRUSH_BEARER_TOKEN;

// Endpoint to fetch BTC news or social data
// app.get('/api/btc-data', async (req, res) => {
//   console.log('Server accessed: /api/btc-data');
//   try {
//     const response = await axios({
//       url: 'https://lunarcrush.com/api4/public/topic/bitcoin/news/v1',
//       headers: {
//         Authorization: `Bearer ${LUNARCRUSH_BEARER_TOKEN}`,
//       },
//     });
//     res.json(response.data);
//   } catch (error) {
//     console.error('Error fetching LunarCrush data:', error.message);
//     res.status(500).json({ error: 'Failed to fetch data' });
//   }
// });


app.get('/api/btc-data', async (req, res) => {
  console.log('Server accessed: /api/btc-data');
  try {
    const response = await axios({
      url: 'https://lunarcrush.com/api4/public/topic/bitcoin/posts/v1',
      headers: {
        Authorization: `Bearer ${LUNARCRUSH_BEARER_TOKEN}`,
      },
      params: {
        limit: 50, // Fetch up to 50 posts
      },
      timeout: 10000,
    });

    const posts = response.data.data || [];
    if (!Array.isArray(posts)) {
      console.error('Invalid posts data:', response.data);
      return res.status(500).json({ error: 'Invalid data from LunarCrush' });
    }

    // Categorize posts by follower count
    const regularUsers = posts.filter(post => post.creator_followers <= 10000);
    const influencers = posts.filter(post => post.creator_followers > 10000);

    // Balance the output: up to 10 from each group
    const balancedPosts = [
      ...regularUsers.slice(0, 10),
      ...influencers.slice(0, 10),
    ].slice(0, 20); // Cap at 20 total

    // Transform to LunarCrushPost format
    const formattedPosts = balancedPosts.map(post => ({
      creator_avatar: post.creator_avatar || 'https://default-avatar.png',
      creator_display_name: post.creator_display_name || post.creator_name || 'Anonymous',
      creator_name: post.creator_name || 'unknown',
      creator_followers: post.creator_followers || 0,
      post_title: post.post_title || post.body || 'No content available',
      post_link: post.post_link || `https://x.com/${post.creator_name}/status/${post.post_id || ''}`,
    }));

    console.log(`Returning ${formattedPosts.length} posts`);
    res.json({ data: formattedPosts });
  } catch (error) {
    console.error('Error fetching LunarCrush data:', error.message, error.response?.data);
    if (error.response?.status === 429) {
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }
    res.status(500).json({ error: 'Failed to fetch data from LunarCrush' });
  }
});

// Endpoint to fetch Bitcoin social dominance
app.get('/api/social-data', async (req, res) => {
  const { interval } = req.query;

  // Validate interval
  if (!interval || !['1h', '7h', '24h'].includes(interval)) {
    return res.status(400).json({ error: 'Invalid or missing interval. Must be 1h, 7h, or 24h.' });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    let start;
    switch (interval) {
      case '1h':
        start = now - 2 * 60 * 60; // Last 2 hours to ensure enough data for trend
        break;
      case '7h':
        start = now - 7 * 60 * 60; // Last 7 hours
        break;
      case '24h':
        start = now - 24 * 60 * 60; // Last 24 hours
        break;
    }

    console.log(`Fetching data: interval=${interval}, start=${start}, end=${now}`);

    const response = await axios.get('https://lunarcrush.com/api4/public/topic/bitcoin/time-series/v1', {
      headers: {
        Authorization: `Bearer ${LUNARCRUSH_BEARER_TOKEN}`,
      },
      params: {
        bucket: 'hour',
        start,
        end: now,
      },
    });

    console.log('LunarCrush Response:', JSON.stringify(response.data, null, 2));

    if (!response.data.data || !Array.isArray(response.data.data)) {
      console.error('No data array in response');
      return res.status(500).json({ error: 'No valid data returned from LunarCrush API.' });
    }

    // Filter and sort data
    const filteredData = response.data.data
      .filter((point) => {
        const isValid =
          point.posts_created !== undefined &&
          point.posts_created !== null &&
          !isNaN(point.posts_created) &&
          point.posts_created >= 0 &&
          point.time && typeof point.time === 'number';
        if (!isValid) console.warn('Invalid data point:', point);
        return isValid;
      })
      .sort((a, b) => a.time - b.time)
      .map((point) => ({
        time: point.time,
        mentions: point.posts_created,
      }));

    if (filteredData.length === 0) {
      console.error('No valid mention data after filtering');
      return res.status(500).json({ error: 'No valid mention data available.' });
    }

    // Calculate trend based on the last two points
    let trend = 'bullish';
    if (filteredData.length > 1) {
      const latestMentions = filteredData[filteredData.length - 1].mentions;
      const previousMentions = filteredData[filteredData.length - 2].mentions;
      const percentageChange =
        previousMentions > 0
          ? ((latestMentions - previousMentions) / previousMentions) * 100
          : 0;
      trend = percentageChange > 0 ? 'bullish' : 'bearish';
      console.log(
        `Trend Calculation: latest=${latestMentions}, previous=${previousMentions}, change=${percentageChange.toFixed(2)}%, trend=${trend}`
      );
    }

    // For frontend to calculate segment colors, include deltas
    const dataWithDeltas = filteredData.map((point, index) => {
      if (index === 0) {
        return { ...point, delta: 0 };
      }
      const delta = point.mentions - filteredData[index - 1].mentions;
      return { ...point, delta };
    });

    res.json({
      data: dataWithDeltas,
      trend,
    });
  } catch (error) {
    console.error('LunarCrush API Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to fetch data from LunarCrush.',
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});