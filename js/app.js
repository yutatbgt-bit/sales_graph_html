/**
 * 売上分析ダッシュボード メインコントローラー (Dark Luxury Theme)
 * セキュリティ方針:
 * - innerHTML / outerHTML は一切禁止
 * - DOM生成は createElement / textContent / appendChild のみで行う
 * - XSS耐性、ファイル型およびサイズ制限、厳格なファイル名サニタイズ
 * - 基準データ（昨年）と比較日データ（今期）の期間自動判定・安全なスワップ
 */
(function(global) {
  'use strict';

  // 許容最大ファイルサイズ (20MB)
  
  // ==========================================================================
  // ハイブリッド・ストレージマネージャー (IndexedDB + localStorage フォールバック)
  // ==========================================================================
  const AppStorage = (function() {
    const DB_NAME = 'SalesGraphAppDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'graph_store';

    function openDB() {
      return new Promise(function(resolve, reject) {
        if (!window.indexedDB) {
          return reject(new Error('IndexedDB not supported'));
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function(e) {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        req.onsuccess = function(e) { resolve(e.target.result); };
        req.onerror = function(e) { reject(e.target.error); };
      });
    }

    return {
      get: function(key) {
        return openDB().then(function(db) {
          return new Promise(function(resolve, reject) {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(key);
            req.onsuccess = function() { resolve(req.result); };
            req.onerror = function() { reject(req.error); };
          });
        }).catch(function() {
          try {
            const raw = localStorage.getItem('sg_' + key);
            return raw ? JSON.parse(raw) : null;
          } catch (e) {
            return null;
          }
        });
      },
      set: function(key, val) {
        return openDB().then(function(db) {
          return new Promise(function(resolve, reject) {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(val, key);
            req.onsuccess = function() { resolve(); };
            req.onerror = function() { reject(req.error); };
          });
        }).catch(function() {
          try {
            localStorage.setItem('sg_' + key, JSON.stringify(val));
          } catch (e) {
            console.warn('[AppStorage] localStorage set failed:', e);
          }
        });
      },
      clearAll: function() {
        return openDB().then(function(db) {
          return new Promise(function(resolve, reject) {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.clear();
            req.onsuccess = function() { resolve(); };
            req.onerror = function() { reject(req.error); };
          });
        }).catch(function() {
          try {
            localStorage.removeItem('sg_app_state');
          } catch (e) {}
        });
      }
    };
  })();

  const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

  // アプリケーション状態
  const THEME_STORAGE_KEY = 'sales_graph_theme';
  let currentTheme = 'dark';
  let comparisonMode = 'date';  // 'date' (同日対比) | 'weekday' (同曜日対比)
  let baseDataSet = null;       // 基準データ (昨年売上)
  let compareDataSet = null;    // 比較日データ (今期売上)
  let baseFileName = '';
  let compareFileName = '';

  document.addEventListener('DOMContentLoaded', function() {
    initApp();
  });

  
  /**
   * 起動時に保存済みデータを復元
   */
  function restorePersistedData() {
    AppStorage.get('app_state').then(function(state) {
      if (!state) return;
      let restored = false;
      if (state.baseDataSet) {
        baseDataSet = state.baseDataSet;
        baseFileName = state.baseFileName || '';
        restored = true;
      }
      if (state.compareDataSet) {
        compareDataSet = state.compareDataSet;
        compareFileName = state.compareFileName || '';
        restored = true;
      }
      if (restored) {
        updateDashboardView();
        showStatusMessage('前回保存された売上データを自動復元しました。', 'info');
      }
    }).catch(function(err) {
      console.warn('[restorePersistedData] error:', err);
    });
  }

  function initApp() {
    // テーマ初期化
    initTheme();

    // 全画面表示の初期化
    initFullscreen();

    // テーマ切り替えボタン
    const btnThemeToggle = document.getElementById('btn-theme-toggle');
    if (btnThemeToggle) {
      btnThemeToggle.addEventListener('click', function() {
        toggleTheme();
      });
    }

    // 対比方式切り替えボタン (同日対比 / 同曜日対比)
    const btnModeDate = document.getElementById('btn-mode-date');
    const btnModeWeekday = document.getElementById('btn-mode-weekday');
    if (btnModeDate) {
      btnModeDate.addEventListener('click', function() {
        setComparisonMode('date');
      });
    }
    if (btnModeWeekday) {
      btnModeWeekday.addEventListener('click', function() {
        setComparisonMode('weekday');
      });
    }

    // 基準データ用コントロール
    setupDropZone('drop-zone-base', 'file-input-base', function(file) {
      handleFileSelected(file, 'base');
    });

    // 比較日データ用コントロール
    setupDropZone('drop-zone-compare', 'file-input-compare', function(file) {
      handleFileSelected(file, 'compare');
    });

    // PNG保存ボタン
    const btnExportPng = document.getElementById('btn-export-png');
    if (btnExportPng) {
      btnExportPng.addEventListener('click', function() {
        if (!compareDataSet && !baseDataSet) {
          showStatusMessage('エクスポートするデータがありません。Excelファイルをアップロードしてください。', 'error');
          return;
        }

        let prefix = 'sales_comparison';
        if (compareFileName) {
          prefix = sanitizeFileBase(compareFileName);
        } else if (baseFileName) {
          prefix = sanitizeFileBase(baseFileName);
        }
        const exportName = prefix + '_chart.png';

        try {
          global.SalesChart.exportImage(exportName);
          showStatusMessage('高解像度グラフ画像をダウンロードしました。', 'success');
        } catch (err) {
          showStatusMessage('画像の保存に失敗しました: ' + err.message, 'error');
        }
      });
    }

    // データ詳細テーブルの表示切り替え
    const btnToggleTable = document.getElementById('btn-toggle-table');
    if (btnToggleTable) {
      btnToggleTable.addEventListener('click', function() {
        if (!compareDataSet && !baseDataSet) {
          showStatusMessage('表示するデータがありません。先にExcelファイルをアップロードしてください。', 'info');
          return;
        }
        const tableContainer = document.getElementById('table-container');
        if (!tableContainer) return;
        const isHidden = tableContainer.classList.contains('hidden');
        if (isHidden) {
          tableContainer.classList.remove('hidden');
          btnToggleTable.textContent = 'データ一覧を隠す ▲';
        } else {
          tableContainer.classList.add('hidden');
          btnToggleTable.textContent = 'データ一覧を表示 ▼';
        }
      });
    }

    // データリセットボタン
    const btnResetData = document.getElementById('btn-reset-data');
    if (btnResetData) {
      btnResetData.addEventListener('click', function() {
        if (!compareDataSet && !baseDataSet) {
          showStatusMessage('リセットするデータがありません。', 'info');
          return;
        }
        resetAllData();
      });
    }

    // 起動時に保存済みデータを復元

    // ファイル名ピルをクリックで個別即削除 (確認不要)
    const pillBase = document.getElementById('file-name-base');
    if (pillBase) {
      pillBase.addEventListener('click', function() {
        removeBaseFile();
      });
    }
    const pillCompare = document.getElementById('file-name-compare');
    if (pillCompare) {
      pillCompare.addEventListener('click', function() {
        removeCompareFile();
      });
    }



    restorePersistedData();
  }

  /**
   * ドロップゾーンとファイル選択の汎用バインド
   * @param {string} dropZoneId
   * @param {string} fileInputId
   * @param {function(File): void} onSelectCallback
   */
  function setupDropZone(dropZoneId, fileInputId, onSelectCallback) {
    const dropZone = document.getElementById(dropZoneId);
    const fileInput = document.getElementById(fileInputId);

    if (fileInput) {
      fileInput.addEventListener('change', function(e) {
        const file = e.target.files && e.target.files[0];
        if (file) {
          onSelectCallback(file);
          fileInput.value = ''; // 同一ファイル再選択を許可
        }
      });
    }

    if (dropZone) {
      ['dragenter', 'dragover'].forEach(function(eventName) {
        dropZone.addEventListener(eventName, function(e) {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.add('drag-over');
        });
      });

      ['dragleave', 'drop'].forEach(function(eventName) {
        dropZone.addEventListener(eventName, function(e) {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.remove('drag-over');
        });
      });

      dropZone.addEventListener('drop', function(e) {
        const dt = e.dataTransfer;
        const file = dt && dt.files && dt.files[0];
        if (file) {
          onSelectCallback(file);
        }
      });

      dropZone.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (fileInput) fileInput.click();
        }
      });
    }
  }

  /**
   * 選択されたExcelファイルの検証とパース
   * @param {File} file
   * @param {'base'|'compare'} targetSlot
   */
  function handleFileSelected(file, targetSlot) {
    if (!file) return;

    if (file.size === 0) {
      showStatusMessage('空のファイルです。有効なExcelファイルを選択してください。', 'error');
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      showStatusMessage('ファイルサイズが上限 (20MB) を超えています (選択ファイル: ' + sizeMB + 'MB)。', 'error');
      return;
    }

    const fileName = file.name || '';
    if (!fileName.toLowerCase().endsWith('.xlsx') && !fileName.toLowerCase().endsWith('.xls')) {
      showStatusMessage('Excelファイル (.xlsx または .xls) を選択してください。', 'error');
      return;
    }

    const slotLabel = targetSlot === 'base' ? '基準データ' : '比較日データ';
    showStatusMessage(slotLabel + 'を解析中: ' + fileName + ' ...', 'info');

    const reader = new FileReader();
    reader.onerror = function() {
      showStatusMessage('ファイルの読み込み中にI/Oエラーが発生しました。破損またはアクセス権限を確認してください。', 'error');
    };
    reader.onload = function(e) {
      try {
        const buffer = e.target.result;
        const parsed = global.SalesParser.parseSalesExcel(buffer, fileName);
        if (!parsed || parsed.length === 0) {
          showStatusMessage('有効な売上データが見つかりませんでした。フォーマットを確認してください。', 'error');
          return;
        }

        // 該当スロットへ一時格納
        if (targetSlot === 'base') {
          baseDataSet = parsed;
          baseFileName = fileName;
        } else {
          compareDataSet = parsed;
          compareFileName = fileName;
        }

        // 2つのファイルが存在する場合、期間チェック（古い方を基準、新しい方を比較に自動調整）
        let swapped = false;
        if (baseDataSet && compareDataSet) {
          const baseKey = (baseDataSet.periodInfo && baseDataSet.periodInfo.dateKey) || 0;
          const compKey = (compareDataSet.periodInfo && compareDataSet.periodInfo.dateKey) || 0;

          // 基準データの方が新しい日付である場合、意図通りスワップ
          if (baseKey > 0 && compKey > 0 && baseKey > compKey) {
            const tempSet = baseDataSet;
            const tempName = baseFileName;
            baseDataSet = compareDataSet;
            baseFileName = compareFileName;
            compareDataSet = tempSet;
            compareFileName = tempName;
            swapped = true;
          }
        }

        updateDashboardView();

        // ストレージへ非同期永続化保存
        AppStorage.set('app_state', {
          baseDataSet: baseDataSet,
          baseFileName: baseFileName,
          compareDataSet: compareDataSet,
          compareFileName: compareFileName,
          savedAt: Date.now()
        });

        const periodText = parsed.periodInfo && parsed.periodInfo.label ? ' (' + parsed.periodInfo.label + ')' : '';
        if (swapped) {
          showStatusMessage('期間の古いデータを「基準データ(昨年)」、新しいデータを「今期データ」として自動整列しました。', 'success');
        } else {
          showStatusMessage('「' + fileName + '」' + periodText + ' の読み込みが完了しました。', 'success');
        }
      } catch (err) {
        showStatusMessage('解析エラー: ' + err.message, 'error');
      }
    };

    reader.onerror = function() {
      showStatusMessage('ファイルの読み込み中にエラーが発生しました。', 'error');
    };

    reader.readAsArrayBuffer(file);
  }

  /**
   * アップロードデータおよび画面表示を完全リセットして初期状態へ戻す
   */
  function resetAllData() {
    baseDataSet = null;
    compareDataSet = null;
    baseFileName = '';
    compareFileName = '';

    // ストレージから永続化データを完全消去
    AppStorage.clearAll();

    // ファイル入力要素のリセット
    const inputBase = document.getElementById('file-input-base');
    const inputCompare = document.getElementById('file-input-compare');
    if (inputBase) inputBase.value = '';
    if (inputCompare) inputCompare.value = '';

    // ファイル名ピルを非表示
    updateFilePill('file-name-base', null, '', '');
    updateFilePill('file-name-compare', null, '', '');

    // グラフの破棄とプレースホルダーの再表示
    if (global.SalesChart && typeof global.SalesChart.destroy === 'function') {
      global.SalesChart.destroy();
    }
    const placeholder = document.getElementById('chart-placeholder');
    const canvas = document.getElementById('sales-chart-canvas');
    if (placeholder) placeholder.classList.remove('hidden');
    const chipGroup = document.querySelector('.metric-chip-group');
    if (chipGroup) while (chipGroup.firstChild) chipGroup.removeChild(chipGroup.firstChild);
    if (canvas) canvas.classList.add('hidden');

    // グラフタイトルのリセット
    const titleEl = document.getElementById('chart-main-title');
    if (titleEl) {
      titleEl.textContent = '日別 売上実績・客数・客単価推移 (全店)';
    }

    // テーブルタイトルのリセット
    const tableTitleEl = document.getElementById('table-main-title');
    if (tableTitleEl) {
      tableTitleEl.textContent = '日別データ一覧';
    }

    // テーブル表示の非表示化
    const tableContainer = document.getElementById('table-container');
    if (tableContainer) tableContainer.classList.add('hidden');
    const btnToggleTable = document.getElementById('btn-toggle-table');
    if (btnToggleTable) btnToggleTable.textContent = 'データ一覧を表示 ▼';

    // テーブル行のクリア
    const tbody = document.getElementById('table-body');
    if (tbody) {
      while (tbody.firstChild) {
        tbody.removeChild(tbody.firstChild);
      }
    }

    // KPIカードのリセット
    setTextSafely('kpi-total-sales', '-');
    setTextSafely('kpi-total-sales-sub', '期間内の総売上実績');
    const salesSub = document.getElementById('kpi-total-sales-sub');
    if (salesSub) salesSub.className = 'kpi-subtext';

    setTextSafely('kpi-total-customers', '-');
    setTextSafely('kpi-total-customers-sub', '期間内の合計客数');
    const custSub = document.getElementById('kpi-total-customers-sub');
    if (custSub) custSub.className = 'kpi-subtext';

    setTextSafely('kpi-avg-price', '-');
    setTextSafely('kpi-avg-price-sub', '総売上 ÷ 総来客数');
    const priceSub = document.getElementById('kpi-avg-price-sub');
    if (priceSub) priceSub.className = 'kpi-subtext';

    setTextSafely('kpi-avg-daily-sales', '-');
    setTextSafely('kpi-active-days', '未解析');
    const daysSub = document.getElementById('kpi-active-days');
    if (daysSub) daysSub.className = 'kpi-subtext';

    showStatusMessage('データをリセットしました。新しいファイルをアップロードしてください。', 'info');
  }

  /**
   * 対比方式の変更 (同日対比 / 同曜日対比)
   * @param {'date'|'weekday'} mode
   */
  function setComparisonMode(mode) {
    if (comparisonMode === mode) return;
    comparisonMode = mode === 'weekday' ? 'weekday' : 'date';

    const btnModeDate = document.getElementById('btn-mode-date');
    const btnModeWeekday = document.getElementById('btn-mode-weekday');
    if (btnModeDate && btnModeWeekday) {
      if (comparisonMode === 'weekday') {
        btnModeDate.classList.remove('active');
        btnModeWeekday.classList.add('active');
      } else {
        btnModeWeekday.classList.remove('active');
        btnModeDate.classList.add('active');
      }
    }

    if (baseDataSet || compareDataSet) {
      updateDashboardView();
    }
  }

  /**
   * データセット内に曜日情報が欠落している場合、ファイル名・期間情報・列番号から自動補完
   * @param {Array} dataSet
   * @param {string} fileName
   */
  function ensureWeekdayData(dataSet, fileName) {
    if (!Array.isArray(dataSet) || dataSet.length === 0) return;
    const hasDow = dataSet.some(function(d) { return d.dayOfWeek !== null && d.dayOfWeek !== undefined; });
    if (hasDow) return;

    let y = dataSet.periodInfo && dataSet.periodInfo.year;
    let m = dataSet.periodInfo && dataSet.periodInfo.month;
    if ((!y || !m) && fileName) {
      const extracted = global.SalesParser.extractPeriodInfo([], fileName);
      y = extracted.year;
      m = extracted.month;
    }

    const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
    dataSet.forEach(function(item) {
      if (y && m) {
        const dt = new Date(y, m - 1, item.Day);
        if (!isNaN(dt.getTime())) {
          item.dayOfWeek = dt.getDay();
          item.weekday = WEEKDAY_NAMES[item.dayOfWeek];
          return;
        }
      }
      if (typeof item.colIndex === 'number') {
        item.dayOfWeek = item.colIndex % 7;
        item.weekday = WEEKDAY_NAMES[item.dayOfWeek];
      } else {
        item.dayOfWeek = (item.Day + 1) % 7; // フォールバック
        item.weekday = WEEKDAY_NAMES[item.dayOfWeek];
      }
    });
  }

  /**
   * 対比ペアの実績存在日に基づいて正確な期間文字列（例: 2026年9月1日〜14日 - 2025年9月1日〜14日）を生成
   * @param {Array} pairs
   * @param {Array} curData
   * @param {Array} baseData
   * @param {'date'|'weekday'} mode
   * @returns {{ curText: string, baseText: string }}
   */
  function getAccuratePeriodLabels(pairs, curData, baseData, mode) {
    const curYear = (curData && curData.periodInfo && curData.periodInfo.year) || '';
    const curMonth = (curData && curData.periodInfo && curData.periodInfo.month) || '';
    const baseYear = (baseData && baseData.periodInfo && baseData.periodInfo.year) || '';
    const baseMonth = (baseData && baseData.periodInfo && baseData.periodInfo.month) || '';

    let curMinDay = null, curMaxDay = null;
    let baseMinDay = null, baseMaxDay = null;

    if (Array.isArray(pairs)) {
      pairs.forEach(function(p) {
        const c = p.curItem;
        const b = p.baseItem;
        if (c && ((c['売上'] || 0) > 0 || (c['客数'] || 0) > 0)) {
          if (curMinDay === null || c.Day < curMinDay) curMinDay = c.Day;
          if (curMaxDay === null || c.Day > curMaxDay) curMaxDay = c.Day;

          if (b) {
            if (baseMinDay === null || b.Day < baseMinDay) baseMinDay = b.Day;
            if (baseMaxDay === null || b.Day > baseMaxDay) baseMaxDay = b.Day;
          }
        }
      });
    }

    // フォールバック
    if (curMinDay === null && curData && curData.length > 0) {
      curMinDay = curData[0].Day;
      curMaxDay = curData[curData.length - 1].Day;
    }
    if (baseMinDay === null && baseData && baseData.length > 0) {
      baseMinDay = baseData[0].Day;
      baseMaxDay = baseData[baseData.length - 1].Day;
    }

    let curText = '';
    if (curYear && curMonth) {
      if (curMinDay !== null && curMaxDay !== null) {
        curText = curMinDay === curMaxDay
          ? curYear + '年' + curMonth + '月' + curMinDay + '日'
          : curYear + '年' + curMonth + '月' + curMinDay + '日〜' + curMaxDay + '日';
      } else {
        curText = curYear + '年' + curMonth + '月';
      }
    } else {
      curText = (curData && curData.periodInfo && curData.periodInfo.label) || '今期';
    }

    let baseText = '';
    if (baseYear && baseMonth) {
      if (baseMinDay !== null && baseMaxDay !== null) {
        baseText = baseMinDay === baseMaxDay
          ? baseYear + '年' + baseMonth + '月' + baseMinDay + '日'
          : baseYear + '年' + baseMonth + '月' + baseMinDay + '日〜' + baseMaxDay + '日';
      } else {
        baseText = baseYear + '年' + baseMonth + '月';
      }
    } else {
      baseText = (baseData && baseData.periodInfo && baseData.periodInfo.label) || '昨年';
    }

    return {
      curText: curText,
      baseText: baseText
    };
  }

  /**
   * メインタイトルの更新 (正確な期間範囲を表示)
   */
  function updateMainChartTitle(pairs, primaryData, secondaryData, hasCompare, hasBase, effectiveMode) {
    const titleEl = document.getElementById('chart-main-title');
    if (!titleEl) return;

    if (hasCompare && hasBase) {
      const periods = getAccuratePeriodLabels(pairs, compareDataSet, baseDataSet, effectiveMode);
      const modeSuffix = effectiveMode === 'weekday' ? ' [同曜日対比]' : ' [同日対比]';
      titleEl.textContent = '日別 売上実績・客数・客単価 対比グラフ (' + periods.curText + '-' + periods.baseText + ')' + modeSuffix;
    } else if (hasCompare) {
      const periods = getAccuratePeriodLabels(pairs, compareDataSet, null, effectiveMode);
      titleEl.textContent = '日別 売上実績・客数・客単価推移 (' + periods.curText + ')';
    } else {
      const periods = getAccuratePeriodLabels(pairs, null, baseDataSet, effectiveMode);
      titleEl.textContent = '日別 売上実績・客数・客単価推移 (' + periods.baseText + ')';
    }
  }

  /**
   * 現在のデータセット状態（単体または対比）に応じて画面全体を更新
   */

  /**
   * 基準データを個別で即時削除
   */
  function removeBaseFile() {
    if (!baseDataSet && !baseFileName) return;
    baseDataSet = null;
    baseFileName = '';
    const fileInputBase = document.getElementById('file-input-base');
    if (fileInputBase) fileInputBase.value = '';
    updateFilePill('file-name-base', null, '', '');

    if (!compareDataSet && !compareFileName) {
      resetAllData();
      showStatusMessage('基準データを削除しました。データがすべてクリアされました。', 'info');
      return;
    }
    updateDashboardView();
    AppStorage.set('app_state', {
      baseDataSet: null,
      baseFileName: '',
      compareDataSet: compareDataSet,
      compareFileName: compareFileName,
      comparisonMode: comparisonMode
    });
    showStatusMessage('基準データを削除しました。', 'info');
  }

  /**
   * 比較日データを個別で即時削除
   */
  function removeCompareFile() {
    if (!compareDataSet && !compareFileName) return;
    compareDataSet = null;
    compareFileName = '';
    const fileInputCompare = document.getElementById('file-input-compare');
    if (fileInputCompare) fileInputCompare.value = '';
    updateFilePill('file-name-compare', null, '', '');

    if (!baseDataSet && !baseFileName) {
      resetAllData();
      showStatusMessage('比較日データを削除しました。データがすべてクリアされました。', 'info');
      return;
    }
    updateDashboardView();
    AppStorage.set('app_state', {
      baseDataSet: baseDataSet,
      baseFileName: baseFileName,
      compareDataSet: null,
      compareFileName: '',
      comparisonMode: comparisonMode
    });
    showStatusMessage('比較日データを削除しました。', 'info');
  }


  /**
   * グラフの全データセット項目（修正前の全項目）に対応した指標切替チップを動的生成・同期
   */
  function updateMetricChips() {
    const container = document.querySelector('.metric-chip-group');
    if (!container || !global.SalesChart || !global.SalesChart.getDatasetsInfo) return;

    const datasetsInfo = global.SalesChart.getDatasetsInfo();
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    if (!datasetsInfo || datasetsInfo.length === 0) return;

    datasetsInfo.forEach(function(info) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'metric-chip chip-' + info.metricType + (info.isBase ? ' chip-base' : ' chip-cur');
      chip.setAttribute('data-key', info.key);
      chip.setAttribute('aria-pressed', info.hidden ? 'false' : 'true');
      chip.textContent = info.label;

      chip.addEventListener('click', function() {
        const isActive = global.SalesChart.toggleDataset(info.key);
        chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });

      container.appendChild(chip);
    });
  }

  function updateDashboardView() {
    // 既存データセットへの曜日データの保証（再アップロードなしでも即時反映）
    ensureWeekdayData(baseDataSet, baseFileName);
    ensureWeekdayData(compareDataSet, compareFileName);

    // ファイル名ピルの更新
    updateFilePill('file-name-base', baseDataSet, baseFileName, '基準(昨年)');
    updateFilePill('file-name-compare', compareDataSet, compareFileName, '比較(今期)');

    const hasCompare = !!(compareDataSet && compareDataSet.length > 0);
    const hasBase = !!(baseDataSet && baseDataSet.length > 0);

    if (!hasCompare && !hasBase) return;

    // compareDataSetを主（今期）、baseDataSetを従（昨年）として描画
    const primaryData = hasCompare ? compareDataSet : baseDataSet;
    const secondaryData = hasCompare ? baseDataSet : null;

    // 曜日対比の実行 (双方に曜日が保証されているため comparisonMode をそのまま適用)
    const effectiveMode = comparisonMode;

    // 対比ペアの生成 (単一の情報源)
    const pairs = global.SalesChart.buildComparisonPairs(primaryData, secondaryData, effectiveMode);

    // プレースホルダーを隠し、キャンバスを表示
    const placeholder = document.getElementById('chart-placeholder');
    const canvas = document.getElementById('sales-chart-canvas');
    if (placeholder) placeholder.classList.add('hidden');
    if (canvas) {
      canvas.classList.remove('hidden');
      global.SalesChart.render(canvas, primaryData, secondaryData, effectiveMode);
    }

    // メインタイトルの更新 (正確な期間範囲を表示)
    updateMainChartTitle(pairs, primaryData, secondaryData, hasCompare, hasBase, effectiveMode);

    // テーブルタイトルの更新
    const tableTitleEl = document.getElementById('table-main-title');
    if (tableTitleEl) {
      const tSuffix = (hasCompare && hasBase) ? (effectiveMode === 'weekday' ? ' (同曜日対比)' : ' (同日対比)') : '';
      tableTitleEl.textContent = '日別データ一覧' + tSuffix;
    }

    // 比較凡例の更新
    const compareLegendEl = document.getElementById('compare-legend');
    if (compareLegendEl) {
      const showCompareLegend = hasCompare && hasBase;
      compareLegendEl.classList.toggle('hidden', !showCompareLegend);
      if (showCompareLegend) {
        const curLabel = document.getElementById('legend-cur-label');
        const baseLabel = document.getElementById('legend-base-label');
        if (curLabel) curLabel.textContent = '今期(比較)';
        if (baseLabel) baseLabel.textContent = effectiveMode === 'weekday' ? '昨年同曜日(基準)' : '昨年(基準)';
      }
    }
    // KPIサマリーカードの更新（前年比バッジ付き: 同日数・同曜日の正確な集計）
    updateKpiCards(pairs, primaryData, secondaryData, effectiveMode);

    // グラフ領域の項目選択チップ（修正前と同じ全項目）の生成・更新
    updateMetricChips();

    // テーブルの更新
    renderDataTable(pairs, effectiveMode);
  }

  /**
   * ファイル名ピル要素の表示・内容更新
   */
  function updateFilePill(pillId, dataSet, fileName, prefix) {
    const el = document.getElementById(pillId);
    if (!el) return;

    if (dataSet && fileName) {
      const periodLabel = dataSet.periodInfo && dataSet.periodInfo.label ? ' [' + dataSet.periodInfo.label + ']' : '';
      el.textContent = prefix + ': ' + fileName + periodLabel;
      el.setAttribute('title', 'クリックして ' + prefix + ' を即時削除\n' + fileName);
      el.classList.remove('hidden');
    } else {
      el.removeAttribute('title');
      el.classList.add('hidden');
    }
  }

  /**
   * KPIカードの値を計算して安全にテキスト・バッジ設定
   * 【同日数・同曜日対比ルール】
   * 昨年の月末までと対比するのではなく、今期データに実績がある日数（有効日）と同じ日数分の昨年データ（同日または同曜日）と対比する。
   * @param {Array} pairs - 対比ペア配列
   * @param {Array|null} curData - 今期
   * @param {Array|null} baseData - 昨年
   * @param {'date'|'weekday'} [mode='date'] - 対比方式
   */
  function updateKpiCards(pairs, curData, baseData, mode) {
    const curSummary = summarizeData(curData);
    const baseSummary = summarizeData(baseData);

    // 主に表示するサマリー (今期優先、なければ基準)
    const mainSum = curSummary || baseSummary;
    if (!mainSum) return;

    setTextSafely('kpi-total-sales', '¥' + mainSum.totalSales.toLocaleString());
    setTextSafely('kpi-total-customers', mainSum.totalCustomers.toLocaleString() + ' 人');
    setTextSafely('kpi-avg-price', '¥' + mainSum.avgPrice.toLocaleString());
    setTextSafely('kpi-avg-daily-sales', '¥' + mainSum.avgDailySales.toLocaleString());
    setTextSafely('kpi-active-days', mainSum.validDays + ' 日 / ' + mainSum.totalDays + ' 日');

    // 対比情報（前年同日数・同曜日対比バッジ）の挿入
    if (curSummary && baseSummary) {
      let pairCurSales = 0;
      let pairBaseSales = 0;
      let pairCurCount = 0;
      let pairBaseCount = 0;
      let matchedDays = 0;

      if (Array.isArray(pairs)) {
        pairs.forEach(function(p) {
          const c = p.curItem;
          const b = p.baseItem;

          const cSales = c ? (c['売上'] || 0) : 0;
          const cCount = c ? (c['客数'] || 0) : 0;

          // 今期に実績が存在する日（有効営業日）のみを対比対象とする
          if (cSales > 0 || cCount > 0) {
            pairCurSales += cSales;
            pairCurCount += cCount;

            // 今期実績日に対応する昨年の同日または同曜日データを加算
            if (b) {
              const bSales = b['売上'] || 0;
              const bCount = b['客数'] || 0;
              pairBaseSales += bSales;
              pairBaseCount += bCount;
              if (bSales > 0 || bCount > 0) {
                matchedDays++;
              }
            }
          }
        });
      }

      // 今期有効日数と同じ日数（同日数）での前年比を算出
      const useSalesCur = pairCurSales > 0 ? pairCurSales : curSummary.totalSales;
      const useSalesBase = pairBaseSales;
      const useCountCur = pairCurCount > 0 ? pairCurCount : curSummary.totalCustomers;
      const useCountBase = pairBaseCount;

      const usePriceCur = useCountCur > 0 ? Math.round(useSalesCur / useCountCur) : curSummary.avgPrice;
      const usePriceBase = useCountBase > 0 ? Math.round(useSalesBase / useCountBase) : 0;

      const modeText = (mode === 'weekday' ? '同曜日・同日数' : '同日・同日数') + ' (' + curSummary.validDays + '日分)';

      renderKpiSubBadge('kpi-total-sales-sub', useSalesCur, useSalesBase, '¥', true, modeText);
      renderKpiSubBadge('kpi-total-customers-sub', useCountCur, useCountBase, '人', false, modeText);
      renderKpiSubBadge('kpi-avg-price-sub', usePriceCur, usePriceBase, '¥', true, modeText);

      // 4つ目のカード (営業日数 / 日平均売上) にも昨年対比を反映
      const baseDailyAvg = (curSummary.validDays > 0 && useSalesBase > 0) ? Math.round(useSalesBase / curSummary.validDays) : 0;
      if (baseDailyAvg > 0) {
        const dailyRatio = ((mainSum.avgDailySales / baseDailyAvg) * 100).toFixed(1);
        setTextSafely('kpi-active-days', curSummary.validDays + ' 日分 (昨年日平均: ¥' + baseDailyAvg.toLocaleString() + ' / ' + dailyRatio + '%)');
      } else {
        setTextSafely('kpi-active-days', mainSum.validDays + ' 日 / ' + mainSum.totalDays + ' 日');
      }
    } else {
      setTextSafely('kpi-total-sales-sub', '期間内の総売上実績');
      setTextSafely('kpi-total-customers-sub', '期間内の合計客数');
      setTextSafely('kpi-avg-price-sub', '総売上 ÷ 総来客数');
      setTextSafely('kpi-active-days', mainSum.validDays + ' 日 / ' + mainSum.totalDays + ' 日');
    }
  }

  /**
   * 配列データの集計ヘルパー
   */
  function summarizeData(dataList) {
    if (!Array.isArray(dataList) || dataList.length === 0) return null;

    let totalSales = 0;
    let totalCustomers = 0;
    let validDays = 0;

    dataList.forEach(function(item) {
      const sales = item['売上'] || 0;
      const count = item['客数'] || 0;
      if (sales > 0 || count > 0) {
        totalSales += sales;
        totalCustomers += count;
        validDays += 1;
      }
    });

    const avgPrice = totalCustomers > 0 ? Math.round(totalSales / totalCustomers) : 0;
    const avgDailySales = validDays > 0 ? Math.round(totalSales / validDays) : 0;

    return {
      totalSales: totalSales,
      totalCustomers: totalCustomers,
      avgPrice: avgPrice,
      avgDailySales: avgDailySales,
      validDays: validDays,
      totalDays: dataList.length
    };
  }

  /**
   * KPIカード下部の対比バッジ描画 (安全なDOM APIのみを使用)
   * 対比対象となった昨年側の実績値（同日/同曜日の同日数合計）を明示
   */
  function renderKpiSubBadge(elementId, curVal, baseVal, unit, isCurrency, contextNote) {
    const parentEl = document.getElementById(elementId);
    if (!parentEl) return;

    while (parentEl.firstChild) {
      parentEl.removeChild(parentEl.firstChild);
    }

    if (!baseVal || baseVal === 0) {
      const span = document.createElement('span');
      span.className = 'kpi-subtext';
      span.textContent = '前年実績なし';
      parentEl.appendChild(span);
      return;
    }

    const diff = curVal - baseVal;
    const ratio = ((curVal / baseVal) * 100).toFixed(1);

    const badge = document.createElement('span');
    badge.className = 'kpi-badge';

    const diffFormatted = (isCurrency ? '¥' : '') + Math.abs(diff).toLocaleString() + (isCurrency ? '' : ' ' + unit);
    const baseFormatted = (isCurrency ? '¥' : '') + baseVal.toLocaleString() + (isCurrency ? '' : ' ' + unit);
    const sign = diff >= 0 ? '+' : '▲';
    const noteText = contextNote ? ' [' + contextNote + ']' : '';

    if (diff > 0) {
      badge.classList.add('badge-up');
    } else if (diff < 0) {
      badge.classList.add('badge-down');
    } else {
      badge.classList.add('badge-neutral');
    }

    badge.textContent = '前年比 ' + ratio + '% (' + sign + diffFormatted + ' / 昨年: ' + baseFormatted + ')' + noteText;

    parentEl.appendChild(badge);
  }

  /**
   * 日別データ一覧テーブルの描画 (安全なDOM APIのみを使用)
   * @param {Array<{ day: number, curItem: object|null, baseItem: object|null, curLabel: string, baseLabel: string }>} pairs
   * @param {'date'|'weekday'} mode
   */
  function renderDataTable(pairs, mode) {
    const tbody = document.getElementById('table-body');
    if (!tbody) return;

    while (tbody.firstChild) {
      tbody.removeChild(tbody.firstChild);
    }

    if (!Array.isArray(pairs) || pairs.length === 0) return;

    let sumCurSales = 0, sumBaseSales = 0;
    let sumCurCount = 0, sumBaseCount = 0;

    pairs.forEach(function(pair) {
      const curItem = pair.curItem;
      const baseItem = pair.baseItem;
      const curSales = curItem ? (curItem['売上'] || 0) : 0;
      const baseSales = baseItem ? (baseItem['売上'] || 0) : 0;
      const curCount = curItem ? (curItem['客数'] || 0) : 0;
      const baseCount = baseItem ? (baseItem['客数'] || 0) : 0;

      // 今期実績が存在する日（過日）のみを合計対象とする
      if (curSales > 0 || curCount > 0) {
        sumCurSales += curSales;
        sumBaseSales += baseSales;
        sumCurCount += curCount;
        sumBaseCount += baseCount;
      }
    });

    const sumCurPrice = sumCurCount > 0 ? Math.round(sumCurSales / sumCurCount) : 0;
    const sumBasePrice = sumBaseCount > 0 ? Math.round(sumBaseSales / sumBaseCount) : 0;

    const trTotal = document.createElement('tr');
    trTotal.style.backgroundColor = 'var(--table-hover)';
    trTotal.style.borderBottom = '2px solid var(--card-border)';

    const tdTotalLabel = document.createElement('td');
    tdTotalLabel.className = 'text-center font-bold';
    tdTotalLabel.style.fontWeight = 'bold';
    tdTotalLabel.textContent = '合計';
    trTotal.appendChild(tdTotalLabel);

    const tdTotalCurSales = document.createElement('td');
    tdTotalCurSales.className = 'text-right font-bold color-sales';
    tdTotalCurSales.style.fontWeight = 'bold';
    tdTotalCurSales.textContent = sumCurSales > 0 ? '¥' + sumCurSales.toLocaleString() : '-';
    trTotal.appendChild(tdTotalCurSales);

    const tdTotalBaseSales = document.createElement('td');
    tdTotalBaseSales.className = 'text-right font-bold text-muted-val';
    tdTotalBaseSales.style.fontWeight = 'bold';
    tdTotalBaseSales.textContent = sumBaseSales > 0 ? '¥' + sumBaseSales.toLocaleString() : '-';
    trTotal.appendChild(tdTotalBaseSales);

    const tdTotalSalesRatio = document.createElement('td');
    if (sumCurSales > 0 && sumBaseSales > 0) {
      const ratio = ((sumCurSales / sumBaseSales) * 100).toFixed(1);
      tdTotalSalesRatio.textContent = ratio + '%';
      tdTotalSalesRatio.className = 'text-right font-bold ' + (sumCurSales >= sumBaseSales ? 'text-diff-up' : 'text-diff-down');
    } else {
      tdTotalSalesRatio.textContent = '-';
      tdTotalSalesRatio.className = 'text-right font-bold text-diff-neutral';
    }
    tdTotalSalesRatio.style.fontWeight = 'bold';
    trTotal.appendChild(tdTotalSalesRatio);

    const tdTotalCurCount = document.createElement('td');
    tdTotalCurCount.className = 'text-right font-bold color-count';
    tdTotalCurCount.style.fontWeight = 'bold';
    tdTotalCurCount.textContent = sumCurCount > 0 ? sumCurCount.toLocaleString() + ' 人' : '-';
    trTotal.appendChild(tdTotalCurCount);

    const tdTotalBaseCount = document.createElement('td');
    tdTotalBaseCount.className = 'text-right font-bold text-muted-val';
    tdTotalBaseCount.style.fontWeight = 'bold';
    tdTotalBaseCount.textContent = sumBaseCount > 0 ? sumBaseCount.toLocaleString() + ' 人' : '-';
    trTotal.appendChild(tdTotalBaseCount);

    const tdTotalCountDiff = document.createElement('td');
    if (sumCurCount > 0 && sumBaseCount > 0) {
      const diff = sumCurCount - sumBaseCount;
      tdTotalCountDiff.textContent = (diff > 0 ? '+' : '') + diff.toLocaleString() + ' 人';
      tdTotalCountDiff.className = 'text-right font-bold ' + (diff >= 0 ? 'text-diff-up' : 'text-diff-down');
    } else {
      tdTotalCountDiff.textContent = '-';
      tdTotalCountDiff.className = 'text-right font-bold text-diff-neutral';
    }
    tdTotalCountDiff.style.fontWeight = 'bold';
    trTotal.appendChild(tdTotalCountDiff);

    const tdTotalCountRatio = document.createElement('td');
    if (sumCurCount > 0 && sumBaseCount > 0) {
      const ratio = ((sumCurCount / sumBaseCount) * 100).toFixed(1);
      tdTotalCountRatio.textContent = ratio + '%';
      tdTotalCountRatio.className = 'text-right font-bold ' + (sumCurCount >= sumBaseCount ? 'text-diff-up' : 'text-diff-down');
    } else {
      tdTotalCountRatio.textContent = '-';
      tdTotalCountRatio.className = 'text-right font-bold text-diff-neutral';
    }
    tdTotalCountRatio.style.fontWeight = 'bold';
    trTotal.appendChild(tdTotalCountRatio);

    const tdTotalCurPrice = document.createElement('td');
    tdTotalCurPrice.className = 'text-right font-bold color-price';
    tdTotalCurPrice.style.fontWeight = 'bold';
    tdTotalCurPrice.textContent = sumCurPrice > 0 ? '¥' + sumCurPrice.toLocaleString() : '-';
    trTotal.appendChild(tdTotalCurPrice);

    const tdTotalBasePrice = document.createElement('td');
    tdTotalBasePrice.className = 'text-right font-bold text-muted-val';
    tdTotalBasePrice.style.fontWeight = 'bold';
    tdTotalBasePrice.textContent = sumBasePrice > 0 ? '¥' + sumBasePrice.toLocaleString() : '-';
    trTotal.appendChild(tdTotalBasePrice);

    const tdTotalPriceDiff = document.createElement('td');
    if (sumCurPrice > 0 && sumBasePrice > 0) {
      const diff = sumCurPrice - sumBasePrice;
      tdTotalPriceDiff.textContent = (diff > 0 ? '+¥' : '-¥') + Math.abs(diff).toLocaleString();
      tdTotalPriceDiff.className = 'text-right font-bold ' + (diff >= 0 ? 'text-diff-up' : 'text-diff-down');
    } else {
      tdTotalPriceDiff.textContent = '-';
      tdTotalPriceDiff.className = 'text-right font-bold text-diff-neutral';
    }
    tdTotalPriceDiff.style.fontWeight = 'bold';
    trTotal.appendChild(tdTotalPriceDiff);

    const tdTotalPriceRatio = document.createElement('td');
    if (sumCurPrice > 0 && sumBasePrice > 0) {
      const ratio = ((sumCurPrice / sumBasePrice) * 100).toFixed(1);
      tdTotalPriceRatio.textContent = ratio + '%';
      tdTotalPriceRatio.className = 'text-right font-bold ' + (sumCurPrice >= sumBasePrice ? 'text-diff-up' : 'text-diff-down');
    } else {
      tdTotalPriceRatio.textContent = '-';
      tdTotalPriceRatio.className = 'text-right font-bold text-diff-neutral';
    }
    tdTotalPriceRatio.style.fontWeight = 'bold';
    trTotal.appendChild(tdTotalPriceRatio);

    tbody.appendChild(trTotal);

    // ヘッダー行の高さを明示的に固定し、透過ボーダーによる文字透けを完全に防ぐ
    const theadRow = document.getElementById('table-header-row');
    if (theadRow) {
      Array.from(theadRow.children).forEach(th => {
        th.style.height = '46px';
        th.style.boxSizing = 'border-box';
        // 透過ボーダーを無くし、内側への影(inset)でボーダーを描画することで裏透けを物理的に遮断
        th.style.borderBottom = 'none';
        th.style.boxShadow = 'inset 0 -2px 0 0 var(--card-border)';
      });
    }

    // 合計行をスクロール時にカラム行の直下に完全に固定する設定
    Array.from(trTotal.children).forEach(function(td) {
      td.style.position = 'sticky';
      td.style.top = '46px'; // ヘッダーの固定高さと完全に一致させる（ジャンプ防止）
      td.style.zIndex = '9'; // ヘッダー(10)の下、通常セルより上
      td.style.backgroundColor = 'var(--table-th-bg)'; // 透けないようにヘッダーと同色
      td.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)'; // 境界を分かりやすくする下方向の影
      td.style.backgroundClip = 'padding-box';
    });

    pairs.forEach(function(pair) {
      const curItem = pair.curItem;
      const baseItem = pair.baseItem;

      const curSales = curItem ? (curItem['売上'] || 0) : 0;
      const baseSales = baseItem ? (baseItem['売上'] || 0) : 0;
      const isBothZero = curSales === 0 && baseSales === 0;

      const tr = document.createElement('tr');
      if (isBothZero) {
        tr.classList.add('row-inactive');
      }

      // 日付 (日付 + 曜日バッジ)
      const tdDay = document.createElement('td');
      tdDay.className = 'text-center font-medium';
      
      const daySpan = document.createElement('span');
      daySpan.textContent = pair.day + '日';
      tdDay.appendChild(daySpan);

      if (curItem && curItem.weekday) {
        const dowBadge = document.createElement('span');
        dowBadge.textContent = curItem.weekday;
        dowBadge.className = 'weekday-badge';
        if (curItem.dayOfWeek === 6) {
          dowBadge.classList.add('weekday-sat');
        } else if (curItem.dayOfWeek === 0) {
          dowBadge.classList.add('weekday-sun');
        }
        tdDay.appendChild(dowBadge);
      }
      tr.appendChild(tdDay);

      // 今期売上
      const tdCurSales = document.createElement('td');
      tdCurSales.textContent = curItem && curSales > 0 ? '¥' + curSales.toLocaleString() : '-';
      tdCurSales.className = 'text-right font-semibold color-sales';
      tr.appendChild(tdCurSales);

      // 昨年売上
      const tdBaseSales = document.createElement('td');
      tdBaseSales.textContent = baseItem && baseSales > 0 ? '¥' + baseSales.toLocaleString() : '-';
      tdBaseSales.className = 'text-right text-muted-val';
      if (mode === 'weekday' && baseItem) {
        tdBaseSales.title = '対比対象(昨年): ' + pair.baseLabel;
      }
      tr.appendChild(tdBaseSales);

      // 売上前年比
      const tdRatio = document.createElement('td');
      if (curSales > 0 && baseSales > 0) {
        const ratioVal = ((curSales / baseSales) * 100).toFixed(1);
        tdRatio.textContent = ratioVal + '%';
        tdRatio.className = 'text-right ' + (curSales >= baseSales ? 'text-diff-up' : 'text-diff-down');
      } else {
        tdRatio.textContent = '-';
        tdRatio.className = 'text-right text-diff-neutral';
      }
      tr.appendChild(tdRatio);

      // 今期客数
      const curCount = curItem ? (curItem['客数'] || 0) : 0;
      const tdCurCount = document.createElement('td');
      tdCurCount.textContent = curCount > 0 ? curCount.toLocaleString() + ' 人' : '-';
      tdCurCount.className = 'text-right color-count';
      tr.appendChild(tdCurCount);

      // 昨年客数
      const baseCount = baseItem ? (baseItem['客数'] || 0) : 0;
      const tdBaseCount = document.createElement('td');
      tdBaseCount.textContent = baseCount > 0 ? baseCount.toLocaleString() + ' 人' : '-';
      tdBaseCount.className = 'text-right text-muted-val';
      if (mode === 'weekday' && baseItem) {
        tdBaseCount.title = '対比対象(昨年): ' + pair.baseLabel;
      }
              tr.appendChild(tdBaseCount);

        // 客数差分
        const tdCountDiff = document.createElement('td');
        if (curCount > 0 && baseCount > 0) {
          const countDiffVal = curCount - baseCount;
          tdCountDiff.textContent = (countDiffVal > 0 ? '+' : '') + countDiffVal.toLocaleString() + ' 人';
          tdCountDiff.className = 'text-right ' + (countDiffVal >= 0 ? 'text-diff-up' : 'text-diff-down');
        } else {
          tdCountDiff.textContent = '-';
          tdCountDiff.className = 'text-right text-diff-neutral';
        }
        tr.appendChild(tdCountDiff);

      // 客数前年比
      const tdCountRatio = document.createElement('td');
      if (curCount > 0 && baseCount > 0) {
        const countRatioVal = ((curCount / baseCount) * 100).toFixed(1);
        tdCountRatio.textContent = countRatioVal + '%';
        tdCountRatio.className = 'text-right ' + (curCount >= baseCount ? 'text-diff-up' : 'text-diff-down');
      } else {
        tdCountRatio.textContent = '-';
        tdCountRatio.className = 'text-right text-diff-neutral';
      }
      tr.appendChild(tdCountRatio);

      // 今期単価
      const curPrice = curItem ? (curItem['客単価'] || 0) : 0;
      const tdCurPrice = document.createElement('td');
      tdCurPrice.textContent = curPrice > 0 ? '¥' + curPrice.toLocaleString() : '-';
      tdCurPrice.className = 'text-right color-price';
      tr.appendChild(tdCurPrice);

      // 昨年単価
      const basePrice = baseItem ? (baseItem['客単価'] || 0) : 0;
      const tdBasePrice = document.createElement('td');
      tdBasePrice.textContent = basePrice > 0 ? '¥' + basePrice.toLocaleString() : '-';
      tdBasePrice.className = 'text-right text-muted-val';
      if (mode === 'weekday' && baseItem) {
        tdBasePrice.title = '対比対象(昨年): ' + pair.baseLabel;
      }
              tr.appendChild(tdBasePrice);

        // 単価差分
        const tdPriceDiff = document.createElement('td');
        if (curPrice > 0 && basePrice > 0) {
          const priceDiffVal = curPrice - basePrice;
          tdPriceDiff.textContent = (priceDiffVal > 0 ? '+¥' : '-¥') + Math.abs(priceDiffVal).toLocaleString();
          tdPriceDiff.className = 'text-right ' + (priceDiffVal >= 0 ? 'text-diff-up' : 'text-diff-down');
        } else {
          tdPriceDiff.textContent = '-';
          tdPriceDiff.className = 'text-right text-diff-neutral';
        }
        tr.appendChild(tdPriceDiff);

      // 客単価前年比
      const tdPriceRatio = document.createElement('td');
      if (curPrice > 0 && basePrice > 0) {
        const priceRatioVal = ((curPrice / basePrice) * 100).toFixed(1);
        tdPriceRatio.textContent = priceRatioVal + '%';
        tdPriceRatio.className = 'text-right ' + (curPrice >= basePrice ? 'text-diff-up' : 'text-diff-down');
      } else {
        tdPriceRatio.textContent = '-';
        tdPriceRatio.className = 'text-right text-diff-neutral';
      }
      tr.appendChild(tdPriceRatio);

      tbody.appendChild(tr);
    });
  }

  function sanitizeFileBase(fileName) {
    if (!fileName) return 'sales';
    const stripped = fileName.replace(/\.[^/.]+$/, '');
    const sanitized = stripped.replace(/[^a-zA-Z0-9_\-\u3040-\u30FF\u4E00-\u9FFF]/g, '_').substring(0, 50);
    return sanitized || 'sales';
  }

  function setTextSafely(elementId, text) {
    const el = document.getElementById(elementId);
    if (el) {
      el.textContent = text;
    }
  }

  function showStatusMessage(message, type) {
    const statusEl = document.getElementById('status-message');
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.className = 'status-banner status-' + (type || 'info');
    statusEl.classList.remove('hidden');

    if (type === 'success' || type === 'info') {
      setTimeout(function() {
        if (statusEl.textContent === message) {
          statusEl.classList.add('hidden');
        }
      }, 6000);
    }
  }

  /**
   * 全画面表示切り替え機能の初期化
   */
  function initFullscreen() {
    const fullscreenBtn = document.getElementById('btn-fullscreen');
    if (!fullscreenBtn) return;

    fullscreenBtn.addEventListener('click', function() {
      const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (!isFullscreen) {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) {
          docEl.requestFullscreen().catch(function(err) {
            showStatusMessage('全画面表示への切り替えに失敗しました: ' + err.message, 'error');
          });
        } else if (docEl.webkitRequestFullscreen) {
          docEl.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(function(err) {
            showStatusMessage('全画面表示の解除に失敗しました: ' + err.message, 'error');
          });
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    });

    function handleFullscreenChange() {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (isFs) {
        fullscreenBtn.setAttribute('title', '全画面表示を解除します');
        fullscreenBtn.setAttribute('aria-label', '全画面表示を解除');
        fullscreenBtn.setAttribute('aria-pressed', 'true');
      } else {
        fullscreenBtn.setAttribute('title', '全画面表示に切り替えます');
        fullscreenBtn.setAttribute('aria-label', '全画面表示に切り替え');
        fullscreenBtn.setAttribute('aria-pressed', 'false');
      }
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
  }

  /**
   * テーマ初期化 (localStorageのホワイトリスト読み込み)
   */
  function initTheme() {
    let savedTheme = 'dark';
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      // ホワイトリスト厳格検証
      if (stored === 'light' || stored === 'dark') {
        savedTheme = stored;
      }
    } catch (e) {
      // プライベートブラウズ等の例外時はデフォルト維持
      savedTheme = 'dark';
    }
    applyTheme(savedTheme, false);
  }

  /**
   * テーマ切り替え (トグル)
   */
  function toggleTheme() {
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme, true);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch (e) {
      // 保存不可環境でも画面動作は継続
    }
  }

  /**
   * テーマ適用とUI・グラフ同期
   * @param {'dark'|'light'} theme
   * @param {boolean} shouldRerenderChart
   */
  function applyTheme(theme, shouldRerenderChart) {
    currentTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);

    const themeBtn = document.getElementById('btn-theme-toggle');
    if (themeBtn) {
      if (currentTheme === 'light') {
        themeBtn.setAttribute('title', 'ダークモードに切り替えます');
        themeBtn.setAttribute('aria-label', 'ダークモードに切り替え');
        themeBtn.setAttribute('aria-pressed', 'true');
      } else {
        themeBtn.setAttribute('title', 'ライトモードに切り替えます');
        themeBtn.setAttribute('aria-label', 'ライトモードに切り替え');
        themeBtn.setAttribute('aria-pressed', 'false');
      }
    }

    const themeText = document.getElementById('theme-text');
    if (themeText) {
      themeText.textContent = currentTheme === 'dark' ? 'dark mode' : 'light mode';
    }

    // チャートが存在していればテーマ連動再描画
    if (shouldRerenderChart && (baseDataSet || compareDataSet)) {
      updateDashboardView();
    }
  }

})(window);
