const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

function parseUnitValue(text) {
  if (!text) return null;
  const cleanText = text.replace(/,/g, '');
  const match = cleanText.match(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg|개|입|매|p)/i);
  if (!match) return null;

  let val = parseFloat(match[1]);
  let unit = match[2].toLowerCase();

  if (unit === 'l') { val *= 1000; unit = 'ml'; }
  if (unit === 'kg') { val *= 1000; unit = 'g'; }
  
  return { val, unit };
}

app.get('/api/search', async (req, res) => {
  const keyword = req.query.keyword;
  const minPrice = req.query.minPrice ? parseInt(req.query.minPrice, 10) : null;
  const maxPrice = req.query.maxPrice ? parseInt(req.query.maxPrice, 10) : null;
  const volume = req.query.volume ? req.query.volume.trim().toLowerCase() : null;
  const volumeOp = req.query.volumeOp;

  if (!keyword) return res.status(400).json({ error: '검색어가 필요합니다.' });

  let results = [];

  try {
    const danawaUrl = `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(keyword)}`;
    const response = await axios.get(danawaUrl, { headers });
    const $ = cheerio.load(response.data);

    $('.product_list .prod_item').each((i, el) => {
      const title = $(el).find('.prod_name a').text().trim();
      const priceText = $(el).find('.price_sect strong').first().text().replace(/[^0-9]/g, '');
      const price = parseInt(priceText, 10);
      let img = $(el).find('.thumb_image img').attr('src') || $(el).find('.thumb_image img').attr('data-original');
      const link = $(el).find('.prod_name a').attr('href');

      if (img && img.startsWith('//')) img = 'https:' + img;
      const isAccessory = title.includes('필름') || title.includes('케이스') || title.includes('커버');

      if (title && price && !isAccessory) {
        results.push({
          source: '다나와',
          title,
          price,
          image: img || '',
          link: link || '#'
        });
      }
    });
  } catch (err) {
    console.error('다나와 수집 에러:', err.message);
  }

  results = results.filter(item => {
    if (minPrice !== null && !isNaN(minPrice) && item.price < minPrice) return false;
    if (maxPrice !== null && !isNaN(maxPrice) && item.price > maxPrice) return false;

    if (volume) {
      const userSpec = parseUnitValue(volume);
      const itemSpec = parseUnitValue(item.title);

      if (userSpec && itemSpec) {
        if (userSpec.unit === itemSpec.unit) {
          if (volumeOp === 'gte' && itemSpec.val < userSpec.val) return false;
          if (volumeOp === 'lte' && itemSpec.val > userSpec.val) return false;
        }
      } else if (userSpec && !itemSpec) {
        return false;
      }
    }

    return true;
  });

  results.sort((a, b) => a.price - b.price);

  res.json(results);
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
