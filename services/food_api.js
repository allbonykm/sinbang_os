const pool = require('../config/db');

/**
 * FoodAPIService - 로컬 식품 DB 검색 모듈 (MariaDB)
 * 27만 건의 식품 데이터를 MariaDB에서 SQL 검색합니다.
 * 외부 API 의존성 없이 완전 자립형으로 동작합니다.
 */
class FoodAPIService {
    constructor() {
        // MariaDB 연결은 pool에서 자동 관리
    }

    /**
     * 식품명을 기반으로 단일 결과를 검색합니다.
     * (기존 searchFood 호환 유지)
     */
    async searchFood(keyword) {
        if (!keyword) return null;
        const results = await this.searchFoodMultiple(keyword, 1);
        return results.length > 0 ? results[0] : null;
    }

    /**
     * 식품명을 기반으로 여러 결과를 검색합니다 (자동완성용).
     * @param {string} keyword - 검색 키워드
     * @param {number} maxResults - 최대 반환 개수 (기본 10)
     * @param {string} sourceFilter - 소스 필터 ('all', 'natural', 'processed', 'cooked', 'supplement')
     * @returns {Array} - 검색 결과 배열
     */
    async searchFoodMultiple(keyword, maxResults = 10, sourceFilter = 'all') {
        if (!keyword || keyword.length < 1) return [];

        try {
            let sql = '';
            let params = [];
            const kw = `%${keyword}%`;

            if (sourceFilter !== 'all') {
                sql = `
                    SELECT name, category, source, maker, serving_size,
                           calories, carbs, protein, fat, sugar,
                           sodium, cholesterol, saturated_fat, trans_fat
                    FROM food_items
                    WHERE (name LIKE ? OR maker LIKE ?) AND source = ?
                    ORDER BY 
                        CASE WHEN name = ? THEN 0
                             WHEN name LIKE ? THEN 1
                             ELSE 2 END,
                        FIELD(source, 'natural', 'cooked', 'supplement', 'processed'),
                        name
                    LIMIT ?
                `;
                params = [kw, kw, sourceFilter, keyword, `${keyword}%`, maxResults];
            } else {
                sql = `
                    SELECT name, category, source, maker, serving_size,
                           calories, carbs, protein, fat, sugar,
                           sodium, cholesterol, saturated_fat, trans_fat
                    FROM food_items
                    WHERE name LIKE ? OR maker LIKE ?
                    ORDER BY 
                        CASE WHEN name = ? THEN 0
                             WHEN name LIKE ? THEN 1
                             ELSE 2 END,
                        FIELD(source, 'natural', 'cooked', 'supplement', 'processed'),
                        name
                    LIMIT ?
                `;
                params = [kw, kw, keyword, `${keyword}%`, maxResults];
            }

            const [rows] = await pool.query(sql, params);

            // 프론트엔드 호환 형식으로 변환
            return rows.map(row => ({
                name: row.name,
                category: row.category || '',
                source: row.source,
                maker: row.maker || '',
                servingSize: row.serving_size || '100g',
                nutrients: {
                    calories: parseFloat(row.calories) || 0,
                    carbs: parseFloat(row.carbs) || 0,
                    protein: parseFloat(row.protein) || 0,
                    fat: parseFloat(row.fat) || 0,
                    sugar: parseFloat(row.sugar) || 0,
                    sodium: parseFloat(row.sodium) || 0,
                    cholesterol: parseFloat(row.cholesterol) || 0,
                    saturatedFat: parseFloat(row.saturated_fat) || 0,
                    transFat: parseFloat(row.trans_fat) || 0,
                }
            }));
        } catch (err) {
            console.error('[FoodDB] 검색 오류:', err.message);
            return [];
        }
    }
}

// 싱글톤 내보냄
const service = new FoodAPIService();

// 명령어 라인 테스트용
if (require.main === module) {
    const testKeyword = process.argv[2] || '사과';
    console.log(`\n🔍 Searching: "${testKeyword}"...\n`);
    service.searchFoodMultiple(testKeyword, 10).then(results => {
        results.forEach((r, i) => {
            const maker = r.maker ? ` (${r.maker})` : '';
            console.log(`${i + 1}. ${r.name}${maker} [${r.source}] - ${r.nutrients.calories}kcal`);
        });
        process.exit(0);
    });
}

module.exports = service;
