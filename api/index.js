const express = require('express');
const axios = require('axios');
const cors = require('cors');
const serverless = require('serverless-http');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const LUNARCRUSH_BEARER_TOKEN = process.env.LUNARCRUSH_BEARER_TOKEN;

// Endpoint to fetch BTC news or social data
app.get('/api/btc-data', async (req, res) => {
    console.log("server was access!!!!")
    try {
        const response = await axios({
            url: 'https://lunarcrush.com/api4/public/topic/bitcoin/news/v1',
            headers: {
                'Authorization': `Bearer ${LUNARCRUSH_BEARER_TOKEN}`,
            },
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching LunarCrush data:', error.message);
        res.status(500).json({ error: 'Failed to fetch data' });
    }
});




// Endpoint to fetch Bitcoin social dominance
app.get('/api/social-data', async (req, res) => {
  const { interval } = req.query;

  if (!interval || !['2h', '7h', '24h'].includes(interval)) {
    return res.status(400).json({ error: 'Invalid or missing interval. Must be 2h, 7h, or 24h.' });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    let start, bucketSize;
    switch (interval) {
      case '2h':
        start = now - 1 * 60 * 60; // Last 1 hour
        bucketSize = 2 * 60; // 2 minutes
        break;
      case '7h':
        start = now - 7 * 60 * 60; // Last 7 hours
        bucketSize = 4 * 60; // 4 minutes
        break;
      case '24h':
        start = now - 24 * 60 * 60; // Last 24 hours
        bucketSize = 8 * 60; // 8 minutes
        break;
      default:
        throw new Error('Invalid interval');
    }

    console.log(`Time Range: start=${start}, end=${now}, bucketSize=${bucketSize}`);

    const response = await axios.get('https://lunarcrush.com/api4/public/coins/1/time-series/v2', {
      headers: {
        Authorization: `Bearer ${process.env.LUNARCRUSH_BEARER_TOKEN}`,
      },
      params: {
        bucket: 'minute',
        start,
        end: now,
      },
    });

    console.log('LunarCrush Response:', JSON.stringify(response.data, null, 2));

    if (!response.data.data || !Array.isArray(response.data.data)) {
      console.error('No data array in response');
      const mockData = Array.from({ length: Math.ceil((now - start) / bucketSize) }, (_, i) => ({
        time: start + i * bucketSize,
        mentions: Math.round(100 + Math.random() * 50),
      }));
      console.warn('Using mock data due to empty response');
      return res.json({
        data: mockData,
        trend: 'bullish',
      });
    }

    const filteredData = response.data.data
      .filter((point) => {
        const isValid =
          point.social_volume !== undefined &&
          point.social_volume !== null &&
          !isNaN(point.social_volume) &&
          point.social_volume >= 0 &&
          point.time && typeof point.time === 'number';
        if (!isValid) console.warn('Invalid data point:', point);
        return isValid;
      })
      .sort((a, b) => a.time - b.time);

    if (filteredData.length === 0) {
      console.error('No valid mention data after filtering');
      console.warn('Retrying with bucket=hour');
      const hourlyResponse = await axios.get('https://lunarcrush.com/api4/public/coins/1/time-series/v2', {
        headers: {
          Authorization: `Bearer ${process.env.LUNARCRUSH_BEARER_TOKEN}`,
        },
        params: {
          bucket: 'hour',
          start,
          end: now,
        },
      });

      const hourlyData = hourlyResponse.data.data
        ? hourlyResponse.data.data
            .filter((point) => {
              const isValid =
                point.social_volume !== undefined &&
                point.social_volume !== null &&
                !isNaN(point.social_volume) &&
                point.social_volume >= 0 &&
                point.time && typeof point.time === 'number';
              if (!isValid) console.warn('Invalid hourly data point:', point);
              return isValid;
            })
            .sort((a, b) => a.time - b.time)
        : [];

      if (hourlyData.length === 0) {
        console.error('No valid hourly data after filtering');
        const mockData = Array.from({ length: Math.ceil((now - start) / bucketSize) }, (_, i) => ({
          time: start + i * bucketSize,
          mentions: Math.round(100 + Math.random() * 50),
        }));
        return res.json({
          data: mockData,
          trend: 'bullish',
        });
      }

      // Aggregate hourly data
      const aggregatedHourlyData = [];
      for (let t = start; t < now; t += bucketSize) {
        const bucketPoints = hourlyData.filter(
          (p) => p.time >= t && p.time < t + bucketSize
        );
        if (bucketPoints.length > 0) {
          const avgMentions =
            bucketPoints.reduce((sum, p) => sum + p.social_volume, 0) /
            bucketPoints.length;
          aggregatedHourlyData.push({
            time: t,
            mentions: Math.round(avgMentions),
          });
        }
      }

      let trend = 'bullish';
      if (aggregatedHourlyData.length > 1) {
        const latestMentions = aggregatedHourlyData[aggregatedHourlyData.length - 1].mentions;
        const previousMentions = aggregatedHourlyData[aggregatedHourlyData.length - 2].mentions;
        const percentageChange =
          previousMentions > 0
            ? ((latestMentions - previousMentions) / previousMentions) * 100
            : 0;
        trend = percentageChange > 0 ? 'bullish' : percentageChange <= -5 ? 'bearish' : trend;
        console.log(
          `Hourly Trend Calculation: latest=${latestMentions}, previous=${previousMentions}, change=${percentageChange.toFixed(2)}%, trend=${trend}`
        );
      }

      return res.json({
        data: aggregatedHourlyData,
        trend,
      });
    }

    // Aggregate minute data
    const aggregatedData = [];
    for (let t = start; t < now; t += bucketSize) {
      const bucketPoints = filteredData.filter(
        (p) => p.time >= t && p.time < t + bucketSize
      );
      if (bucketPoints.length > 0) {
        const avgMentions =
          bucketPoints.reduce((sum, p) => sum + p.social_volume, 0) /
          bucketPoints.length;
        aggregatedData.push({
          time: t,
          mentions: Math.round(avgMentions),
        });
      }
    }

    if (aggregatedData.length === 0) {
      console.error('No data after aggregation');
      const mockData = Array.from({ length: Math.ceil((now - start) / bucketSize) }, (_, i) => ({
        time: start + i * bucketSize,
        mentions: Math.round(100 + Math.random() * 50),
      }));
      return res.json({
        data: mockData,
        trend: 'bullish',
      });
    }

    let trend = 'bullish';
    if (aggregatedData.length > 1) {
      const latestMentions = aggregatedData[aggregatedData.length - 1].mentions;
      const previousMentions = aggregatedData[aggregatedData.length - 2].mentions;
      const percentageChange =
        previousMentions > 0
          ? ((latestMentions - previousMentions) / previousMentions) * 100
          : 0;
      trend = percentageChange > 0 ? 'bullish' : percentageChange <= -5 ? 'bearish' : trend;
      console.log(
        `Trend Calculation: latest=${latestMentions}, previous=${previousMentions}, change=${percentageChange.toFixed(2)}%, trend=${trend}`
      );
    }

    res.json({
      data: aggregatedData,
      trend,
    });
  } catch (error) {
    console.error('LunarCrush API Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error || 'Failed to fetch data from LunarCrush.',
    });
  }
}); 

// app.listen(port, () => {
//     console.log(`Server running on port ${port}`);
// });

module.exports.handler = serverless(app);