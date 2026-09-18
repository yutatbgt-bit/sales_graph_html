/**
 * 3軸売上グラフ描画・対比エクスポートモジュール (Dark / Light Theme 完全連動)
 * セキュリティ方針:
 * - DOM直接挿入ではなくChart.jsのCanvasレンダリングAPIを利用
 * - XSS耐性、危険関数の不使用
 * - テーマ（ダーク/ライト）に応じた視認性・コントラストの自動最適化
 */
(function(global) {
  'use strict';

  let currentChartInstance = null;

  /**
   * 単体または対比の売上データをChart.jsで描画する
   * @param {HTMLCanvasElement} canvasElement
   * @param {Array<{Day: number, 客単価: number, 客数: number, 売上: number}>} currentData - 今期（比較データ）
   * @param {Array<{Day: number, 客単価: number, 客数: number, 売上: number}>} [baseData] - 昨年（基準データ、任意）
   */
  /**
   * 今期と昨年の対比ペア一覧を安全に生成 (同日対比または同曜日対比)
   * @param {Array} currentData - 今期
   * @param {Array} baseData - 昨年
   * @param {'date'|'weekday'} mode - 対比モード
   * @returns {Array<{ day: number, curItem: object|null, baseItem: object|null, curLabel: string, baseLabel: string }>}
   */
  function buildComparisonPairs(currentData, baseData, mode) {
    const hasCurrent = Array.isArray(currentData) && currentData.length > 0;
    const hasBase = Array.isArray(baseData) && baseData.length > 0;

    let maxDay = 31;
    const daySet = new Set();
    if (hasCurrent) currentData.forEach(function(d) { daySet.add(d.Day); });
    if (hasBase) baseData.forEach(function(d) { daySet.add(d.Day); });
    if (daySet.size > 0) {
      maxDay = Math.max.apply(null, Array.from(daySet));
    }
    maxDay = Math.max(maxDay, 28);

    const currentMap = {};
    if (hasCurrent) {
      currentData.forEach(function(item) { currentMap[item.Day] = item; });
    }

    const baseMap = {};
    if (hasBase) {
      baseData.forEach(function(item) { baseMap[item.Day] = item; });
    }

    // 【同日数対比ルール】今期データの実績（売上>0 または 客数>0）が存在する最大営業日を特定
    let maxCurActiveDay = 0;
    if (hasCurrent) {
      currentData.forEach(function(item) {
        if ((item['売上'] || 0) > 0 || (item['客数'] || 0) > 0) {
          if (item.Day > maxCurActiveDay) {
            maxCurActiveDay = item.Day;
          }
        }
      });
    }

              // 基準データが存在する場合は、ベースとして基準データの月末(最大日数)までを描画する
      let targetDisplayDays = maxDay;
      if (!hasBase && hasCurrent && maxCurActiveDay > 0) {
        // 基準データが無く今期のみの場合は、今期実績のある日までを描画
        targetDisplayDays = maxCurActiveDay;
      }

    // 曜日対比の可否チェック (双方がdayOfWeekを持つか)
    const canWeekday = mode === 'weekday' && hasCurrent && hasBase &&
      currentData.some(function(d) { return d.dayOfWeek !== null && d.dayOfWeek !== undefined; }) &&
      baseData.some(function(d) { return d.dayOfWeek !== null && d.dayOfWeek !== undefined; });

    const weekdayBaseMap = {};
    if (canWeekday) {
      // 【ユーザー指定の同曜日対比】
      // 「今月2026.09.01(火) に対比させる場合は 2025.09.02(火) に対比させ、一日ずれていくように同曜日で対比」
      // 開始日（Day 1）の曜日と一致する昨年の第1週の同曜日を探し、そのオフセットを維持して1日ずつスライド
      const curFirst = currentMap[1] || currentData[0];
      const curStartDow = (curFirst && curFirst.dayOfWeek !== null && curFirst.dayOfWeek !== undefined) ? curFirst.dayOfWeek : null;

      let baseStartDay = null;
      if (curStartDow !== null) {
        for (let bd = 1; bd <= 7; bd++) {
          const bItem = baseMap[bd];
          if (bItem && bItem.dayOfWeek === curStartDow) {
            baseStartDay = bd;
            break;
          }
        }
      }

      if (baseStartDay !== null && curFirst) {
        const offset = baseStartDay - curFirst.Day; // 例: 2026年9月1日(火) ⇔ 2025年9月2日(火) -> offset = +1
        for (let d = 1; d <= maxDay; d++) {
          const targetBaseDay = d + offset;
          weekdayBaseMap[d] = baseMap[targetBaseDay] || null;
        }
      } else {
        // フォールバック: 第N同曜日マッチング
        const baseByDow = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
        baseData.forEach(function(item) {
          if (item.dayOfWeek !== null && item.dayOfWeek !== undefined) {
            baseByDow[item.dayOfWeek].push(item);
          }
        });
        for (let w = 0; w <= 6; w++) {
          baseByDow[w].sort(function(a, b) { return a.Day - b.Day; });
        }
        const curDowCount = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        for (let d = 1; d <= maxDay; d++) {
          const cItem = currentMap[d];
          if (cItem && cItem.dayOfWeek !== null && cItem.dayOfWeek !== undefined) {
            const dow = cItem.dayOfWeek;
            const idx = curDowCount[dow];
            curDowCount[dow]++;
            weekdayBaseMap[d] = (baseByDow[dow] && baseByDow[dow][idx]) || null;
          } else {
            weekdayBaseMap[d] = baseMap[d] || null;
          }
        }
      }
    }

    const pairs = [];
    for (let d = 1; d <= targetDisplayDays; d++) {
      const curItem = currentMap[d] || null;
      const baseItem = canWeekday ? (weekdayBaseMap[d] || null) : (baseMap[d] || null);

      const curWeekdayStr = curItem && curItem.weekday ? '(' + curItem.weekday + ')' : '';
      const baseWeekdayStr = baseItem && baseItem.weekday ? '(' + baseItem.weekday + ')' : '';

      pairs.push({
        day: d,
        curItem: curItem,
        baseItem: baseItem,
        curLabel: d + '日' + curWeekdayStr,
        baseLabel: baseItem ? baseItem.Day + '日' + baseWeekdayStr : '-'
      });
    }

    return pairs;
  }

  /**
   * 単体または対比の売上データをChart.jsで描画する
   * @param {HTMLCanvasElement} canvasElement
   * @param {Array<{Day: number, 客単価: number, 客数: number, 売上: number}>} currentData - 今期（比較データ）
   * @param {Array<{Day: number, 客単価: number, 客数: number, 売上: number}>} [baseData] - 昨年（基準データ、任意）
   * @param {'date'|'weekday'} [comparisonMode='date'] - 対比方式
   */
  function renderSalesChart(canvasElement, currentData, baseData, comparisonMode) {
    if (!canvasElement || !(canvasElement instanceof HTMLCanvasElement)) {
      throw new Error('有効なCanvas要素が指定されていません。');
    }

    const hasCurrent = Array.isArray(currentData) && currentData.length > 0;
    const hasBase = Array.isArray(baseData) && baseData.length > 0;

    if (!hasCurrent && !hasBase) {
      throw new TypeError('描画対象のデータが存在しません。');
    }

    const mode = comparisonMode === 'weekday' ? 'weekday' : 'date';

    // 既存インスタンスがあれば破棄
    if (currentChartInstance) {
      currentChartInstance.destroy();
      currentChartInstance = null;
    }

    // テーマ判定 (ライトモード / ダークモード)
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';

    // 対比ペアの生成
    const pairs = buildComparisonPairs(currentData, baseData, mode);
    const labels = pairs.map(function(p) {
      if (mode === 'weekday' && p.baseItem) {
        return [p.curLabel, '[昨:' + p.baseLabel + ']'];
      }
      return p.curLabel;
    });

    // カラーパレット定義 (テーマ連動)
    // 今期 (強調・ビビッド)
    const colorSalesCur = isLight ? '#0284c7' : '#38bdf8';
    const colorSalesCurBg = isLight ? 'rgba(2, 132, 199, 0.65)' : 'rgba(56, 189, 248, 0.65)';
    const colorSalesCurHover = isLight ? 'rgba(2, 132, 199, 0.85)' : 'rgba(56, 189, 248, 0.85)';
    const colorCountCur = isLight ? '#059669' : '#34d399';
    const colorPriceCur = isLight ? '#b45309' : '#d4af37';

    // 昨年 (薄色・透過・点線)
    const colorSalesBase = isLight ? 'rgba(100, 116, 139, 0.65)' : 'rgba(148, 163, 184, 0.65)';
    const colorSalesBaseBg = isLight ? 'rgba(100, 116, 139, 0.2)' : 'rgba(148, 163, 184, 0.25)';
    const colorSalesBaseHover = isLight ? 'rgba(100, 116, 139, 0.4)' : 'rgba(148, 163, 184, 0.45)';
    const colorCountBase = isLight ? 'rgba(5, 150, 105, 0.45)' : 'rgba(52, 211, 153, 0.45)';
    const colorPriceBase = isLight ? 'rgba(180, 83, 9, 0.45)' : 'rgba(212, 175, 55, 0.45)';

    // 共通スタイル定義
    const pointBorderColor = isLight ? '#ffffff' : '#070d19';
    const gridColor = isLight ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.06)';
    const tickTextColor = isLight ? '#64748b' : '#94a3b8';
    const legendTextColor = isLight ? '#0f172a' : '#f1f5f9';

    const datasets = [];

    // 1. 売上バー (棒グラフ)
    // 昨年売上
    if (hasBase) {
      const baseSales = pairs.map(function(p) {
        return p.baseItem ? Math.round(p.baseItem['売上'] / 1000) : (hasCurrent ? 0 : null);
      });
      const baseLabelName = mode === 'weekday' ? '昨年同曜日 売上 (千円)' : '昨年 売上 (千円)';
      datasets.push({
        type: 'bar',
        label: hasCurrent ? baseLabelName : '売上 (千円)',
        data: baseSales,
        backgroundColor: colorSalesBaseBg,
        borderColor: colorSalesBase,
        hoverBackgroundColor: colorSalesBaseHover,
        borderWidth: 1,
        borderRadius: 3,
        yAxisID: 'ySales',
        order: 4,
        barPercentage: hasCurrent ? 0.85 : 0.65,
        categoryPercentage: 0.8
      });
    }

    // 今期売上
    if (hasCurrent) {
      const curSales = pairs.map(function(p) {
        return p.curItem ? Math.round(p.curItem['売上'] / 1000) : 0;
      });
      datasets.push({
        type: 'bar',
        label: hasBase ? '今期 売上 (千円)' : '売上 (千円)',
        data: curSales,
        backgroundColor: colorSalesCurBg,
        borderColor: colorSalesCur,
        hoverBackgroundColor: colorSalesCurHover,
        borderWidth: 1.5,
        borderRadius: 4,
        yAxisID: 'ySales',
        order: 3,
        barPercentage: hasBase ? 0.85 : 0.65,
        categoryPercentage: 0.8
      });
    }

    // 2. 客数ライン (折れ線グラフ)
    // 昨年客数 (点線)
    if (hasBase) {
      const baseCounts = pairs.map(function(p) {
        return p.baseItem ? p.baseItem['客数'] : null;
      });
      const baseLabelName = mode === 'weekday' ? '昨年同曜日 客数 (人)' : '昨年 客数 (人)';
      datasets.push({
        type: 'line',
        label: hasCurrent ? baseLabelName : '客数 (人)',
        data: baseCounts,
        borderColor: colorCountBase,
        backgroundColor: colorCountBase,
        borderWidth: 1.5,
        borderDash: [5, 4],
        pointRadius: 2.5,
        pointHoverRadius: 5,
        pointBackgroundColor: colorCountBase,
        pointBorderColor: pointBorderColor,
        pointBorderWidth: 1.5,
        yAxisID: 'yCount',
        order: 5,
        tension: 0.15,
        spanGaps: true
      });
    }

    // 今期客数 (実線)
    if (hasCurrent) {
      const curCounts = pairs.map(function(p) {
        return p.curItem ? p.curItem['客数'] : null;
      });
      datasets.push({
        type: 'line',
        label: hasBase ? '今期 客数 (人)' : '客数 (人)',
        data: curCounts,
        borderColor: colorCountCur,
        backgroundColor: colorCountCur,
        borderWidth: 2.8,
        pointRadius: 4.5,
        pointHoverRadius: 7.5,
        pointBackgroundColor: colorCountCur,
        pointBorderColor: pointBorderColor,
        pointBorderWidth: 2,
        yAxisID: 'yCount',
        order: 2,
        tension: 0.15,
        spanGaps: true
      });
    }

    // 3. 客単価ライン (折れ線グラフ)
    // 昨年客単価 (点線)
    if (hasBase) {
      const basePrices = pairs.map(function(p) {
        return p.baseItem ? p.baseItem['客単価'] : null;
      });
      const baseLabelName = mode === 'weekday' ? '昨年同曜日 客単価 (円)' : '昨年 客単価 (円)';
      datasets.push({
        type: 'line',
        label: hasCurrent ? baseLabelName : '客単価 (円)',
        data: basePrices,
        borderColor: colorPriceBase,
        backgroundColor: colorPriceBase,
        borderWidth: 1.5,
        borderDash: [4, 4],
        pointStyle: 'rectRot',
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: colorPriceBase,
        pointBorderColor: pointBorderColor,
        pointBorderWidth: 1.5,
        yAxisID: 'yPrice',
        order: 6,
        tension: 0.15,
        spanGaps: true
      });
    }

    // 今期客単価 (実線)
    if (hasCurrent) {
      const curPrices = pairs.map(function(p) {
        return p.curItem ? p.curItem['客単価'] : null;
      });
      datasets.push({
        type: 'line',
        label: hasBase ? '今期 客単価 (円)' : '客単価 (円)',
        data: curPrices,
        borderColor: colorPriceCur,
        backgroundColor: colorPriceCur,
        borderWidth: 2.8,
        pointStyle: 'rectRot',
        pointRadius: 5.5,
        pointHoverRadius: 8.5,
        pointBackgroundColor: colorPriceCur,
        pointBorderColor: pointBorderColor,
        pointBorderWidth: 2,
        yAxisID: 'yPrice',
        order: 1,
        tension: 0.15,
        spanGaps: true
      });
    }

    const chartConfig = {
      type: 'bar',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          title: {
            display: false
          },
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              usePointStyle: true,
              boxWidth: 10,
              boxHeight: 10,
              padding: 16,
              font: {
                size: 12,
                family: "'Inter', 'Outfit', sans-serif",
                weight: '500'
              },
              color: legendTextColor
            }
          },
          tooltip: {
            backgroundColor: isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(16, 28, 54, 0.95)',
            titleColor: isLight ? '#0f172a' : '#ffffff',
            bodyColor: isLight ? '#334155' : '#f1f5f9',
            borderColor: isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.12)',
            borderWidth: 1,
            padding: 12,
            boxPadding: 6,
            usePointStyle: true,
            titleFont: { size: 13, weight: 'bold', family: "'Outfit', 'Inter', sans-serif" },
            bodyFont: { size: 12, family: "'Outfit', 'Inter', sans-serif" },
            callbacks: {
              label: function(context) {
                const label = context.dataset.label || '';
                const value = context.parsed.y;
                if (value === null || value === undefined || isNaN(value)) {
                  return null;
                }

                if (label.indexOf('売上') !== -1) {
                  return label + ': ' + Number(value).toLocaleString() + ' 千円';
                } else if (label.indexOf('客数') !== -1) {
                  return label + ': ' + Number(value).toLocaleString() + ' 人';
                } else if (label.indexOf('客単価') !== -1) {
                  return label + ': ' + Number(value).toLocaleString() + ' 円';
                }
                return label + ': ' + value;
              },
              afterBody: function(tooltipItems) {
                if (!hasCurrent || !hasBase || tooltipItems.length === 0) return [];
                const idx = tooltipItems[0].dataIndex;
                const pair = pairs[idx];
                if (!pair || !pair.curItem || !pair.baseItem) return [];

                const curSales = pair.curItem['売上'] || 0;
                const baseSales = pair.baseItem['売上'] || 0;
                const diffSales = curSales - baseSales;
                const ratioSales = baseSales > 0 ? ((curSales / baseSales) * 100).toFixed(1) : '-';

                const lines = ['----------------------------'];
                const sign = diffSales >= 0 ? '+' : '';
                if (mode === 'weekday') {
                  lines.push('対比: 今期 ' + pair.curLabel + ' ⇔ 昨年 ' + pair.baseLabel);
                }
                lines.push('前年比: ' + ratioSales + '% (差: ' + sign + Math.round(diffSales / 1000).toLocaleString() + ' 千円)');
                return lines;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false
            },
            ticks: {
              font: { size: 11, family: "'Outfit', 'Inter', sans-serif" },
              color: tickTextColor
            },
            title: {
              display: true,
              text: '日付 (日)',
              font: { size: 12, weight: '600' },
              color: tickTextColor
            }
          },
          // 左側Y軸: 売上 (千円)
          ySales: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
            title: {
              display: true,
              text: '売上 (千円)',
              color: colorSalesCur,
              font: { size: 12, weight: '600' }
            },
            ticks: {
              color: colorSalesCur,
              font: { family: "'Outfit', sans-serif" },
              callback: function(val) {
                return Number(val).toLocaleString();
              }
            },
            grid: {
              color: gridColor,
              borderDash: [3, 3]
            }
          },
          // 右側第1Y軸: 客数 (人)
          yCount: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            title: {
              display: true,
              text: '客数 (人)',
              color: colorCountCur,
              font: { size: 12, weight: '600' }
            },
            ticks: {
              color: colorCountCur,
              font: { family: "'Outfit', sans-serif" },
              callback: function(val) {
                return Number(val).toLocaleString();
              }
            },
            grid: {
              drawOnChartArea: false
            }
          },
          // 右側第2Y軸: 客単価 (円)
          yPrice: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            title: {
              display: true,
              text: '客単価 (円)',
              color: colorPriceCur,
              font: { size: 12, weight: '600' }
            },
            ticks: {
              color: colorPriceCur,
              font: { family: "'Outfit', sans-serif" },
              callback: function(val) {
                return Number(val).toLocaleString();
              }
            },
            grid: {
              drawOnChartArea: false
            }
          }
        }
      }
    };

    currentChartInstance = new global.Chart(canvasElement, chartConfig);
    return currentChartInstance;
  }

  /**
   * 現在のグラフをテーマに合わせた高解像度PNG画像としてダウンロードする
   * @param {string} fileName
   */
  function exportChartImage(fileName) {
    if (!currentChartInstance) {
      throw new Error('エクスポート対象のグラフが存在しません。');
    }

    const defaultName = fileName || 'sales_chart_' + new Date().toISOString().slice(0, 10) + '.png';
    const originalCanvas = currentChartInstance.canvas;
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';

    // 背景を適用して高画質出力用の一時Canvasを作成
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = originalCanvas.width;
    exportCanvas.height = originalCanvas.height;
    const ctx = exportCanvas.getContext('2d');
    
    // テーマに沿った背景色で塗りつぶし (ダーク: #070d19, ライト: #ffffff)
    ctx.fillStyle = isLight ? '#ffffff' : '#070d19';
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    ctx.drawImage(originalCanvas, 0, 0);

    exportCanvas.toBlob(function(blob) {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = defaultName;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(url);
    }, 'image/png', 1.0);
  }

  /**
   * 現在のグラフインスタンスを破棄する
   */
  function destroyChart() {
    if (currentChartInstance) {
      currentChartInstance.destroy();
      currentChartInstance = null;
    }
  }

  global.SalesChart = {
    render: renderSalesChart,
    exportImage: exportChartImage,
    destroy: destroyChart,
    buildComparisonPairs: buildComparisonPairs
  };
})(window);
