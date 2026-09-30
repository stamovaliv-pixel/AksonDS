document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  
  // Устанавливаем период по умолчанию (-30 и +30 дней)
  const today = new Date();
  const dFrom = new Date(); dFrom.setDate(today.getDate() - 30);
  const dTo = new Date(); dTo.setDate(today.getDate() + 30);
  
  document.getElementById('dateFrom').value = dFrom.toISOString().split('T')[0];
  document.getElementById('dateTo').value = dTo.toISOString().split('T')[0];

  document.getElementById('logoutBtn').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); window.location.href = '../index.html'; };

  let chartInstances = {};
  window.csvDataCache = {}; 

  const loadAnalytics = async () => {
    const from = document.getElementById('dateFrom').value;
    const to = document.getElementById('dateTo').value;
    const supplier = document.getElementById('filterSupplier').value.trim();
    const threshold = parseInt(document.getElementById('lateThreshold').value) || 30;
    
    document.getElementById('lblThreshold').innerText = threshold;

    let query = sb.from('bookings').select('slot_date, slot_hour, arrival_time, status, profiles!inner(company_name, inn)')
      .gte('slot_date', from).lte('slot_date', to).eq('status', 'active');
    
    if (supplier) {
      query = query.or(`company_name.ilike.%${supplier}%,inn.ilike.%${supplier}%`, { foreignTable: 'profiles' });
    }

    const { data: bookings } = await query;
    if (!bookings) return;

    const counts = { total: {}, late: {}, noshow: {} };
    const now = new Date();

    bookings.forEach(b => {
      const comp = b.profiles?.company_name || 'Неизвестно';
      counts.total[comp] = (counts.total[comp] || 0) + 1;

      // Логика подсчета опозданий
      if (b.arrival_time) {
        const [h, m] = b.arrival_time.split(':').map(Number);
        const arrivalMinutes = h * 60 + m;
        const slotMinutes = b.slot_hour * 60;
        if (arrivalMinutes - slotMinutes > threshold) {
          counts.late[comp] = (counts.late[comp] || 0) + 1;
        }
      } 
      // Логика срывов (слот уже в прошлом, но отметки прибытия нет)
      else {
        const slotD = new Date(b.slot_date);
        if (slotD < today || (slotD.toDateString() === today.toDateString() && now.getHours() > b.slot_hour)) {
          counts.noshow[comp] = (counts.noshow[comp] || 0) + 1;
        }
      }
    });

    drawChart('chartTotal', 'totalBookings', 'Записи', counts.total, '#3b82f6');
    drawChart('chartLate', 'lateBookings', 'Опоздания', counts.late, '#f59e0b');
    drawChart('chartNoShow', 'noshowBookings', 'Срывы', counts.noshow, '#ef4444');
  };

  const drawChart = (canvasId, cacheKey, label, dataObj, color) => {
    const ctx = document.getElementById(canvasId).getContext('2d');
    if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

    const labels = Object.keys(dataObj);
    const data = Object.values(dataObj);

    // Сохраняем в память для экспорта CSV
    window.csvDataCache[cacheKey] = { labels, data, title: label };

    chartInstances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['Нет данных'],
        datasets: [{
          label: label,
          data: data.length ? data : [0],
          backgroundColor: color,
          borderRadius: 4
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
  };

  document.getElementById('btnUpdateData').onclick = loadAnalytics;
  loadAnalytics();
});

// Функция скачивания CSV
window.downloadCSV = function(cacheKey) {
  const cache = window.csvDataCache[cacheKey];
  if (!cache || cache.labels.length === 0) return alert('Нет данных для скачивания');
  
  let csvContent = "Поставщик;Количество\n";
  for (let i = 0; i < cache.labels.length; i++) {
    csvContent += `"${cache.labels[i]}";${cache.data[i]}\n`;
  }
  
  // Добавляем BOM для правильной кодировки кириллицы в Excel
  const blob = new Blob(["\ufeff", csvContent], { type: 'text/csv;charset=utf-8;' }); 
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `report_${cacheKey}_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};