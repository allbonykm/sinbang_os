const express = require('express');
const router = express.Router();

// ===========================================
// 카카오 로컬 API (주소 검색)
// ===========================================

const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;

// 주소 검색 (키워드로 검색)
router.get('/address/search', async (req, res) => {
    const { query } = req.query;

    if (!query) {
        return res.json({ success: false, message: '검색어를 입력하세요' });
    }

    if (!KAKAO_REST_API_KEY) {
        return res.json({ success: false, message: 'Kakao API 키가 설정되지 않았습니다' });
    }

    try {
        // 카카오 로컬 API - 키워드 검색
        const fetch = (await import('node-fetch')).default;
        const url = 'https://dapi.kakao.com/v2/local/search/keyword.json' +
            '?query=' + encodeURIComponent(query) +
            '&size=15';

        const response = await fetch(url, {
            headers: {
                'Authorization': 'KakaoAK ' + KAKAO_REST_API_KEY
            }
        });

        const data = await response.json();

        // 디버그 로그
        console.log('카카오 API 응답:', JSON.stringify(data, null, 2));

        if (data.documents && data.documents.length > 0) {
            // 결과 가공 - 지역명(동)과 상세주소 구분
            const results = data.documents.map(doc => ({
                place_name: doc.place_name,
                address_name: doc.address_name,        // 지번 주소
                road_address_name: doc.road_address_name || '', // 도로명 주소
                category_group_name: doc.category_group_name,
                x: doc.x,
                y: doc.y
            }));

            res.json({ success: true, data: results });
        } else if (data.errorType) {
            // 카카오 API 오류
            console.error('카카오 API 오류 응답:', data);
            res.json({ success: false, message: data.message || '카카오 API 오류' });
        } else {
            res.json({ success: false, message: '검색 결과가 없습니다' });
        }
    } catch (error) {
        console.error('카카오 API 오류:', error);
        res.json({ success: false, message: error.message });
    }
});

// 주소로 검색 (행정구역 검색)
router.get('/address/region', async (req, res) => {
    const { query } = req.query;

    if (!query) {
        return res.json({ success: false, message: '검색어를 입력하세요' });
    }

    try {
        const fetch = (await import('node-fetch')).default;
        const url = 'https://dapi.kakao.com/v2/local/search/address.json' +
            '?query=' + encodeURIComponent(query) +
            '&size=10';

        const response = await fetch(url, {
            headers: {
                'Authorization': 'KakaoAK ' + KAKAO_REST_API_KEY
            }
        });

        const data = await response.json();

        if (data.documents) {
            const results = data.documents.map(doc => {
                const addr = doc.address || doc.road_address || {};
                return {
                    address_name: doc.address_name,
                    region_3depth_name: addr.region_3depth_name || '', // 동/읍/면
                    address_type: doc.address_type // REGION, ROAD, REGION_ADDR, ROAD_ADDR
                };
            });

            res.json({ success: true, data: results });
        } else {
            res.json({ success: false, message: '검색 결과가 없습니다' });
        }
    } catch (error) {
        console.error('카카오 API 오류:', error);
        res.json({ success: false, message: error.message });
    }
});

const path = require('path');
const fs = require('fs');

// VWorld API Key 동적 로드 (설정 파일 우선)
const getVWorldKey = () => {
    try {
        const keyPath = path.join(__dirname, '../data/api-keys.json');
        if (fs.existsSync(keyPath)) {
            const keys = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
            if (keys.vworld) return keys.vworld;
        }
    } catch (e) {
        console.error('[address] VWorld key read error:', e);
    }
    return process.env.VWORLD_API_KEY;
};

// ===========================================
// vWorld API (행정구역 주소 검색)
// ===========================================

// 주소 검색 (vWorld - 행정구역 + 장소 통합)
router.get('/address/vworld', async (req, res) => {
    const { query } = req.query;

    if (!query) {
        return res.json({ success: false, message: '검색어를 입력하세요' });
    }

    const vKey = getVWorldKey();
    if (!vKey) {
        return res.json({ success: false, message: 'vWorld API 키가 설정되지 않았습니다' });
    }

    try {
        const fetch = (await import('node-fetch')).default;
        const results = [];

        // 1. 행정구역 검색 (동/읍/면)
        const districtUrl = 'https://api.vworld.kr/req/search' +
            '?service=search' +
            '&request=search' +
            '&version=2.0' +
            '&crs=EPSG:4326' +
            '&size=5' +
            '&page=1' +
            '&type=district' +
            '&category=L4' +
            '&format=json' +
            '&errorformat=json' +
            '&key=' + getVWorldKey() +
            '&query=' + encodeURIComponent(query);

        console.log('vWorld 행정구역 검색:', districtUrl);

        const districtRes = await fetch(districtUrl);
        const districtData = await districtRes.json();

        console.log('vWorld 행정구역 응답:', JSON.stringify(districtData, null, 2));

        if (districtData.response?.status === 'OK' && districtData.response?.result?.items) {
            districtData.response.result.items.forEach(item => {
                const addressBase = item.address?.road || item.address?.parcel || item.title;
                results.push({
                    type: 'region',
                    title: `[지역] ${item.title}`,
                    address: addressBase,
                    point: item.point
                });
            });
        }

        // 2. 장소 검색 (건물, 상호 등)
        const placeUrl = 'https://api.vworld.kr/req/search' +
            '?service=search' +
            '&request=search' +
            '&version=2.0' +
            '&crs=EPSG:4326' +
            '&size=10' +
            '&page=1' +
            '&type=place' +
            '&format=json' +
            '&errorformat=json' +
            '&key=' + vKey +
            '&query=' + encodeURIComponent(query);

        const placeRes = await fetch(placeUrl);
        const placeData = await placeRes.json();

        console.log('vWorld 장소 응답 상태:', placeData.response?.status);

        if (placeData.response?.status === 'OK' && placeData.response?.result?.items) {
            placeData.response.result.items.forEach(item => {
                const mainAddr = item.address?.road || item.address?.parcel || '';
                const subAddr = (item.address?.road && item.address?.parcel) ? ` (${item.address.parcel})` : '';
                results.push({
                    type: 'place',
                    title: item.title,
                    address: mainAddr + subAddr,
                    category: item.category,
                    point: item.point
                });
            });
        }

        // 3. 도로명 주소 검색
        const addressUrl = 'https://api.vworld.kr/req/search' +
            '?service=search' +
            '&request=search' +
            '&version=2.0' +
            '&crs=EPSG:4326' +
            '&size=10' +
            '&page=1' +
            '&type=address' +
            '&category=road' +
            '&format=json' +
            '&errorformat=json' +
            '&key=' + vKey +
            '&query=' + encodeURIComponent(query);

        const addressRes = await fetch(addressUrl);
        const addressData = await addressRes.json();

        console.log('vWorld 도로명 응답 전체:', JSON.stringify(addressData, null, 2));

        if (addressData.response?.status === 'OK' && addressData.response?.result?.items) {
            addressData.response.result.items.forEach(item => {
                const roadAddress = item.address?.road || '';
                if (!roadAddress) return;

                // 중복 방지
                const exists = results.some(r => r.address === roadAddress);
                if (!exists) {
                    results.push({
                        type: 'road',
                        title: roadAddress,
                        address: roadAddress,
                        point: item.point
                    });
                }
            });
        }

        console.log('최종 결과 개수:', results.length);
        console.log('최종 결과:', JSON.stringify(results, null, 2));

        if (results.length > 0) {
            res.json({ success: true, data: results });
        } else {
            res.json({ success: false, message: '검색 결과가 없습니다' });
        }
    } catch (error) {
        console.error('vWorld API 오류:', error);
        res.json({ success: false, message: error.message });
    }
});

module.exports = router;
