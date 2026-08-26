// server.js (Zero-Dependency Vanilla Node.js Application)
const http = require('http');
const { URL } = require('url');

const PORT = 3000;

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>온라인 실시간 가격 비교</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 min-h-screen">
  <div class="max-w-4xl mx-auto p-6">
    <header class="mb-8 text-center">
      <h1 class="text-3xl font-bold text-blue-600 mb-4">온라인 실시간 가격 비교</h1>
      <form onsubmit="searchProducts(event)" class="bg-white p-5 rounded-2xl shadow-md border border-gray-100 max-w-2xl mx-auto space-y-4">
        <div class="flex gap-2">
          <input type="text" id="searchInput" placeholder="검색어를 입력하세요 (예: 삼다수, 커피)" class="w-full p-3 pl-4 border rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-800" required>
          <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-7 py-3 rounded-xl font-bold transition shadow-sm whitespace-nowrap">검색</button>
        </div>
        <div class="pt-3 border-t border-gray-100">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold text-gray-500 uppercase">상세 조건 필터</span>
            <button type="button" onclick="resetFilters()" class="text-xs text-gray-400 hover:text-gray-600 underline">필터 초기화</button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1 text-left">최저 가격</label>
              <input type="number" id="minPrice" placeholder="0" min="0" class="w-full p-2.5 text-sm border rounded-lg bg-gray-50">
            </div>
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1 text-left">최고 가격</label>
              <input type="number" id="maxPrice" placeholder="제한 없음" min="0" class="w-full p-2.5 text-sm border rounded-lg bg-gray-50">
            </div>
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1 text-left">용량/단위</label>
              <div class="flex gap-1">
                <input type="text" id="volume" placeholder="예: 500ml" class="flex-1 p-2.5 text-sm border rounded-lg bg-gray-50">
                <select id="volumeOp" class="p-2.5 text-xs border rounded-lg bg-gray-50 font-semibold text-gray-600">
                  <option value="gte">이상</option>
                  <option value="lte">이하</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </form>
    </header>
    <div id="loading" class="hidden text-center py-10"><p class="text-lg text-gray-600 animate-pulse">실시간 가격 수집 중...</p></div>
    <div id="results" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>
  </div>
  <script>
    function resetFilters() {
      document.getElementById('minPrice').value = '';
      document.getElementById('maxPrice').value = '';
      document.getElementById('volume').value = '';
    }
    async function searchProducts(e) {
      if (e) e.preventDefault();
      const keyword = document.getElementById('searchInput').value.trim();
      if (!keyword) return alert('검색어를 입력하세요.');
      const params = new URLSearchParams({
        keyword,
        minPrice: document.getElementById('minPrice').value.trim(),
        maxPrice: document.getElementById('maxPrice').value.trim(),
        volume: document.getElementById('volume').value.trim(),
        volumeOp: document.getElementById('volumeOp').value
      });
      const resultsDiv = document.getElementById('results');
      const loadingDiv = document.getElementById('loading');
      resultsDiv.innerHTML = '';
      loadingDiv.classList.remove('hidden');
      try {
        const res = await fetch(\`/api/search?\${params}\`);
        const data = await res.json();
        loadingDiv.classList.add('hidden');
        if (!data || data.length === 0) {
          resultsDiv.innerHTML = '<p class="col-span-2 text-center text-gray-500">검색 결과가 없습니다.</p>';
          return;
        }
        resultsDiv.innerHTML = data.map(item => \`
          <div class="bg-white p-4 rounded-xl shadow flex gap-4 items-center">
            <img src="\${item.image}" alt="" class="w-24 h-24 object-contain rounded">
            <div class="flex-1">
              <span class="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded font-semibold mb-1">\${item.source}</span>
              <h2 class="font-bold text-gray-800 line-clamp-2">\${item.title}</h2>
              <p class="text-red-600 font-extrabold text-lg mt-1">\${item.price.toLocaleString()} 원</p>
              <a href="\${item.link}" target="_blank" class="inline-block mt-2 text-xs text-blue-500 hover:underline">상세보기 &rarr;</a>
            </div>
          </div>
        \`).join('');
      } catch (err) {
        loadingDiv.classList.add('hidden');
        alert('데이터 수집 중 오류가 발생했습니다.');
      }
    }
  </script>
</body>
</html>`;

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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML_TEMPLATE);
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
