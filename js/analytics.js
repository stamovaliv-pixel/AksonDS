document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  
  // Устанавливаем период по умолчанию (-30 дней и сегодня)
  const todayDate = new Date();
  const dFrom = new Date(); dFrom.setDate(todayDate.getDate() - 30);
  const dTo = new Date(); 
  
  document.getElementById('dateFrom').value = dFrom.toISOString().split('T')[0];
  document.getElementById('dateTo').value = dTo.toISOString().split('T')[0];

  document.getElementById('logoutBtn').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); window.location.href = '../index.html'; };

  let chartInstances = {};
  window.csvDataCache = {}; 

  // ОПТИМИЗАЦИЯ 1: Кэширование настроек (Session Storage)
  async function getSettings() {
    const cached = sessionStorage.getItem('app_settings');
    if (cached) return JSON.parse(cached);
    const { data } = await sb.from('app_settings').select('supply_types').eq('id', 1).single();
    if (data) sessionStorage.setItem('app_settings', JSON.stringify(data));
    return data || {};
  }

  // Загружаем типы поставок для фильтра
  const loadSupplyTypes = async () => {
    const settings = await getSettings();
    const select = document.getElementById('filterSupplyType');
    if (settings.supply_types) {
      settings.supply_types.forEach(st => {
        // Не интерпретируем название типа поставки как HTML (защита от stored XSS).
        const option = document.createElement('option');
        option.value = String(st?.id ?? '');
        option.textContent = String(st?.name ?? '');
        select.appendChild(option);
      });
    }
  };
  await loadSupplyTypes();

  // ОПТИМИЗАЦИЯ 2: Локальный кэш данных за период
  let cachedBookings = null;
  let lastFetchDates = { from: '', to: '' };

  const loadAnalytics = async () => {
    const from = document.getElementById('dateFrom').value;
    const to = document.getElementById('dateTo').value;
    const supplierFilter = document.getElementById('filterSupplier').value.trim().toLowerCase();
    const supplyFilter = document.getElementById('filterSupplyType').value;
    const threshold = parseInt(document.getElementById('lateThreshold').value) || 30;
    
    document.getElementById('lblThreshold').innerText = threshold;

    const btn = document.getElementById('btnUpdateData');
    btn.innerText = 'Загрузка...';
    btn.disabled = true;

    // Запрашиваем БД ТОЛЬКО если изменился период дат (чтобы экономить ресурсы Supabase)
    if (!cachedBookings || lastFetchDates.from !== from || lastFetchDates.to !== to) {
      // ОПТИМИЗАЦИЯ 3: Выборка только нужных колонок
      const { data } = await sb.from('bookings')
        .select('id, created_at, slot_date, slot_hour, arrival_time, departure_time, gate_number, status, supply_type, supply_types, profiles!inner(company_name, inn)')
        .gte('slot_date', from).lte('slot_date', to).eq('status', 'active');
      
      cachedBookings = data || [];
      lastFetchDates = { from, to };
    }

    btn.innerText = 'Сформировать';
    btn.disabled = false;

    // Локальная фильтрация кэшированных данных
    const filteredBookings = cachedBookings.filter(b => {
      // Фильтр по поставщику
      if (supplierFilter) {
        const compName = (b.profiles?.company_name || '').toLowerCase();
        const inn = (b.profiles?.inn || '').toLowerCase();
        if (!compName.includes(supplierFilter) && !inn.includes(supplierFilter)) return false;
      }
      // Фильтр по типу поставки
      if (supplyFilter) {
        const types = b.supply_types?.length ? b.supply_types : [b.supply_type];
        if (!types.includes(supplyFilter)) return false;
      }
      return true;
    });

    const stats = {};
    const now = new Date();
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    // Агрегация данных
    filteredBookings.forEach(b => {
      const comp = b.profiles?.company_name || 'Неизвестно';
      if (!stats[comp]) {
        stats[comp] = { total: 0, late: 0, noshow: 0, lateRecords: [], noshowRecords: [] };
      }

      // Рассматриваем только наступившие заявки
      const slotD = new Date(b.slot_date);
      slotD.setHours(0,0,0,0);
      
      const isPast = slotD < todayMidnight || (slotD.getTime() === todayMidnight.getTime() && now.getHours() > b.slot_hour);
      if (!isPast) return; // Будущие слоты пропускаем
      
      stats[comp].total++;

      if (b.arrival_time) {
        const [h, m] = b.arrival_time.split(':').map(Number);
        const arrivalMinutes = h * 60 + m;
        const slotMinutes = b.slot_hour * 60;
        if (arrivalMinutes - slotMinutes > threshold) {
          stats[comp].late++;
          stats[comp].lateRecords.push(b);
        }
      } else {
        // Нет отметки о прибытии в прошедшем слоте
        stats[comp].noshow++;
        stats[comp].noshowRecords.push(b);
      }
    });

    // Формирование массивов для графиков
    let ratingData = [];
    let lateData = [];
    let noshowData = [];

    for (const [comp, s] of Object.entries(stats)) {
      if (s.total === 0) continue;

      const penaltyWeight = (s.noshow * (2/3)) + (s.late * (1/3));
      let rating = 5.0 * (1 - (penaltyWeight / s.total));
      rating = Math.max(0.1, Math.min(5.0, rating));
      rating = parseFloat((Math.round(rating * 10) / 10).toFixed(1));

      const lateRate = parseFloat(((s.late / s.total) * 100).toFixed(1));
      const noshowRate = parseFloat(((s.noshow / s.total) * 100).toFixed(1));

      ratingData.push({ comp, value: rating, meta: s });
      
      if (s.late > 0) lateData.push({ comp, value: lateRate, meta: s });
      if (s.noshow > 0) noshowData.push({ comp, value: noshowRate, meta: s });
    }

    // Сортировка от большего к меньшему
    ratingData.sort((a, b) => b.value - a.value);
    lateData.sort((a, b) => b.value - a.value);
    noshowData.sort((a, b) => b.value - a.value);

    // Сохраняем в кэш для CSV выгрузки
    window.csvDataCache = { rating: ratingData, late: lateData, noshow: noshowData };

    // Отрисовка графиков
    drawChart('chartRating', ratingData, '#3b82f6', 'rating');
    drawChart('chartLate', lateData, '#f59e0b', 'rate_late');
    drawChart('chartNoShow', noshowData, '#ef4444', 'rate_noshow');
  };

  const drawChart = (canvasId, dataArray, color, type) => {
    const ctx = document.getElementById(canvasId).getContext('2d');
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    const labels = dataArray.map(item => item.comp);
    const data = dataArray.map(item => item.value);

    // Фон графика следует активной теме, в том числе при скачивании PNG.
    const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark';
    const axisTextColor = isDarkTheme ? '#cbd5e1' : '#666666';
    const gridLineColor = isDarkTheme ? 'rgba(148, 163, 184, 0.18)' : 'rgba(0, 0, 0, 0.1)';
    const customCanvasBackgroundColor = {
      id: 'customCanvasBackgroundColor',
      beforeDraw: (chart) => {
        const {ctx} = chart;
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = document.documentElement.getAttribute('data-theme') === 'dark' ? '#18212b' : '#ffffff';
        ctx.fillRect(0, 0, chart.width, chart.height);
        ctx.restore();
      }
    };

    chartInstances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['Нет данных'],
        datasets: [{
          label: 'Значение',
          data: data.length ? data : [0],
          backgroundColor: color,
          borderRadius: 4
        }]
      },
      plugins: [customCanvasBackgroundColor],
      options: { 
        responsive: true, 
        maintainAspectRatio: false, 
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                if (dataArray.length === 0) return '';
                const idx = context.dataIndex;
                const meta = dataArray[idx].meta;
                
                if (type === 'rating') {
                  return `Рейтинг: ${context.raw} (Записей: ${meta.total}, Опозданий: ${meta.late}, Срывов: ${meta.noshow})`;
                } else if (type === 'rate_late') {
                  return `Опозданий: ${meta.late} из ${meta.total} (${context.raw}%)`;
                } else {
                  return `Срывов: ${meta.noshow} из ${meta.total} (${context.raw}%)`;
                }
              }
            }
          }
        },
        scales: { 
          x: {
            ticks: { color: axisTextColor },
            grid: { color: gridLineColor },
            border: { color: gridLineColor }
          },
          y: { 
            beginAtZero: true, 
            max: type === 'rating' ? 5.0 : undefined,
            ticks: { color: axisTextColor },
            grid: { color: gridLineColor },
            border: { color: gridLineColor }
          } 
        } 
      }
    });
  };

  document.getElementById('btnUpdateData').onclick = loadAnalytics;
  loadAnalytics(); // Первичная загрузка
});

// Скачивание графика в PNG
window.downloadChartImage = function(canvasId, filename) {
  const chart = Chart.getChart(canvasId);
  if (!chart) return;
  const a = document.createElement('a');
  a.href = chart.toBase64Image();
  a.download = `${filename}_${new Date().toISOString().split('T')[0]}.png`;
  a.click();
};

// Безопасное формирование CSV: корректное экранирование разделителей и нейтрализация
// значений, которые табличные редакторы могут интерпретировать как формулы.
function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(values) {
  return values.map(csvCell).join(';') + '\r\n';
}

// Экспорт CSV
window.downloadCSV = function(type) {
  const cache = window.csvDataCache[type];
  if (!cache || cache.length === 0) return alert('Нет данных для скачивания');
  const rows = [];

  const formatDateTime = (isoString) => {
    if (!isoString) return '';
    const d = new Date(isoString);
    return `${d.toLocaleDateString('ru-RU')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  if (type === 'rating') {
    rows.push(csvRow(['Поставщик', 'Рейтинг']).trimEnd());
    cache.forEach(row => rows.push(csvRow([row.comp, row.value]).trimEnd()));
  }
  else if (type === 'late') {
    rows.push(csvRow(['Дата создания записи', 'Поставщик', 'ID записи с опозданием', 'Дата записи', 'Время записи', 'Время прибытия', 'Время убытия', 'Номер ворот']).trimEnd());
    cache.forEach(row => {
      (row.meta?.lateRecords || []).forEach(b => {
        const created = formatDateTime(b.created_at);
        const slotDate = new Date(b.slot_date).toLocaleDateString('ru-RU');
        const slotTime = `${b.slot_hour}:00-${b.slot_hour + 1}:00`;
        const arrTime = b.arrival_time ? b.arrival_time.substring(0, 5) : '';
        const depTime = b.departure_time ? b.departure_time.substring(0, 5) : '';
        rows.push(csvRow([created, row.comp, b.id, slotDate, slotTime, arrTime, depTime, b.gate_number || '']).trimEnd());
      });
    });
  }
  else if (type === 'noshow') {
    rows.push(csvRow(['Дата создания записи', 'Поставщик', 'ID записи со срывом', 'Дата записи', 'Время записи']).trimEnd());
    cache.forEach(row => {
      (row.meta?.noshowRecords || []).forEach(b => {
        const created = formatDateTime(b.created_at);
        const slotDate = new Date(b.slot_date).toLocaleDateString('ru-RU');
        const slotTime = `${b.slot_hour}:00-${b.slot_hour + 1}:00`;
        rows.push(csvRow([created, row.comp, b.id, slotDate, slotTime]).trimEnd());
      });
    });
  }

  if (!rows.length) return alert('Нет данных для скачивания');
  const csvContent = rows.join('\r\n') + '\r\n';
  // BOM нужен Excel для корректного отображения кириллицы.
  const blob = new Blob(["\ufeff", csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `report_${type}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
