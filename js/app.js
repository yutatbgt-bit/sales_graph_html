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
  // ハイブリッド・ストレージマネージャー (IndexedDB + localStorage フォールバック)
  // 店舗プロファイルごとのデータ完全分離対応
  // ==========================================================================
  const AppStorage = (function() {
    const DB_NAME = 'SalesGraphAppDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'graph_store';
    const DEFAULT_PROFILE_NAME = '全店';
    const PROFILES_KEY = 'profiles';
    const PROFILE_PREFIX = 'app_state::';

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

    function get(key) {
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
    }

    function set(key, val) {
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
    }

    function remove(key) {
      return openDB().then(function(db) {
        return new Promise(function(resolve, reject) {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.delete(key);
          req.onsuccess = function() { resolve(); };
          req.onerror = function() { reject(req.error); };
        });
      }).catch(function() {
        try {
          localStorage.removeItem('sg_' + key);
        } catch (e) {}
      });
    }

    function getProfiles() {
      return get(PROFILES_KEY).then(function(list) {
        if (Array.isArray(list) && list.length > 0) {
          const cleaned = list.filter(function(p) {
            if (!p || typeof p !== 'string') return false;
            const t = p.trim();
            if (t.length === 0) return false;
            // Sheet1, 空店舗 等の無効なプロファイル名を完全排除
            if (/^(?:sheet\s*\d*|シート\s*\d*|page\s*\d*|table\s*\d*|ワークシート\d*|空店舗)$/i.test(t)) {
              return false;
            }
            return true;
          });
          if (cleaned.length > 0) return cleaned;
        }
        return [DEFAULT_PROFILE_NAME];
      });
    }

    function saveProfiles(profiles) {
      const sanitized = Array.isArray(profiles) ? profiles.filter(function(p) {
        if (!p || typeof p !== 'string') return false;
        const t = p.trim();
        if (t.length === 0) return false;
        if (/^(?:sheet\s*\d*|シート\s*\d*|page\s*\d*|table\s*\d*|ワークシート\d*|空店舗)$/i.test(t)) {
          return false;
        }
        return true;
      }) : [DEFAULT_PROFILE_NAME];
      return set(PROFILES_KEY, sanitized.length > 0 ? sanitized : [DEFAULT_PROFILE_NAME]);
    }

    function loadProfileState(profileName) {
      const name = profileName || DEFAULT_PROFILE_NAME;
      const key = PROFILE_PREFIX + name;
      return get(key).then(function(data) {
        if (data) return data;
        // 旧仕様 (app_state) からの移行互換
        if (name === DEFAULT_PROFILE_NAME) {
          return get('app_state').then(function(legacyData) {
            if (legacyData) {
              set(key, legacyData);
              return legacyData;
            }
            return null;
          });
        }
        return null;
      });
    }

    function saveProfileState(profileName, stateData) {
      const name = profileName || DEFAULT_PROFILE_NAME;
      return set(PROFILE_PREFIX + name, stateData);
    }

    function deleteProfile(profileName) {
      const name = profileName || DEFAULT_PROFILE_NAME;
      return remove(PROFILE_PREFIX + name);
    }

    function clearProfileState(profileName) {
      const name = profileName || DEFAULT_PROFILE_NAME;
      return remove(PROFILE_PREFIX + name);
    }

    function loadAllProfilesState() {
      return getProfiles().then(function(profiles) {
        // ハードコードされた店舗は強制読み込みせず、登録されているプロファイルを基準に取得
        const set = new Set();
        (profiles || []).forEach(function(p) {
          if (p && typeof p === 'string' && p.trim()) set.add(p.trim());
        });
        const targetList = Array.from(set);

        const promises = targetList.map(function(pName) {
          return loadProfileState(pName).then(function(state) {
            return { profileName: pName, state: state };
          });
        });
        return Promise.all(promises);
      });
    }

    function clearAllStoresData() {
      // 1. IndexedDB内の全キーを走査し、PROFILES_KEY以外のすべての売上データを完全削除
      const dbPromise = openDB().then(function(db) {
        return new Promise(function(resolve) {
          try {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);

            // getAllKeys が利用可能な場合は一括キー取得して削除
            if (typeof store.getAllKeys === 'function') {
              const req = store.getAllKeys();
              req.onsuccess = function() {
                const keys = req.result || [];
                keys.forEach(function(k) {
                  // PROFILES_KEY（店舗名リスト）のみ保護し、それ以外の全売上キャッシュ・データを完全消去
                  if (k !== PROFILES_KEY) {
                    store.delete(k);
                  }
                });
              };
            } else if (typeof store.openCursor === 'function') {
              const cursorReq = store.openCursor();
              cursorReq.onsuccess = function(e) {
                const cursor = e.target.result;
                if (cursor) {
                  if (cursor.key !== PROFILES_KEY) {
                    cursor.delete();
                  }
                  cursor.continue();
                }
              };
            }

            tx.oncomplete = function() { resolve(); };
            tx.onerror = function(e) {
              console.warn('[AppStorage] IndexedDB clear tx error:', e);
              resolve();
            };
            tx.onabort = function() { resolve(); };
          } catch (ex) {
            console.warn('[AppStorage] clearAllStoresData tx failed:', ex);
            resolve();
          }
        });
      }).catch(function(err) {
        console.warn('[AppStorage] openDB failed during clearAllStoresData:', err);
      });

      // 2. localStorage 内のフォールバック・キャッシュも走査して完全消去
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            // sg_profiles 以外で sg_ で始まるすべての売上・状態キー（テーマ設定を除く）を確実に削除
            if (k && k !== 'sg_' + PROFILES_KEY && k !== THEME_STORAGE_KEY) {
              if (k.indexOf('sg_app_state') === 0 || k === 'sg_app_state' || k.indexOf('sg_') === 0) {
                keysToRemove.push(k);
              }
            }
          }
          keysToRemove.forEach(function(k) { localStorage.removeItem(k); });
        }
      } catch (e) {
        console.warn('[AppStorage] clear localStorage failed:', e);
      }

      return dbPromise;
    }

    return {
      DEFAULT_PROFILE_NAME: DEFAULT_PROFILE_NAME,
      get: get,
      set: set,
      remove: remove,
      getProfiles: getProfiles,
      saveProfiles: saveProfiles,
      loadProfileState: loadProfileState,
      loadAllProfilesState: loadAllProfilesState,
      saveProfileState: saveProfileState,
      deleteProfile: deleteProfile,
      clearProfileState: clearProfileState,
      clearAllStoresData: clearAllStoresData
    };
  })();

  const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

  // アプリケーション状態
  const THEME_STORAGE_KEY = 'sales_graph_theme';
  let currentTheme = 'dark';
  let comparisonMode = 'date';  // 'date' (同日対比) | 'weekday' (同曜日対比)
  let currentViewMode = 'single'; // 'single' (個別店舗) | 'kanban' (全店同時比較)
  let baseDataSet = null;       // 基準データ (昨年売上)
  let compareDataSet = null;    // 比較日データ (今期売上)
  let baseAllStores = null;     // 全店舗基準データ解析結果
  let compareAllStores = null;  // 全店舗比較日データ解析結果
  let baseFileName = '';
  let compareFileName = '';

  // 店舗プロファイル管理状態
  let currentProfile = AppStorage.DEFAULT_PROFILE_NAME;
  let storeProfiles = [AppStorage.DEFAULT_PROFILE_NAME];
  let profileDialogMode = 'add'; // 'add' | 'rename'

  document.addEventListener('DOMContentLoaded', function() {
    initApp();
  });

  /**
   * 現在の店舗プロファイルに対応するデータをストレージへ永続化
   */
  function saveCurrentProfileState() {
    return AppStorage.saveProfileState(currentProfile, {
      baseDataSet: baseDataSet,
      baseFileName: baseFileName,
      compareDataSet: compareDataSet,
      compareFileName: compareFileName,
      comparisonMode: comparisonMode,
      savedAt: Date.now()
    });
  }

  /**
   * 起動時および店舗切り替え時に保存済みデータを復元
   */
  function restorePersistedData() {
    return AppStorage.loadProfileState(currentProfile).then(function(state) {
      if (!state) {
        clearDashboardUI();
        return;
      }
      let restored = false;
      if (state.baseDataSet) {
        baseDataSet = state.baseDataSet;
        baseFileName = state.baseFileName || '';
        restored = true;
      } else {
        baseDataSet = null;
        baseFileName = '';
      }
      if (state.compareDataSet) {
        compareDataSet = state.compareDataSet;
        compareFileName = state.compareFileName || '';
        restored = true;
      } else {
        compareDataSet = null;
        compareFileName = '';
      }
      if (state.comparisonMode === 'weekday' || state.comparisonMode === 'date') {
        comparisonMode = state.comparisonMode;
        updateComparisonModeButtons();
      }

      if (restored) {
        updateDashboardView();
        showStatusMessage('【' + currentProfile + '】の前回保存データを復元しました。', 'info');
      } else {
        clearDashboardUI();
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

    // 表示ビュー切り替えボタン (個別店舗 / 全店同時比較カンバン)
    const btnViewSingle = document.getElementById('btn-view-single');
    const btnViewKanban = document.getElementById('btn-view-kanban');
    if (btnViewSingle) {
      btnViewSingle.addEventListener('click', function() {
        switchViewMode('single');
      });
    }
    if (btnViewKanban) {
      btnViewKanban.addEventListener('click', function() {
        switchViewMode('kanban');
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

    // 全店舗データ一括削除ボタン（モーダル確認ダイアログを開く）
    const btnResetData = document.getElementById('btn-reset-data');
    if (btnResetData) {
      btnResetData.addEventListener('click', function() {
        openResetConfirmDialog();
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



    // 店舗プロファイル切り替え・管理イベント初期化
    setupProfileEvents();

    // 店舗プロファイル読み込みと初期データ復元
    initProfiles();
  }

  // ---------------------------------------------------------------------------
  // 店舗プロファイル管理 (複数店舗同時並行分析 & ストレージ分離)
  // ---------------------------------------------------------------------------

  function getHashProfile() {
    const hash = window.location.hash || '';
    const match = hash.match(/(?:^|[#&])store=([^&]+)/);
    if (match && match[1]) {
      try {
        const decoded = decodeURIComponent(match[1]).trim();
        if (decoded && decoded.length <= 30 && !/[\u0000-\u001F\u007F<>"'&]/.test(decoded)) {
          return decoded;
        }
      } catch (e) {
        // デコード失敗時は安全に無視
      }
    }
    return null;
  }

  function setHashProfile(profileName) {
    if (!profileName) return;
    const newHash = '#store=' + encodeURIComponent(profileName);
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, '', newHash);
    }
  }

  async function initProfiles() {
    try {
      const profiles = await AppStorage.getProfiles();
      storeProfiles = Array.isArray(profiles) && profiles.length > 0 ? profiles : [AppStorage.DEFAULT_PROFILE_NAME];

      const hashStore = getHashProfile();
      // ハッシュが存在し登録店舗に含まれている場合のみ選択、不正値・テスト残存値ならデフォルト（全店）
      if (hashStore && storeProfiles.includes(hashStore) && hashStore !== '空店舗') {
        currentProfile = hashStore;
      } else {
        currentProfile = storeProfiles[0] || AppStorage.DEFAULT_PROFILE_NAME;
        setHashProfile(currentProfile);
      }

      renderProfileSelect();
      await restorePersistedData();
    } catch (e) {
      console.warn('[initProfiles] failed:', e);
      await restorePersistedData();
    }
  }

  function renderProfileSelect() {
    const select = document.getElementById('select-store-profile');
    if (!select) return;

    while (select.firstChild) {
      select.removeChild(select.firstChild);
    }

    storeProfiles.forEach(function(p) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      if (p === currentProfile) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  async function switchProfile(targetProfile) {
    if (!targetProfile || targetProfile === currentProfile) return;

    // 現在の店舗データを保存
    if (baseDataSet || compareDataSet) {
      await saveCurrentProfileState();
    }

    currentProfile = targetProfile;
    setHashProfile(targetProfile);
    renderProfileSelect();

    // 画面状態をリセットして新店舗のデータを復元
    baseDataSet = null;
    compareDataSet = null;
    baseFileName = '';
    compareFileName = '';
    clearDashboardUI();

    await restorePersistedData();
  }

  function setupProfileEvents() {
    const select = document.getElementById('select-store-profile');
    if (select) {
      select.addEventListener('change', function(e) {
        switchProfile(e.target.value);
      });
    }

    const btnAdd = document.getElementById('btn-add-store-profile');
    if (btnAdd) {
      btnAdd.addEventListener('click', function() {
        openProfileDialog('add');
      });
    }

    const btnRename = document.getElementById('btn-rename-store-profile');
    if (btnRename) {
      btnRename.addEventListener('click', function() {
        openProfileDialog('rename');
      });
    }

    const btnDelete = document.getElementById('btn-delete-store-profile');
    if (btnDelete) {
      btnDelete.addEventListener('click', function() {
        openDeleteProfileDialog();
      });
    }

    // 追加・名称変更モーダルイベント
    const btnClose = document.getElementById('btn-close-profile-dialog');
    const btnCancel = document.getElementById('btn-cancel-profile-dialog');
    const btnSave = document.getElementById('btn-save-profile-dialog');
    const inputName = document.getElementById('input-profile-name');

    if (btnClose) btnClose.addEventListener('click', closeProfileDialog);
    if (btnCancel) btnCancel.addEventListener('click', closeProfileDialog);
    if (btnSave) btnSave.addEventListener('click', saveProfileFromDialog);

    if (inputName) {
      inputName.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          saveProfileFromDialog();
        } else if (e.key === 'Escape') {
          closeProfileDialog();
        }
      });
    }

    // 削除確認モーダルイベント
    const btnCloseDelete = document.getElementById('btn-close-delete-dialog');
    const btnCancelDelete = document.getElementById('btn-cancel-delete-dialog');
    const btnConfirmDelete = document.getElementById('btn-confirm-delete-dialog');

    if (btnCloseDelete) btnCloseDelete.addEventListener('click', closeDeleteProfileDialog);
    if (btnCancelDelete) btnCancelDelete.addEventListener('click', closeDeleteProfileDialog);
    if (btnConfirmDelete) btnConfirmDelete.addEventListener('click', executeDeleteProfile);

    // 全店舗データ一括削除確認モーダルイベント
    const btnCloseReset = document.getElementById('btn-close-reset-dialog');
    const btnCancelReset = document.getElementById('btn-cancel-reset-dialog');
    const btnConfirmReset = document.getElementById('btn-confirm-reset-dialog');

    if (btnCloseReset) btnCloseReset.addEventListener('click', closeResetConfirmDialog);
    if (btnCancelReset) btnCancelReset.addEventListener('click', closeResetConfirmDialog);
    if (btnConfirmReset) btnConfirmReset.addEventListener('click', executeResetAllStoresData);

    // URLハッシュの手動変更・別タブ同期
    window.addEventListener('hashchange', function() {
      const hashStore = getHashProfile();
      if (hashStore && hashStore !== currentProfile) {
        if (!storeProfiles.includes(hashStore)) {
          storeProfiles.push(hashStore);
          AppStorage.saveProfiles(storeProfiles);
        }
        switchProfile(hashStore);
      }
    });
  }

  function openProfileDialog(mode) {
    profileDialogMode = mode;
    const dialog = document.getElementById('profile-dialog');
    const title = document.getElementById('profile-dialog-title');
    const input = document.getElementById('input-profile-name');
    const error = document.getElementById('profile-error-message');

    if (!dialog || !input) return;

    if (error) {
      error.textContent = '';
      error.classList.add('hidden');
    }

    if (mode === 'add') {
      if (title) title.textContent = '新規店舗プロファイルを追加';
      input.value = '';
      input.placeholder = '例: 渋谷店、新宿店、本店';
    } else {
      if (title) title.textContent = '店舗プロファイル名を変更';
      input.value = currentProfile;
      input.placeholder = '新しい店舗名を入力';
    }

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    input.focus();
    input.select();
  }

  function closeProfileDialog() {
    const dialog = document.getElementById('profile-dialog');
    if (!dialog) return;
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  function showProfileError(msg) {
    const error = document.getElementById('profile-error-message');
    if (!error) return;
    error.textContent = msg;
    error.classList.remove('hidden');
  }

  async function saveProfileFromDialog() {
    const input = document.getElementById('input-profile-name');
    if (!input) return;

    const rawName = input.value.trim();

    if (!rawName) {
      showProfileError('店舗名を入力してください。');
      return;
    }
    if (rawName.length > 30) {
      showProfileError('店舗名は30文字以内で入力してください。');
      return;
    }
    if (/[\u0000-\u001F\u007F<>"'&]/.test(rawName)) {
      showProfileError('使用できない記号（< > " \' & 等）が含まれています。');
      return;
    }

    if (profileDialogMode === 'add') {
      if (storeProfiles.includes(rawName)) {
        showProfileError('同名の店舗プロファイルが既に存在します。');
        return;
      }

      // 現在の店舗データを保存
      if (baseDataSet || compareDataSet) {
        await saveCurrentProfileState();
      }

      storeProfiles.push(rawName);
      await AppStorage.saveProfiles(storeProfiles);

      currentProfile = rawName;
      setHashProfile(rawName);
      renderProfileSelect();
      closeProfileDialog();

      // 新規店舗は空の初期状態で開始
      baseDataSet = null;
      compareDataSet = null;
      baseFileName = '';
      compareFileName = '';
      clearDashboardUI();

      // カンバンビュー表示中であれば即座に再描画して連携
      if (currentViewMode === 'kanban') {
        renderKanbanView();
      }

      showStatusMessage('新規店舗「' + rawName + '」を追加しました。', 'success');
    } else {
      // rename モード
      if (rawName === currentProfile) {
        closeProfileDialog();
        return;
      }
      if (storeProfiles.includes(rawName)) {
        showProfileError('同名の店舗プロファイルが既に存在します。');
        return;
      }

      const oldName = currentProfile;
      const currentState = await AppStorage.loadProfileState(oldName);
      if (currentState) {
        await AppStorage.saveProfileState(rawName, currentState);
        await AppStorage.deleteProfile(oldName);
      }

      const idx = storeProfiles.indexOf(oldName);
      if (idx !== -1) {
        storeProfiles[idx] = rawName;
      } else {
        storeProfiles.push(rawName);
      }
      await AppStorage.saveProfiles(storeProfiles);

      currentProfile = rawName;
      setHashProfile(rawName);
      renderProfileSelect();
      closeProfileDialog();

      // カンバンビュー表示中であれば即座に名称同期再描画
      if (currentViewMode === 'kanban') {
        renderKanbanView();
      }

      showStatusMessage('店舗名を「' + rawName + '」に変更しました。', 'success');
    }
  }

  function openDeleteProfileDialog() {
    if (storeProfiles.length <= 1) {
      showStatusMessage('これ以上店舗プロファイルを削除できません（最低1店舗必要です）。', 'warning');
      return;
    }

    const dialog = document.getElementById('delete-confirm-dialog');
    const nameEl = document.getElementById('delete-target-store-name');
    if (!dialog) return;

    if (nameEl) {
      nameEl.textContent = currentProfile;
    }

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeDeleteProfileDialog() {
    const dialog = document.getElementById('delete-confirm-dialog');
    if (!dialog) return;

    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  async function executeDeleteProfile() {
    if (storeProfiles.length <= 1) {
      closeDeleteProfileDialog();
      showStatusMessage('これ以上店舗プロファイルを削除できません（最低1店舗必要です）。', 'warning');
      return;
    }

    const targetName = currentProfile;

    // ストレージから対象店舗データを削除
    await AppStorage.deleteProfile(targetName);

    // 店舗プロファイルリストから除外
    storeProfiles = storeProfiles.filter(function(p) { return p !== targetName; });
    await AppStorage.saveProfiles(storeProfiles);

    // 次の店舗プロファイルに切り替え
    currentProfile = storeProfiles[0] || AppStorage.DEFAULT_PROFILE_NAME;
    setHashProfile(currentProfile);
    renderProfileSelect();

    closeDeleteProfileDialog();

    // 画面状態をリセットして新店舗のデータを復元
    baseDataSet = null;
    compareDataSet = null;
    baseFileName = '';
    compareFileName = '';
    clearDashboardUI();

    await restorePersistedData();

    // 全店同時比較カンバンビュー表示中であれば即座に再描画
    if (currentViewMode === 'kanban') {
      renderKanbanView();
    }

    showStatusMessage('店舗プロファイル「' + targetName + '」を削除しました。', 'info');
  }

  /**
   * 全店舗データ一括削除確認ダイアログを開く
   */
  function openResetConfirmDialog() {
    const dialog = document.getElementById('reset-confirm-dialog');
    if (!dialog) return;

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  /**
   * 全店舗データ一括削除確認ダイアログを閉じる
   */
  function closeResetConfirmDialog() {
    const dialog = document.getElementById('reset-confirm-dialog');
    if (!dialog) return;

    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  /**
   * 全店舗の売上実績データを一括削除する実行処理
   * - 登録済み店舗名プロファイル（全店＋ユーザー登録店舗）は保持
   * - 全店舗の保存データ（IndexedDB/localStorage）を一括クリア
   * - メモリ上のデータセットを初期化し、即座にUIへ反映
   */
  async function executeResetAllStoresData() {
    try {
      // 1. 全店舗の保存データを一括削除 (店舗一覧 profiles は保持)
      await AppStorage.clearAllStoresData();

      // 2. メモリ上のデータセット・ファイル名・全店キャッシュを初期化
      baseDataSet = null;
      compareDataSet = null;
      baseFileName = '';
      compareFileName = '';
      baseAllStores = null;
      compareAllStores = null;

      // 3. カンバン用チャートの破棄
      if (global.SalesChart && typeof global.SalesChart.destroyKanbanCharts === 'function') {
        global.SalesChart.destroyKanbanCharts();
      }
      if (global.SalesChart && typeof global.SalesChart.destroy === 'function') {
        global.SalesChart.destroy();
      }

      // 4. ダッシュボードUIの初期化（バッジ・入力欄・テーブル・KPIすべて）
      clearDashboardUI();

      // 5. カンバンビューも確実に最新のゼロ状態で同期再描画
      await renderKanbanView();

      // 6. ダイアログを閉じる
      closeResetConfirmDialog();

      // 7. ユーザーへの通知
      showStatusMessage('全店舗の売上データを一括削除しました。', 'info');
    } catch (err) {
      console.error('[executeResetAllStoresData] 一括削除エラー:', err);
      closeResetConfirmDialog();
      showStatusMessage('全店舗データの一括削除中にエラーが発生しました。', 'error');
    }
  }

  /**
   * 対比方式ボタンのUIアクティブ状態を同期
   */
  function updateComparisonModeButtons() {
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
  }

  /**
   * ダッシュボード画面上の表示要素を初期クリア状態にする
   */
  function clearDashboardUI() {
    const inputBase = document.getElementById('file-input-base');
    const inputCompare = document.getElementById('file-input-compare');
    if (inputBase) inputBase.value = '';
    if (inputCompare) inputCompare.value = '';

    updateFilePill('file-name-base', null, '', '');
    updateFilePill('file-name-compare', null, '', '');

    if (global.SalesChart && typeof global.SalesChart.destroy === 'function') {
      global.SalesChart.destroy();
    }
    const placeholder = document.getElementById('chart-placeholder');
    const canvas = document.getElementById('sales-chart-canvas');
    if (placeholder) placeholder.classList.remove('hidden');
    const chipGroup = document.querySelector('.metric-chip-group');
    if (chipGroup) while (chipGroup.firstChild) chipGroup.removeChild(chipGroup.firstChild);
    if (canvas) canvas.classList.add('hidden');

    const compareLegend = document.getElementById('compare-legend');
    if (compareLegend) compareLegend.classList.add('hidden');

    const titleEl = document.getElementById('chart-main-title');
    if (titleEl) {
      titleEl.textContent = '日別 売上実績・客数・客単価推移 (全店)';
    }

    const tableTitleEl = document.getElementById('table-main-title');
    if (tableTitleEl) {
      tableTitleEl.textContent = '日別データ一覧';
    }

    const tableContainer = document.getElementById('table-container');
    if (tableContainer) tableContainer.classList.add('hidden');
    const btnToggleTable = document.getElementById('btn-toggle-table');
    if (btnToggleTable) btnToggleTable.textContent = 'データ一覧を表示 ▼';

    const tbody = document.getElementById('table-body');
    if (tbody) {
      while (tbody.firstChild) {
        tbody.removeChild(tbody.firstChild);
      }
    }

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

    // カンバンビューのデータ連携バッジも安全に初期化
    const kanbanBadge = document.getElementById('kanban-store-count-badge');
    if (kanbanBadge) {
      kanbanBadge.textContent = 'データ連携: 0店舗';
      kanbanBadge.classList.add('hidden');
    }
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
    if (!/\.(xlsx|xls|xlsm|xlsb|csv)$/i.test(fileName)) {
      showStatusMessage('ExcelまたはCSVファイル (.xlsx, .xls, .csv) を選択してください。', 'error');
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
        const allStoresParsed = global.SalesParser.parseAllStoreSheets(buffer, fileName, storeProfiles, currentProfile);
        const singleParsed = (allStoresParsed.stores && allStoresParsed.stores[currentProfile]) ||
                             (allStoresParsed.stores && allStoresParsed.stores['全店']) ||
                             global.SalesParser.parseSalesExcel(buffer, fileName, currentProfile);

        if (!singleParsed || singleParsed.length === 0) {
          showStatusMessage('有効な売上データが見つかりませんでした。フォーマットを確認してください。', 'error');
          return;
        }

        // 該当スロットへ格納
        if (targetSlot === 'base') {
          baseDataSet = singleParsed;
          baseFileName = fileName;
          baseAllStores = allStoresParsed;
        } else {
          compareDataSet = singleParsed;
          compareFileName = fileName;
          compareAllStores = allStoresParsed;
        }

        // 店舗プロファイルリストの自動拡張（ファイル内の新規検出店舗を追加順に登録、ただしSheet1等の汎用シート名は除外）
        if (allStoresParsed.storeNames && allStoresParsed.storeNames.length > 0) {
          let profilesChanged = false;
          allStoresParsed.storeNames.forEach(function(sName) {
            if (!sName || typeof sName !== 'string') return;
            const trimmed = sName.trim();
            if (/^(?:sheet\s*\d*|シート\s*\d*|page\s*\d*|table\s*\d*|ワークシート\d*)$/i.test(trimmed)) {
              return;
            }
            if (!storeProfiles.includes(trimmed)) {
              storeProfiles.push(trimmed);
              profilesChanged = true;
            }
          });
          if (profilesChanged) {
            renderProfileSelect();
            AppStorage.saveProfiles(storeProfiles);
          }
        }

        // ファイル内の全店舗データを各店舗プロファイルストレージへその都度自動保存・同期
        if (allStoresParsed.stores && allStoresParsed.storeNames) {
          allStoresParsed.storeNames.forEach(function(sName) {
            const sData = allStoresParsed.stores[sName];
            if (sData && sData.length > 0) {
              AppStorage.loadProfileState(sName).then(function(prevState) {
                const updated = prevState || {};
                if (targetSlot === 'base') {
                  updated.baseDataSet = sData;
                  updated.baseFileName = fileName;
                } else {
                  updated.compareDataSet = sData;
                  updated.compareFileName = fileName;
                }
                updated.comparisonMode = comparisonMode;
                updated.savedAt = Date.now();
                AppStorage.saveProfileState(sName, updated);
              });
            }
          });
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
            const tempAll = baseAllStores;
            baseDataSet = compareDataSet;
            baseFileName = compareFileName;
            baseAllStores = compareAllStores;
            compareDataSet = tempSet;
            compareFileName = tempName;
            compareAllStores = tempAll;
            swapped = true;
          }
        }

        // 現在選択中の店舗データを全店舗データから再抽出（単一店舗ビュー用）
        if (allStoresParsed.stores && allStoresParsed.stores[currentProfile]) {
          if (targetSlot === 'base') {
            baseDataSet = allStoresParsed.stores[currentProfile];
          } else {
            compareDataSet = allStoresParsed.stores[currentProfile];
          }
          ensureWeekdayData(baseDataSet, baseFileName);
          ensureWeekdayData(compareDataSet, compareFileName);
        }

        // 表示ビューに応じたレンダリング
        if (currentViewMode === 'kanban') {
          renderKanbanView();
        } else {
          updateDashboardView();
        }

        // 店舗プロファイルへ非同期永続化保存
        saveCurrentProfileState();

        const periodText = singleParsed.periodInfo && singleParsed.periodInfo.label ? ' (' + singleParsed.periodInfo.label + ')' : '';
        const storeCountText = allStoresParsed.storeNames && allStoresParsed.storeNames.length > 1
          ? ' [' + allStoresParsed.storeNames.length + '店舗を検出]'
          : '';

        if (swapped) {
          showStatusMessage('期間の古いデータを「基準データ(昨年)」、新しいデータを「今期データ」として自動整列しました。' + storeCountText, 'success');
        } else {
          showStatusMessage('「' + fileName + '」' + periodText + storeCountText + ' の読み込みが完了しました。', 'success');
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
   * （現在選択中の店舗データのみを消去し、他店舗データは保護する）
   */
  function resetAllData() {
    baseDataSet = null;
    compareDataSet = null;
    baseFileName = '';
    compareFileName = '';
    baseAllStores = null;
    compareAllStores = null;

    if (global.SalesChart && typeof global.SalesChart.destroyKanbanCharts === 'function') {
      global.SalesChart.destroyKanbanCharts();
    }

    // 現在選択中の店舗プロファイルの永続化データを消去
    AppStorage.clearProfileState(currentProfile);

    // 画面表示を完全初期化
    clearDashboardUI();

    if (currentViewMode === 'kanban') {
      renderKanbanView();
    }

    showStatusMessage('【' + currentProfile + '】のデータをリセットしました。新しいファイルをアップロードしてください。', 'info');
  }

  /**
   * 対比方式の変更 (同日対比 / 同曜日対比)
   * @param {'date'|'weekday'} mode
   */
  function setComparisonMode(mode) {
    if (comparisonMode === mode) return;
    comparisonMode = mode === 'weekday' ? 'weekday' : 'date';

    updateComparisonModeButtons();

    if (currentViewMode === 'kanban') {
      renderKanbanView();
    } else if (baseDataSet || compareDataSet) {
      updateDashboardView();
      saveCurrentProfileState();
    }
  }

  /**
   * 表示ビューモード切り替え (個別店舗 / 全店同時比較カンバン)
   * @param {'single'|'kanban'} mode
   */
  function switchViewMode(mode) {
    currentViewMode = mode === 'kanban' ? 'kanban' : 'single';

    const btnSingle = document.getElementById('btn-view-single');
    const btnKanban = document.getElementById('btn-view-kanban');
    const kanbanContainer = document.getElementById('kanban-view-container');
    const chartCard = document.querySelector('.chart-card');
    const tableContainer = document.getElementById('table-container');
    const btnToggleTable = document.getElementById('btn-toggle-table');

    if (currentViewMode === 'kanban') {
      if (btnSingle) {
        btnSingle.classList.remove('active');
        btnSingle.setAttribute('aria-selected', 'false');
      }
      if (btnKanban) {
        btnKanban.classList.add('active');
        btnKanban.setAttribute('aria-selected', 'true');
      }

      if (chartCard) chartCard.classList.add('hidden');
      if (tableContainer) tableContainer.classList.add('hidden');
      if (btnToggleTable) btnToggleTable.style.display = 'none';
      if (kanbanContainer) kanbanContainer.classList.remove('hidden');

      renderKanbanView();
    } else {
      if (btnSingle) {
        btnSingle.classList.add('active');
        btnSingle.setAttribute('aria-selected', 'true');
      }
      if (btnKanban) {
        btnKanban.classList.remove('active');
        btnKanban.setAttribute('aria-selected', 'false');
      }

      if (kanbanContainer) kanbanContainer.classList.add('hidden');
      if (chartCard) chartCard.classList.remove('hidden');
      if (btnToggleTable) btnToggleTable.style.display = '';

      if (compareDataSet || baseDataSet) {
        updateDashboardView();
      }
    }
  }

  /**
   * 登録店舗の2列カンバンビューを描画
   * ユーザー要件:
   * - データが入っている店舗のみを2列カンバンビューで表示
   * - グラフの項目選択機能は不要
   * - 各グラフィックカードのヘッダーは各店舗名のみ表示
   * - 時間帯の表の表示は不要
   * - 単純にグラフのみを2列カンバンビューで表示
   * - 1つのExcelブック内の複数シートデータ（表記ゆれ自動吸収）
   * - 店舗プロファイルごとに個別に保存されたストレージデータ
   * の両方を完全自動集約・統合してデータが存在する店舗のみを描画する
   */
  async function renderKanbanView() {
    const kanbanGrid = document.getElementById('kanban-grid');
    if (!kanbanGrid) return;

    // 既存のChartインスタンスを全破棄
    if (global.SalesChart && typeof global.SalesChart.destroyKanbanCharts === 'function') {
      global.SalesChart.destroyKanbanCharts();
    }

    // DOM要素をクリア
    while (kanbanGrid.firstChild) {
      kanbanGrid.removeChild(kanbanGrid.firstChild);
    }

    // バッジを即座にリセット（データ連携完了時のみ再表示）
    const badgeEl = document.getElementById('kanban-store-count-badge');
    if (badgeEl) {
      badgeEl.textContent = 'データ連携: 0店舗';
      badgeEl.classList.add('hidden');
    }

    // 1. 各店舗プロファイル（IndexedDB/localStorage）に保存されているデータを全件一括ロード
    let persistedMap = {};
    let hasPersistedData = false;
    try {
      const allPersisted = await AppStorage.loadAllProfilesState();
      if (Array.isArray(allPersisted)) {
        allPersisted.forEach(function(item) {
          if (item && item.state) {
            const hasData = (item.state.compareDataSet && item.state.compareDataSet.length > 0) ||
                            (item.state.baseDataSet && item.state.baseDataSet.length > 0);
            if (hasData) {
              hasPersistedData = true;
              persistedMap[item.profileName] = item.state;
              if (global.SalesParser && typeof global.SalesParser.resolveStandardStoreName === 'function') {
                const std = global.SalesParser.resolveStandardStoreName(item.profileName);
                if (std) persistedMap[std] = item.state;
              }
            }
          }
        });
      }
    } catch (e) {
      console.warn('[renderKanbanView] loadAllProfilesState failed:', e);
    }

    // データが存在するか判定（ファイル直読み込み or ストレージ保存データ）
    const hasAnyData = hasPersistedData || !!(
      (compareAllStores && compareAllStores.storeNames && compareAllStores.storeNames.length > 0) ||
      (baseAllStores && baseAllStores.storeNames && baseAllStores.storeNames.length > 0) ||
      (compareDataSet && compareDataSet.length > 0) ||
      (baseDataSet && baseDataSet.length > 0)
    );

    if (!hasAnyData) {
      const ph = document.createElement('div');
      ph.className = 'kanban-placeholder';
      const icon = document.createElement('div');
      icon.className = 'kanban-placeholder-icon';
      icon.textContent = '📊';
      const p1 = document.createElement('p');
      p1.className = 'placeholder-text';
      p1.textContent = 'ExcelまたはCSVファイルをアップロードすると、比較グラフが2列カンバンビューで表示されます';
      const p2 = document.createElement('p');
      p2.className = 'placeholder-subtext';
      p2.textContent = '画面右上の「基準データアップロード」「比較日データアップロード」からファイルを選択、または店舗ごとにアップロードしてください';
      ph.appendChild(icon);
      ph.appendChild(p1);
      ph.appendChild(p2);
      kanbanGrid.appendChild(ph);
      return;
    }

    // 表示店舗リストの決定（ハードコード廃止: ユーザーが追加した店舗プロファイルを「追加順」でそのまま表示）
    const storeNames = [];
    const seenStores = new Set();

    function addStore(name) {
      if (!name || typeof name !== 'string') return;
      const trimmed = name.trim();
      if (!trimmed || trimmed === 'デフォルト') return;
      if (!seenStores.has(trimmed)) {
        seenStores.add(trimmed);
        storeNames.push(trimmed);
      }
    }

    // 1. ユーザーが追加した店舗プロファイルを「追加された順番」で最優先に登録
    if (Array.isArray(storeProfiles)) {
      storeProfiles.forEach(function(p) {
        addStore(p);
      });
    }

    // 2. アップロードされたファイルから検出された店舗があれば出現順に追加
    if (compareAllStores && Array.isArray(compareAllStores.storeNames)) {
      compareAllStores.storeNames.forEach(function(s) { addStore(s); });
    }
    if (baseAllStores && Array.isArray(baseAllStores.storeNames)) {
      baseAllStores.storeNames.forEach(function(s) { addStore(s); });
    }

    // 3. ストレージ内に保存されている店舗で未追加のものがあれば追加
    Object.keys(persistedMap).forEach(function(k) {
      addStore(k);
    });

    // 店舗が全くない場合は「全店」をフォールバック
    if (storeNames.length === 0) {
      addStore('全店');
    }

    // 各店舗のデータ集約カウント用
    let storesWithDataCount = 0;

    // 各店舗カードを2列カンバングリッドに生成
    storeNames.forEach(function(storeName) {
      let curData = null;
      let baseData = null;
      let curFileName = compareFileName;
      let baseFileNameToUse = baseFileName;

      // 1. 直近アップロードされたファイル内のシートデータ（表記ゆれ自動解決）
      if (compareAllStores && compareAllStores.stores) {
        curData = compareAllStores.stores[storeName];
        if (!curData && global.SalesParser && global.SalesParser.resolveStandardStoreName) {
          for (const k in compareAllStores.stores) {
            if (global.SalesParser.resolveStandardStoreName(k) === storeName) {
              curData = compareAllStores.stores[k];
              break;
            }
          }
        }
      }
      if (baseAllStores && baseAllStores.stores) {
        baseData = baseAllStores.stores[storeName];
        if (!baseData && global.SalesParser && global.SalesParser.resolveStandardStoreName) {
          for (const k in baseAllStores.stores) {
            if (global.SalesParser.resolveStandardStoreName(k) === storeName) {
              baseData = baseAllStores.stores[k];
              break;
            }
          }
        }
      }

      // 2. 店舗プロファイル（ストレージ保存データ）からの補完
      const savedState = persistedMap[storeName];
      if (savedState) {
        if (!curData && savedState.compareDataSet && savedState.compareDataSet.length > 0) {
          curData = savedState.compareDataSet;
          if (savedState.compareFileName) curFileName = savedState.compareFileName;
        }
        if (!baseData && savedState.baseDataSet && savedState.baseDataSet.length > 0) {
          baseData = savedState.baseDataSet;
          if (savedState.baseFileName) baseFileNameToUse = savedState.baseFileName;
        }
      }

      // 3. 現在アクティブな店舗プロファイルのメモリ上データ
      if (storeName === currentProfile || (storeName === '全店' && !curData && !baseData && (currentProfile === 'デフォルト' || currentProfile === '全店'))) {
        if (!curData && compareDataSet && compareDataSet.length > 0) {
          curData = compareDataSet;
        }
        if (!baseData && baseDataSet && baseDataSet.length > 0) {
          baseData = baseDataSet;
        }
      }

      const hasStoreData = !!((curData && curData.length > 0) || (baseData && baseData.length > 0));
      // ユーザー要件: データが入っていない店舗はカンバンに表示しない（データが存在する店舗のみ描画）
      if (!hasStoreData) {
        return;
      }
      storesWithDataCount++;

      // 曜日データの保証
      ensureWeekdayData(curData, curFileName);
      ensureWeekdayData(baseData, baseFileNameToUse);

      const card = document.createElement('div');
      card.className = 'kanban-card has-data';

      // ヘッダー: 店舗名のみ表示 (ユーザー要求: 余計な日付対比文字列や項目選択チップは一切不要)
      const header = document.createElement('div');
      header.className = 'kanban-card-header';

      const title = document.createElement('h4');
      title.className = 'kanban-store-title';
      title.textContent = storeName;
      header.appendChild(title);

      if (storeName === '全店') {
        const tag = document.createElement('span');
        tag.className = 'kanban-store-tag';
        tag.textContent = '全体合計';
        header.appendChild(tag);
      } else {
        const tag = document.createElement('span');
        tag.className = 'kanban-store-tag tag-ready';
        tag.textContent = '連携済';
        header.appendChild(tag);
      }

      card.appendChild(header);

      // グラフ描画領域 (Canvas)
      const chartWrapper = document.createElement('div');
      chartWrapper.className = 'kanban-chart-wrapper';

      const canvas = document.createElement('canvas');
      canvas.className = 'kanban-chart-canvas';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', storeName + ' 売上・客数・客単価 対比グラフ');
      chartWrapper.appendChild(canvas);

      card.appendChild(chartWrapper);
      kanbanGrid.appendChild(card);

      // チャート描画
      global.SalesChart.renderKanbanChart(canvas, curData, baseData, comparisonMode);
    });

    // データが存在する店舗が1つもない場合のフォールバック表示
    if (storesWithDataCount === 0) {
      const ph = document.createElement('div');
      ph.className = 'kanban-placeholder';
      const icon = document.createElement('div');
      icon.className = 'kanban-placeholder-icon';
      icon.textContent = '📊';
      const p1 = document.createElement('p');
      p1.className = 'placeholder-text';
      p1.textContent = '現在、売上データが読み込まれている店舗がありません';
      const p2 = document.createElement('p');
      p2.className = 'placeholder-subtext';
      p2.textContent = '画面右上の「基準データアップロード」「比較日データアップロード」からファイルを選択、または店舗ごとにアップロードしてください';
      ph.appendChild(icon);
      ph.appendChild(p1);
      ph.appendChild(p2);
      kanbanGrid.appendChild(ph);
    }

    // バッジの店舗数更新 (データが存在する店舗数のみを表示し、0店舗時は非表示)
    if (badgeEl) {
      if (storesWithDataCount > 0) {
        badgeEl.textContent = 'データ連携: ' + storesWithDataCount + '店舗';
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.textContent = 'データ連携: 0店舗';
        badgeEl.classList.add('hidden');
      }
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
    saveCurrentProfileState();
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
    saveCurrentProfileState();
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
    if (shouldRerenderChart) {
      if (currentViewMode === 'kanban') {
        renderKanbanView();
      } else if (baseDataSet || compareDataSet) {
        updateDashboardView();
      }
    }
  }

})(window);
