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
  function parseSalesExcel(buffer, fileName) {
    if (!buffer || !(buffer instanceof ArrayBuffer || buffer instanceof Uint8Array)) {
      throw new TypeError('不正なファイル形式です。ArrayBufferを指定してください。');
    }

    if (typeof global.XLSX === 'undefined') {
      throw new Error('Excel解析ライブラリ(XLSX)が読み込まれていません。');
    }

    // SheetJS でワークブックをパース
    const workbook = global.XLSX.read(buffer, { type: 'array' });
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('Excelファイル内にシートが見つかりません。');
    }

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    if (!worksheet) {
      throw new Error('シートの読み込みに失敗しました。');
    }

    // 2次元配列として取得 (空セルも保持)
    const rows = global.XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      blankrows: true
    });

    const parsedData = [];

    // 5ブロック分（週ごと、4行単位）を取得
    for (let i = 0; i < 5; i++) {
      const startRow = 4 + i * 4;
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

        const dateStr = String(dateVal).trim();
        if (!dateStr || dateStr === 'nan') {
          continue;
        }

        // 日にちの数字だけを抽出 (例: "01日" -> 1)
        const digitsOnly = dateStr.replace(/\D/g, '');
        if (!digitsOnly) {
          continue;
        }

        const day = parseInt(digitsOnly, 10);
        if (!Number.isFinite(day) || day < 1 || day > 31) {
          continue;
        }

        // 各値の安全な数値変換 (NaN や 無効値は 0 にフォールバック)
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
          colIndex: col
        });
      }
    }

    // 日付順に昇順ソート
    parsedData.sort(function(a, b) {
      return a.Day - b.Day;
    });

    // 期間情報のメタデータを配列プロパティに安全に付与
    const safeFileName = typeof fileName === 'string' ? fileName : '';
    const periodInfo = extractPeriodInfo(rows, safeFileName);
    parsedData.periodInfo = periodInfo;
    parsedData.fileName = safeFileName;

    // シート内曜日ヘッダー列の検出 (直接的な曜日マップ)
    const headerDowMap = detectWeekdayHeaders(rows);

    const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

    // 3段構えの曜日決定ロジック:
    // 1. 年月が特定できている場合は Date オブジェクトから正確に計算 (最優先)
    // 2. 年月が未特定でも、シート内に曜日ヘッダー行がある場合はその列番号から決定
    // 3. どちらも無い場合は、一般的な日曜始まりカレンダー (col: 0=日, 1=月...) として列番号から推定
    parsedData.forEach(function(item) {
      let dow = null;

      if (periodInfo.year && periodInfo.month) {
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

  // グローバル公開 (安全なネームスペース)
  global.SalesParser = {
    parseSalesExcel: parseSalesExcel,
    extractPeriodInfo: extractPeriodInfo,
    detectWeekdayHeaders: detectWeekdayHeaders
  };
})(window);
