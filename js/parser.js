/**
 * 売上管理表 Excel パースモジュール
 * セキュリティ方針:
 * - 危険なAPIは一切使用せず純粋関数として実装
 * - 厳格な型チェックと境界値バリデーション
 * - 期間メタデータ（年月・タイムスタンプ）の安全な抽出
 */
(function(global) {
  'use strict';

  /**
   * 全角英数を半角に正規化
   * @param {string} str
   * @returns {string}
   */
  function normalizeText(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[０-９]/g, function(s) {
      return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    }).trim();
  }

  /**
   * シート内の曜日ヘッダー行（例: 日, 月, 火, 水, 木, 金, 土）を検出
   * @param {Array<Array<any>>} rows
   * @returns {Object<number, number>|null} colIndex -> dayOfWeek (0:日, 1:月, ..., 6:土)
   */
  function detectWeekdayHeaders(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const DOW_LOOKUP = {
      '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6,
      'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6
    };

    const maxCheck = Math.min(rows.length, 12);
    for (let r = 0; r < maxCheck; r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;

      const colMap = {};
      let matchCount = 0;

      for (let c = 0; c < Math.min(row.length, 14); c++) {
        const val = row[c];
        if (val === null || val === undefined) continue;
        const txt = normalizeText(String(val)).toLowerCase();
        if (!txt) continue;

        for (const key in DOW_LOOKUP) {
          if (txt === key || txt.indexOf(key) !== -1) {
            colMap[c] = DOW_LOOKUP[key];
            matchCount++;
            break;
          }
        }
      }

      // 4列以上で曜日が検出されれば、これがカレンダーの曜日ヘッダー行
      if (matchCount >= 4) {
        return colMap;
      }
    }
    return null;
  }

  /**
   * シート内テキストおよびファイル名から期間情報（年・月・タイムスタンプ）を安全かつ柔軟に抽出
   * 西暦(2026, 2025等), 和暦(令和8年, R8等), 区切り文字(., -, /, 年月), Excelシリアル値に対応
   * @param {Array<Array<any>>} rows - シートの行データ
   * @param {string} [fileName] - アップロードされたファイル名
   * @returns {{ year: number|null, month: number|null, dateKey: number, label: string }}
   */
  function extractPeriodInfo(rows, fileName) {
    let year = null;
    let month = null;
    let day = 1;
    let dateKey = 0;
    let label = '';

    // 1. ファイル名からの多角的な日付・年月抽出
    if (fileName && typeof fileName === 'string') {
      const fn = normalizeText(fileName);

      // (A) 西暦 年月日: 2026.09.01, 2026-9-1, 2026/09/01, 2026年9月1日, 2026_09_01, 20260901
      const matchYmd = fn.match(/(20\d{2})[年\/\-._\s]?([01]?\d)[月\/\-._\s]?([0-3]?\d)日?/);
      if (matchYmd) {
        const y = parseInt(matchYmd[1], 10);
        const m = parseInt(matchYmd[2], 10);
        const d = matchYmd[3] ? parseInt(matchYmd[3], 10) : 1;
        if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) {
          year = y;
          month = m;
          day = (d >= 1 && d <= 31) ? d : 1;
          dateKey = year * 10000 + month * 100 + day;
          label = year + '年' + month + '月' + (d >= 1 && d <= 31 ? d + '日' : '');
        }
      }

      // (B) 西暦 年月のみ: 2026.09, 2026-9, 2026年9月, 202609
      if (!year) {
        const matchYm = fn.match(/(20\d{2})[年\/\-._\s]?([01]?\d)月?/);
        if (matchYm) {
          const y = parseInt(matchYm[1], 10);
          const m = parseInt(matchYm[2], 10);
          if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) {
            year = y;
            month = m;
            dateKey = year * 10000 + month * 100 + 1;
            label = year + '年' + month + '月';
          }
        }
      }

      // (C) 和暦: 令和8年9月, 令8.9, R8.9, R0809 (令和1年=2019年)
      if (!year) {
        const matchR = fn.match(/(?:令和|令|R)(\d{1,2})[年\/\-._\s]?([01]?\d)[月\/\-._\s]?([0-3]?\d)?/i);
        if (matchR) {
          const ry = parseInt(matchR[1], 10);
          const y = 2018 + ry;
          const m = parseInt(matchR[2], 10);
          const d = matchR[3] ? parseInt(matchR[3], 10) : 1;
          if (y >= 2019 && y <= 2100 && m >= 1 && m <= 12) {
            year = y;
            month = m;
            day = (d >= 1 && d <= 31) ? d : 1;
            dateKey = year * 10000 + month * 100 + day;
            label = year + '年' + month + '月' + (d >= 1 && d <= 31 ? d + '日' : '');
          }
        }
      }
    }

    // 2. シート全体（全行）からの期間文字列抽出（ファイル名より詳細な場合、またはファイル名から取れなかった場合）
    if (Array.isArray(rows)) {
      const scanRows = Math.min(rows.length, 30);
      for (let r = 0; r < scanRows; r++) {
        const row = rows[r];
        if (!Array.isArray(row)) continue;

        for (let c = 0; c < row.length; c++) {
          const val = row[c];
          if (val === null || val === undefined) continue;

          // Excelシリアル値判定 (数値 40000〜55000 は 2009年〜2050年)
          if (typeof val === 'number' && val >= 40000 && val <= 55000) {
            const utcDays = Math.floor(val - 25569);
            const dateObj = new Date(utcDays * 86400 * 1000);
            const y = dateObj.getUTCFullYear();
            const m = dateObj.getUTCMonth() + 1;
            const d = dateObj.getUTCDate();
            if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) {
              year = y;
              month = m;
              day = d;
              dateKey = y * 10000 + m * 100 + d;
              label = y + '年' + m + '月' + d + '日';
              break;
            }
          }

          const text = normalizeText(String(val));
          if (!text) continue;

          // 西暦 年月日
          const matchCellYmd = text.match(/(20\d{2})[年\/\-._\s]([01]?\d)[月\/\-._\s]([0-3]?\d)日?/);
          if (matchCellYmd) {
            const y = parseInt(matchCellYmd[1], 10);
            const m = parseInt(matchCellYmd[2], 10);
            const d = parseInt(matchCellYmd[3], 10);
            if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) {
              year = y;
              month = m;
              day = (d >= 1 && d <= 31 ? d : 1);
              dateKey = y * 10000 + m * 100 + day;
              label = y + '年' + m + '月' + (d >= 1 && d <= 31 ? d + '日' : '');
              break;
            }
          }

          // 西暦 年月
          const matchCellYm = text.match(/(20\d{2})[年\/\-._\s]([01]?\d)月?/);
          if (matchCellYm) {
            const y = parseInt(matchCellYm[1], 10);
            const m = parseInt(matchCellYm[2], 10);
            if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) {
              year = y;
              month = m;
              dateKey = y * 10000 + m * 100 + 1;
              label = y + '年' + m + '月';
              break;
            }
          }

          // 和暦
          const matchCellR = text.match(/(?:令和|令|R)(\d{1,2})[年\/\-._\s]([01]?\d)月?/i);
          if (matchCellR) {
            const ry = parseInt(matchCellR[1], 10);
            const y = 2018 + ry;
            const m = parseInt(matchCellR[2], 10);
            if (y >= 2019 && y <= 2100 && m >= 1 && m <= 12) {
              year = y;
              month = m;
              dateKey = y * 10000 + m * 100 + 1;
              label = y + '年' + m + '月';
              break;
            }
          }
        }
        if (year !== null) break;
      }
    }

    if (!label) {
      label = year ? year + '年' + (month ? month + '月' : '') : '期間未特定';
    }

    return {
      year: year,
      month: month,
      dateKey: dateKey,
      label: label
    };
  }

  /**
   * ExcelファイルのArrayBufferを受け取り、日別売上データ配列（期間情報付き）を返す
   * @param {ArrayBuffer} buffer - Excelバイナリバッファ
   * @param {string} [fileName] - ファイル名（期間抽出用）
   * @returns {Array<{Day: number, 客単価: number, 客数: number, 売上: number, dayOfWeek: number, weekday: string}> & { periodInfo: object, fileName: string }}
   */
  /**
   * システム予約シート名（店舗データではないシート）
   */
  const SYSTEM_SHEET_NAMES = [
    '今期部門売上', '今期売上実績', 'コードなど',
    '前期ベスト10に対して今期順位', '今期ベスト10に対して前期順位',
    '前期部門売上', '前期売上実績　データ'
  ];

  /**
   * システム予約シートまたはデフォルト汎用シート（店舗名ではないシート）を判定
   * 例: Sheet1, sheet1, シート1, Page1, Table1, ワークシート 等
   * @param {string} name
   * @returns {boolean}
   */
  function isGenericOrSystemSheet(name) {
    if (!name || typeof name !== 'string') return true;
    const clean = name.trim();
    if (SYSTEM_SHEET_NAMES.indexOf(clean) !== -1) return true;
    // Sheet1, Sheet 1, シート1, Page1, Table1, ワークシート 等のデフォルトシート名を排除
    if (/^(?:sheet\s*\d*|シート\s*\d*|page\s*\d*|table\s*\d*|ワークシート\d*)$/i.test(clean)) {
      return true;
    }
    return false;
  }

  /**
   * 汎用的な店舗名正規化 (不可視文字・空白・記号・カナ・主要漢字揺れ対応)
   * 特定の店舗名をハードコードせず、任意の店舗名に動的に適用可能
   * @param {string} str
   * @returns {string}
   */
  function normalizeStoreCore(str) {
    if (!str || typeof str !== 'string') return '';
    // 不可視制御文字・空白・記号を除去、半角小文字化
    let s = normalizeText(str)
      .toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF\x00-\x1F\s　_\-\(\)（）\[\]【】]/g, '');

    // カタカナをひらがなに統一（動的なかな・カナ揺れ吸収）
    s = s.replace(/[\u30a1-\u30f6]/g, function(match) {
      const chr = match.charCodeAt(0) - 0x60;
      return String.fromCharCode(chr);
    });

    // 代表的な地名・表記の漢字/かな相互変換（汎用的な揺れ吸収）
    s = s.replace(/なんば/g, '難波')
         .replace(/三ノ宮/g, '三宮')
         .replace(/梅田/g, '大阪');

    return s;
  }

  /**
   * 末尾の「店」「店舗」「支店」を除去した語幹（コア名）を取得
   * @param {string} str
   * @returns {string}
   */
  function getStoreStem(str) {
    const core = normalizeStoreCore(str);
    return core.replace(/(?:店舗|支店|店)$/, '');
  }

  /**
   * ユーザー登録店舗リストまたは動的候補群と照合して一致する店舗名を動的解決
   * ハードコードに依存せず、動的に渡された候補群から柔軟に判定
   * @param {string} rawName - 照合対象（シート名、ファイル名など）
   * @param {Array<string>} [candidates] - 比較対象店舗リスト（登録店舗プロファイル等）
   * @returns {string|null}
   */
  function matchStoreName(rawName, candidates) {
    if (!rawName || typeof rawName !== 'string') return null;
    const rawClean = rawName.trim();
    if (!rawClean) return null;

    // 「全店」系の汎用判定（全店、全体、合計、all store 等）
    const isAllStore = /^(?:全店|全体|合計|全店舗|all|allstore|全社|全)$/i.test(rawClean.replace(/[\s　_\-]/g, ''));
    if (isAllStore) {
      if (Array.isArray(candidates)) {
        for (let i = 0; i < candidates.length; i++) {
          if (/^(?:全店|全体|合計|全店舗|all)$/i.test(String(candidates[i]).trim())) {
            return candidates[i];
          }
        }
      }
      return '全店';
    }

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return rawClean;
    }

    const rawCore = normalizeStoreCore(rawClean);
    const rawStem = getStoreStem(rawClean);

    // 1. 完全一致 (大文字小文字無視)
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (!cand) continue;
      if (rawClean.toLowerCase() === String(cand).toLowerCase()) {
        return cand;
      }
    }

    // 2. 空白・記号正規化後の一致
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (!cand) continue;
      if (rawCore === normalizeStoreCore(cand)) {
        return cand;
      }
    }

    // 3. 「店」の有無を除いた語幹（Stem）での一致（例: 「六甲」⇔「六甲店」）
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (!cand) continue;
      const candStem = getStoreStem(cand);
      if (rawStem && candStem && rawStem === candStem) {
        return cand;
      }
    }

    // 4. 部分一致（包含関係: 「六甲」が「2026年_六甲店」に含まれる等）
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      if (!cand) continue;
      const candStem = getStoreStem(cand);
      if (candStem && candStem.length >= 2 && rawCore.indexOf(candStem) !== -1) {
        return cand;
      }
      if (rawStem && rawStem.length >= 2 && normalizeStoreCore(cand).indexOf(rawStem) !== -1) {
        return cand;
      }
    }

    return null;
  }

  /**
   * 後方互換ラッパー: シート名やファイル名から店舗名を動的解決
   * @param {string} rawName
   * @param {Array<string>} [candidates]
   * @returns {string|null}
   */
  function resolveStandardStoreName(rawName, candidates) {
    return matchStoreName(rawName, candidates) || (typeof rawName === 'string' ? rawName.trim() : null);
  }

  const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

  /**
   * 日付セル値から日番号（1〜31の整数）を安全かつ高精度に抽出
   * "1", "01", 1, "1日", "9/1", "09/01", "9月1日", "2026/09/01", "9/1(火)", Excelシリアル値, Dateオブジェクトに対応
   * @param {any} val
   * @returns {number|null} 1〜31の整数、またはnull
   */
  function extractDayNumber(val) {
    if (val === null || val === undefined) return null;

    // 1. Dateオブジェクト
    if (val instanceof Date) {
      const d = val.getDate();
      return (Number.isFinite(d) && d >= 1 && d <= 31) ? d : null;
    }

    // 2. 数値
    if (typeof val === 'number') {
      if (!Number.isFinite(val)) return null;
      // 1〜31の整数そのもの
      if (val >= 1 && val <= 31 && Math.floor(val) === val) {
        return val;
      }
      // Excelシリアル値 (40000〜55000: 2009年〜2050年)
      if (val >= 40000 && val <= 55000) {
        const utcDays = Math.floor(val - 25569);
        const dateObj = new Date(utcDays * 86400 * 1000);
        const d = dateObj.getUTCDate();
        return (Number.isFinite(d) && d >= 1 && d <= 31) ? d : null;
      }
      return null;
    }

    const s = normalizeText(String(val)).trim();
    if (!s || s === 'nan' || s === '_' || s === '-') return null;

    // 期間範囲文字列（例: "2026年11月01日~2026年11月30日", "11/1-11/30"）は期間情報であり日番号ではないため除外
    if (/[~〜]|(?:\d+.*[-–—]\s*\d+)|(?:to)/i.test(s)) {
      return null;
    }

    // 「表示期間」「検索店舗」「売上」「合計」等の見出し文字列を除外
    if (/(?:期間|店舗|検索|売上|客数|単価|合計|前年|予算)/.test(s)) {
      return null;
    }

    // (A) "01日", "02月", "03火", "04水", "05木", "06金", "07土", "08日"
    const matchDayDow = s.match(/^0?([1-9]|[12]\d|3[01])\s*([日月火水木金土])$/);
    if (matchDayDow) {
      return parseInt(matchDayDow[1], 10);
    }

    // (B) 年月日 (例: 2026/09/01, 2026-9-1, 2026.9.1, 2026年9月1日, 令和8年9月1日)
    const matchYmd = s.match(/^(?:20\d{2}|令和\d+|令\d+|R\d+)[\/\-._年]\s*\d{1,2}[\/\-._月]\s*(\d{1,2})日?$/i);
    if (matchYmd) {
      const d = parseInt(matchYmd[1], 10);
      if (d >= 1 && d <= 31) return d;
    }

    // (C) 月/日 (例: 9/1, 09/01, 9-1, 9.1, 9月1日, 9/1(火))
    const matchMd = s.match(/^(?:^|[^\d\w])?(\d{1,2})[\/\-._月]\s*(\d{1,2})日?(?:\([日月火水木金土]\))?$/);
    if (matchMd) {
      const m = parseInt(matchMd[1], 10);
      const d = parseInt(matchMd[2], 10);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return d;
    }

    // (D) 日付 + 任意テキスト (例: 1日, 01日, 1日(火), 1 (Tue))
    const matchDay = s.match(/^0?([1-9]|[12]\d|3[01])\s*日/);
    if (matchDay) {
      const d = parseInt(matchDay[1], 10);
      if (d >= 1 && d <= 31) return d;
    }

    // (E) 純粋な数字 (例: "1", " 01 ", "31")
    const matchPureNum = s.match(/^0?([1-9]|[12]\d|3[01])$/);
    if (matchPureNum) {
      return parseInt(matchPureNum[1], 10);
    }

    return null;
  }

  /**
   * 日付セル文字列（例: "01日", "02月", "03火" 等）から曜日インデックス（0:日〜6:土）を安全に抽出
   * @param {any} val
   * @returns {number|null} 0〜6の整数、またはnull
   */
  function extractWeekdayFromCell(val) {
    if (val === null || val === undefined) return null;
    const s = normalizeText(String(val)).trim();
    if (!s || s === 'nan' || s === '_') return null;

    // 末尾または日付直後の曜日漢字（日, 月, 火, 水, 木, 金, 土）を検出
    const match = s.match(/([日月火水木金土])(?:曜日)?$/) || s.match(/\d{1,2}\s*([日月火水木金土])/);
    if (match) {
      const DOW_LOOKUP = { '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6 };
      if (DOW_LOOKUP[match[1]] !== undefined) {
        return DOW_LOOKUP[match[1]];
      }
    }
    return null;
  }


  /**
   * 単一ワークシートから日別売上データを解析
   * @param {object} worksheet - SheetJS worksheet
   * @param {string} fileName - ファイル名
   * @param {string} storeName - シート名（店舗名）
   * @param {object} [sharedPeriodInfo] - 共有の期間情報
   * @returns {Array|null}
   */
  function parseSheetRows(worksheet, fileName, storeName, sharedPeriodInfo) {
    if (!worksheet) return null;

    const rows = global.XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      blankrows: true
    });

    if (!Array.isArray(rows) || rows.length < 5) return null;

    // カレンダーの開始行を動的に探索
    // 月初（1日）が週末で第1週に1セルしか存在しない月（例: 2026年11月、1日のみ）や
    // 月曜始まり・日曜始まりカレンダーに完全対応
    let baseStartRow = 4;
    for (let r = 0; r < Math.min(rows.length - 3, 15); r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;

      let hasDayOne = false;
      let dayHits = 0;

      for (let c = 0; c < Math.min(row.length, 14); c++) {
        const val = row[c];
        if (val === null || val === undefined) continue;
        const d = extractDayNumber(val);
        if (d !== null) {
          if (d === 1) {
            hasDayOne = true;
          }
          if (d >= 1 && d <= 7) {
            dayHits++;
          }
        }
      }

      // 後続行（r+1〜r+3）に数値データ（客単価・客数・売上）が存在することを確認（ヘッダー行との誤認防止）
      let hasNumbersBelow = false;
      if (r + 3 < rows.length) {
        for (let subR = r + 1; subR <= r + 3; subR++) {
          const subRow = rows[subR];
          if (Array.isArray(subRow)) {
            for (let sc = 0; sc < Math.min(subRow.length, 14); sc++) {
              const numVal = Number(subRow[sc]);
              if (Number.isFinite(numVal) && numVal > 0) {
                hasNumbersBelow = true;
                break;
              }
            }
          }
          if (hasNumbersBelow) break;
        }
      }

      // (A) 1日（Day 1）を含み、かつ後続行に数値が存在すれば、これがカレンダー第1週の開始行（最優先）
      if (hasDayOne && hasNumbersBelow) {
        baseStartRow = r;
        break;
      }

      // (B) 1〜7日のいずれかを2日以上含み、かつ後続行に数値が存在する場合
      if (dayHits >= 2 && hasNumbersBelow) {
        baseStartRow = r;
        break;
      }
    }

    let parsedData = [];

    // 最大6ブロック分（週ごと、4行単位）を取得
    for (let i = 0; i < 6; i++) {
      const startRow = baseStartRow + i * 4;
      if (startRow + 3 >= rows.length) {
        break;
      }

      const dateRow = rows[startRow] || [];
      const customerPriceRow = rows[startRow + 1] || [];
      const customerCountRow = rows[startRow + 2] || [];
      const salesRow = rows[startRow + 3] || [];

      for (let col = 0; col < 7; col++) {
        const dateVal = dateRow[col];
        if (dateVal === null || dateVal === undefined) {
          continue;
        }

        // 堅牢な日番号抽出（"1", "1日", "9/1", "9月1日", Excelシリアル値等に完全対応）
        const day = extractDayNumber(dateVal);
        if (day === null) {
          continue;
        }

        const rawPrice = Number(customerPriceRow[col]);
        const custPrice = Number.isFinite(rawPrice) && rawPrice >= 0 ? Math.round(rawPrice) : 0;

        const rawCount = Number(customerCountRow[col]);
        const custCount = Number.isFinite(rawCount) && rawCount >= 0 ? Math.round(rawCount) : 0;

        const rawSales = Number(salesRow[col]);
        const sales = Number.isFinite(rawSales) && rawSales >= 0 ? Math.round(rawSales) : 0;

        parsedData.push({
          Day: day,
          客単価: custPrice,
          客数: custCount,
          売上: sales,
          colIndex: col,
          rawDateVal: dateVal
        });
      }
    }

    if (parsedData.length === 0) {
      return null;
    }

    // 日番号（Day）による一意化（重複行の排除：実績売上・客数を持つ方を最優先）
    const dayMap = {};
    parsedData.forEach(function(item) {
      const existing = dayMap[item.Day];
      if (!existing) {
        dayMap[item.Day] = item;
      } else {
        const existingSales = existing['売上'] || 0;
        const newSales = item['売上'] || 0;
        if (newSales > existingSales) {
          dayMap[item.Day] = item;
        }
      }
    });
    parsedData = Object.values(dayMap);

    // 日付順に昇順ソート
    parsedData.sort(function(a, b) {
      return a.Day - b.Day;
    });

    const safeFileName = typeof fileName === 'string' ? fileName : '';
    const periodInfo = sharedPeriodInfo || extractPeriodInfo(rows, safeFileName);
    parsedData.periodInfo = periodInfo;
    parsedData.fileName = safeFileName;
    parsedData.storeName = storeName || '全店';

    // シート内曜日ヘッダー列の検出 (直接的な曜日マップ)
    const headerDowMap = detectWeekdayHeaders(rows);
    const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

    parsedData.forEach(function(item) {
      let dow = null;

      // 1. セル内の表記から曜日を直接抽出 (例: "01日", "02月", "03火")
      if (item.rawDateVal) {
        dow = extractWeekdayFromCell(item.rawDateVal);
      }

      // 2. 期間情報（年月）からの曜日算出
      if (dow === null && periodInfo.year && periodInfo.month) {
        const dt = new Date(periodInfo.year, periodInfo.month - 1, item.Day);
        if (!isNaN(dt.getTime())) {
          dow = dt.getDay();
        }
      }

      if (dow === null && headerDowMap && typeof item.colIndex === 'number' && headerDowMap[item.colIndex] !== undefined) {
        dow = headerDowMap[item.colIndex];
      }

      if (dow === null && typeof item.colIndex === 'number') {
        dow = item.colIndex % 7; // デフォルト日曜始まりカレンダー
      }

      if (dow !== null && dow >= 0 && dow <= 6) {
        item.dayOfWeek = dow;
        item.weekday = WEEKDAY_NAMES[dow];
      } else {
        item.dayOfWeek = null;
        item.weekday = '';
      }
    });

    return parsedData;
  }

  /**
   * ワークブックの安全な読み込み (ExcelおよびCSV対応、Shift-JIS/UTF-8自動判別)
   * @param {ArrayBuffer} buffer
   * @param {string} [fileName]
   * @returns {object} XLSX workbook
   */
  function readWorkbookSafely(buffer, fileName) {
    const isCsv = typeof fileName === 'string' && fileName.toLowerCase().endsWith('.csv');
    if (isCsv) {
      try {
        // 日本語CSV (Shift-JIS / CP932) の優先読み込み
        return global.XLSX.read(buffer, { type: 'array', codepage: 932 });
      } catch (err) {
        // 失敗時はUTF-8標準読み込みへフォールバック
        return global.XLSX.read(buffer, { type: 'array' });
      }
    }
    return global.XLSX.read(buffer, { type: 'array' });
  }

  /**
   * 単一店舗パース (後方互換用)
   * @param {ArrayBuffer} buffer - Excel/CSVバイナリバッファ
   * @param {string} [fileName] - ファイル名（期間抽出用）
   * @param {string} [preferredSheet] - 優先シート名
   * @returns {Array}
   */
  function parseSalesExcel(buffer, fileName, preferredSheet) {
    if (!buffer || !(buffer instanceof ArrayBuffer || buffer instanceof Uint8Array)) {
      throw new TypeError('不正なファイル形式です。ArrayBufferを指定してください。');
    }
    if (buffer.byteLength === 0) {
      throw new Error('空のファイルです。有効なExcelまたはCSVファイルを選択してください。');
    }
    if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
      throw new Error('ファイルサイズが上限 (20MB) を超えています。');
    }
    if (typeof global.XLSX === 'undefined') {
      throw new Error('Excel/CSV解析ライブラリ(XLSX)が読み込まれていません。');
    }

    const workbook = readWorkbookSafely(buffer, fileName);
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('ファイル内にシートが見つかりません。');
    }

    // 指定シート、なければ「全店」、無ければ第1シート
    let targetSheet = preferredSheet && workbook.Sheets[preferredSheet] ? preferredSheet : null;
    if (!targetSheet && workbook.Sheets['全店']) {
      targetSheet = '全店';
    }
    if (!targetSheet) {
      targetSheet = workbook.SheetNames[0];
    }

    const worksheet = workbook.Sheets[targetSheet];
    const data = parseSheetRows(worksheet, fileName, targetSheet);
    if (!data || data.length === 0) {
      // 見つからない場合は有効なシートを検索
      for (let s = 0; s < workbook.SheetNames.length; s++) {
        const sName = workbook.SheetNames[s];
        if (SYSTEM_SHEET_NAMES.indexOf(sName) !== -1) continue;
        const fallbackData = parseSheetRows(workbook.Sheets[sName], fileName, sName);
        if (fallbackData && fallbackData.length > 0) {
          return fallbackData;
        }
      }
      throw new Error('有効な売上データブロックが見つかりませんでした。');
    }
    return data;
  }

  /**
   * ワークブック内の全店舗シートを一括解析
   * @param {ArrayBuffer} buffer
   * @param {string} [fileName]
   * @param {Array<string>} [knownProfiles] - ユーザーが登録した店舗プロファイル（任意）
   * @param {string} [currentStoreContext] - 現在選択中の店舗名（単一シートファイル等のバインド先）
   * @returns {{ stores: Object<string, Array>, storeNames: Array<string>, periodInfo: object, fileName: string }}
   */
  function parseAllStoreSheets(buffer, fileName, knownProfiles, currentStoreContext) {
    if (!buffer || !(buffer instanceof ArrayBuffer || buffer instanceof Uint8Array)) {
      throw new TypeError('不正なファイル形式です。ArrayBufferを指定してください。');
    }
    if (buffer.byteLength === 0) {
      throw new Error('空のファイルです。有効なExcelまたはCSVファイルを選択してください。');
    }
    if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
      throw new Error('ファイルサイズが上限 (20MB) を超えています。');
    }
    if (typeof global.XLSX === 'undefined') {
      throw new Error('Excel/CSV解析ライブラリ(XLSX)が読み込まれていません。');
    }

    const candidateProfiles = Array.isArray(knownProfiles) ? knownProfiles : [];
    const workbook = readWorkbookSafely(buffer, fileName);
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('ファイル内にシートが見つかりません。');
    }

    const safeFileName = typeof fileName === 'string' ? fileName : '';

    // ブック内の非システム・非汎用シート一覧
    const meaningfulSheets = workbook.SheetNames.filter(function(s) {
      return !isGenericOrSystemSheet(s);
    });

    // 単一シート、またはSheet1等の汎用シート名のみで構成されているか判定
    const isSingleOrGenericWorkbook = (workbook.SheetNames.length === 1 && isGenericOrSystemSheet(workbook.SheetNames[0])) ||
                                      (meaningfulSheets.length === 0 && workbook.SheetNames.length > 0);

    const stores = {};
    const detectedNames = [];

    // まず期間情報を取得
    const initialSheet = workbook.Sheets['全店'] || workbook.Sheets[workbook.SheetNames[0]];
    const initialRows = initialSheet ? global.XLSX.utils.sheet_to_json(initialSheet, { header: 1, defval: null, blankrows: true }) : [];
    const periodInfo = extractPeriodInfo(initialRows, safeFileName);

    if (isSingleOrGenericWorkbook) {
      // 単一シート（CSVやSheet1等）の場合:
      // 「Sheet1」を店舗名としては絶対に採用せず、
      // 1. ファイル名から店舗名照合
      // 2. 現在選択されている店舗 (currentStoreContext)
      // 3. デフォルト '全店'
      const firstSheetName = workbook.SheetNames[0];
      const targetStoreName = matchStoreName(safeFileName, candidateProfiles) ||
                              (currentStoreContext && candidateProfiles.includes(currentStoreContext) ? currentStoreContext : null) ||
                              currentStoreContext ||
                              '全店';

      const ws = workbook.Sheets[firstSheetName];
      const data = parseSheetRows(ws, safeFileName, targetStoreName, periodInfo);
      if (data && data.length > 0) {
        stores[targetStoreName] = data;
        detectedNames.push(targetStoreName);
      }
    } else {
      // 複数店舗シートを持つワークブックの場合
      workbook.SheetNames.forEach(function(sheetName) {
        const cleanName = String(sheetName).trim();
        // Sheet1 や システム予約シートは店舗名として除外
        if (isGenericOrSystemSheet(cleanName)) {
          return;
        }

        // 動的店舗照合 (登録店舗プロファイルがあれば照合、なければシート名をそのまま正規化)
        const matchedStore = matchStoreName(cleanName, candidateProfiles);
        const targetStoreName = matchedStore || cleanName;

        const ws = workbook.Sheets[sheetName];
        const data = parseSheetRows(ws, safeFileName, targetStoreName, periodInfo);
        if (data && data.length > 0) {
          stores[targetStoreName] = data;
          if (cleanName !== targetStoreName) {
            stores[cleanName] = data;
          }
          if (detectedNames.indexOf(targetStoreName) === -1) {
            detectedNames.push(targetStoreName);
          }
        }
      });
    }

    // シートの出現順序をそのまま保持（「全店」があれば先頭へ）
    const sortedNames = [];
    if (detectedNames.indexOf('全店') !== -1) {
      sortedNames.push('全店');
    }
    detectedNames.forEach(function(name) {
      if (sortedNames.indexOf(name) === -1) {
        sortedNames.push(name);
      }
    });

    return {
      stores: stores,
      storeNames: sortedNames,
      periodInfo: periodInfo,
      fileName: safeFileName
    };
  }

  // グローバル公開 (安全なネームスペース)
  global.SalesParser = {
    MAX_FILE_SIZE_BYTES: MAX_FILE_SIZE_BYTES,
    isGenericOrSystemSheet: isGenericOrSystemSheet,
    matchStoreName: matchStoreName,
    resolveStandardStoreName: resolveStandardStoreName,
    normalizeStoreCore: normalizeStoreCore,
    getStoreStem: getStoreStem,
    extractDayNumber: extractDayNumber,
    extractWeekdayFromCell: extractWeekdayFromCell,
    parseSalesExcel: parseSalesExcel,
    parseAllStoreSheets: parseAllStoreSheets,
    extractPeriodInfo: extractPeriodInfo,
    detectWeekdayHeaders: detectWeekdayHeaders
  };
})(window);
