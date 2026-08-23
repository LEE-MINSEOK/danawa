const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static('public'));

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

// [설정] 네이버 오픈 API 발급 정보 입력 (개발자센터에서 발급받은 키가 있다면 입력, 없으면 기본 파싱 시도)
const NAVER_CLIENT_ID = ''; 
const NAVER_CLIENT_SECRET = '';

// 단위 변환 및 숫자 추출 헬퍼 함수
function parseUnitValue(text) {
  if (!text) return null;
  // 숫자와 단위(ml, l, g, kg, 개, 입, p, 매) 추출 정규식
  const match = text.match(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg|개|입|매|p)/i);
  if (!match) return null;

  let val = parseFloat(match[1]);
  let unit = match[2].toLowerCase();

  // 표준화: L -> ml (1000), kg -> g (1000)
  if (unit === 'l') { val *= 1000; unit = 'ml'; }
  if (unit === 'kg') { val *= 1000; unit = 'g'; }
  
  return { val, unit };
}

app.get('/api/search', async (req, res) => {
  const keyword = req.query.keyword;
  const minPrice = req.query.minPrice ? parseInt(req.query.minPrice, 10) : null;
  const maxPrice = req.query.maxPrice ? parseInt(req.query.maxPrice, 10) : null;
  const volume = req.query.volume ? req.query.volume.trim().toLowerCase() : null;
  const volumeOp = req.query.volumeOp; // 이상('gte') / 이하('lte') 조건

  if (!keyword) return res.status(400).json({ error: '검색어가 필요합니다.' });

  let results = [];

  // 1. 다나와 크롤링 (쇼핑몰별 최저가 파싱)
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

  // 2. 네이버 쇼핑 (API 방식 또는 모바일 파싱)
  try {
    if (NAVER_CLIENT_ID && NAVER_CLIENT_SECRET) {
      const apiRes = await axios.get(`https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=10`, {
        headers: {
          'X-Naver-Client-Id': NAVER_CLIENT_ID,
          'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
        }
      });
      apiRes.data.items.forEach(item => {
        const cleanTitle = item.title.replace(/<[^>]*>?/g, '');
        results.push({
          source: '네이버쇼핑',
          title: cleanTitle,
          price: parseInt(item.lprice, 10),
          image: item.image,
          link: item.link
        });
      });
    } else {
      // 모바일 네이버쇼핑 경량 요청 파싱
      const mNaverUrl = `https://msearch.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}`;
      const mRes = await axios.get(mNaverUrl, { headers });
      const $m = cheerio.load(mRes.data);
      $m('[class*="product_item"]').each((i, el) => {
        const title = $m(el).find('[class*="product_title"]').text().trim();
        const priceText = $m(el).find('[class*="price_num"]').text().replace(/[^0-9]/g, '');
        const price = parseInt(priceText, 10);
        const img = $m(el).find('img').attr('src');
        const link = $m(el).find('a').attr('href');
        if (title && price) {
          results.push({ source: '네이버쇼핑', title, price, image: img || '', link: link || '#' });
        }
      });
    }
  } catch (err) {
    console.error('네이버쇼핑 수집 에러:', err.message);
  }

  // 3. 토스쇼핑 (토스 입점 상점 파싱)
  try {
    const tossUrl = `https://shopping.toss.im/api/v1/search?keyword=${encodeURIComponent(keyword)}`;
    const tossRes = await axios.get(tossUrl, { 
      headers: { ...headers, 'Referer': 'https://shopping.toss.im' },
      timeout: 3000 
    });
    if (tossRes.data && tossRes.data.products) {
      tossRes.data.products.forEach(item => {
        results.push({
          source: '토스쇼핑',
          title: item.name || item.title,
          price: item.price,
          image: item.imageUrl || item.thumbnail,
          link: `https://shopping.toss.im/product/${item.id}`
        });
      });
    }
  } catch (err) {
    console.error('토스쇼핑 연결 제한 (차단 방지 로직 적용)');
  }

  // 상세 조건 필터링 (최저 가격, 최고 가격, 용량/단위)
  results = results.filter(item => {
    // 1. 가격 필터링
    if (minPrice !== null && !isNaN(minPrice) && item.price < minPrice) {
      return false;
    }
    if (maxPrice !== null && !isNaN(maxPrice) && item.price > maxPrice) {
      return false;
    }

    // 2. 정교한 용량/단위 비교 필터링
    if (volume) {
      const userSpec = parseUnitValue(volume); // 사용자가 입력한 값
      const itemSpec = parseUnitValue(item.title); // 상품 제목에서 추출한 값

      if (userSpec && itemSpec) {
        // 단위가 같은 경우에만 비교 수행
        if (userSpec.unit === itemSpec.unit) {
          if (volumeOp === 'gte' && itemSpec.val < userSpec.val) return false; // 이상 조건 미달
          if (volumeOp === 'lte' && itemSpec.val > userSpec.val) return false; // 이하 조건 초과
        }
      } else if (userSpec && !itemSpec) {
        // 사용자는 용량을 입력했는데 상품 제목에 용량이 안 보이면 검색 결과에서 제외
        return false;
      }
    }

    return true;
  });

  // 가격순 정렬
  results.sort((a, b) => a.price - b.price);

  res.json(results);
});

app.listen(PORT, () => console.log(`Server running on http://localhost:3000`));