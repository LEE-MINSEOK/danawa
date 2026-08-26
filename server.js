// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 3000;

function parseUnitValue(text) {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg|개|입|매|p)/i);
  if (!match) return null;
  let val = parseFloat(match[1]);
  let unit = match[2].toLowerCase();
  if (unit === 'l') { val *= 1000; unit = 'ml'; }
  if (unit === 'kg') { val *= 1000; unit = 'g'; }
  return { val, unit };
}

async function fetchDanawa(keyword) {
  const results = [];
  try {
    const url = `https://search.danawa.com/dsearch.php?query=${encodeURIComponent(keyword)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    
    const blocks = html.match(/<li class="prod_item[^"]*">([\s\S]*?)<\/li>/g) || [];
    for (const block of blocks) {
      const titleMatch = block.match(/class="prod_name[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      const priceMatch = block.match(/class="price_sect"[^>]*>([\s\S]*?)<\/strong>/);
      const imgMatch = block.match(/class="thumb_image"[^>]*>[\s\S]*?src="([^"]+)"/);
      const linkMatch = block.match(/class="prod_name[^"]*"[^>]*href="([^"]+)"/);

      if (titleMatch && priceMatch) {
        const title = titleMatch[1].replace(/<[^>]*>/g, '').trim();
        const priceText = priceMatch[1].replace(/[^0-9]/g, '');
        const price = parseInt(priceText, 10);
        let image = imgMatch ? imgMatch[1] : '';
        if (image.startsWith('//')) image = 'https:' + image;
        const link = linkMatch ? linkMatch[1] : '#';

        if (title && price && !title.includes('필름') && !title.includes('케이스')) {
          results.push({ source: '다나와', title, price, image, link });
        }
      }
    }
  } catch (err) {
    console.error('다나와 수집 에러:', err.message);
  }
  return results;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  
  if (parsedUrl.pathname === '/') {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    fs.readFile(htmlPath, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('public/index.html 파일을 찾을 수 없습니다.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (parsedUrl.pathname === '/api/search') {
    const keyword = parsedUrl.searchParams.get('keyword');
    const minPrice = parseInt(parsedUrl.searchParams.get('minPrice'), 10);
    const maxPrice = parseInt(parsedUrl.searchParams.get('maxPrice'), 10);
    const volume = parsedUrl.searchParams.get('volume');
    const volumeOp = parsedUrl.searchParams.get('volumeOp');

    if (!keyword) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '검색어가 필요합니다.' }));
      return;
    }

    let results = await fetchDanawa(keyword);

    results = results.filter(item => {
      if (!isNaN(minPrice) && item.price < minPrice) return false;
      if (!isNaN(maxPrice) && item.price > maxPrice) return false;
      if (volume) {
        const userSpec = parseUnitValue(volume);
        const itemSpec = parseUnitValue(item.title);
        if (userSpec && itemSpec && userSpec.unit === itemSpec.unit) {
          if (volumeOp === 'gte' && itemSpec.val < userSpec.val) return false;
          if (volumeOp === 'lte' && itemSpec.val > userSpec.val) return false;
        } else if (userSpec && !itemSpec) {
          return false;
        }
      }
      return true;
    });

    results.sort((a, b) => a.price - b.price);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(results));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
