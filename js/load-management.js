document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const $ = (id) => document.getElementById(id);
  if (!sb) return;

  const auth = await window.dockslotGetAuthProfile?.();
  const user = auth?.user;
  const profile = auth?.profile;
  const role = String(profile?.role || '').toLowerCase();
  if (!user || auth?.error || profile?.is_blocked || !['super_admin', 'operator'].includes(role)) {
    window.location.replace('admin_calendar.html');
    return;
  }

  const isAdmin = role === 'super_admin';
  const modeSwitch = $('modeSwitch');
  const daysList = $('daysList');
  const emptyState = $('emptyState');
  const planFooter = $('planFooter');
  let control = null;
  let currentRunId = null;
  let currentRunStatus = null;
  let toastTimer = null;
  let maxMainHourly = 5; let maxReserveHourly = 3;
  let maxMainDaily = 40; let maxReserveDaily = 24;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const dateLabel = (value) => new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', weekday: 'short', day: 'numeric', month: 'long'
  }).format(new Date(`${value}T12:00:00Z`));
  const showToast = (message, isError = false) => {
    const node = $('loadToast');
    node.textContent = message;
    node.classList.toggle('is-error', isError);
    node.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('is-visible'), 3600);
  };
  const setBusy = (busy) => {
    ['recalculateBtn', 'emptyCalculateBtn', 'approveBtn'].forEach((id) => {
      const node = $(id);
      if (!node) return;
      if (busy) node.disabled = true;
      else if (id === 'approveBtn') node.disabled = currentRunStatus !== 'draft';
      else node.disabled = false;
    });
  };
  const rpc = async (name, args = {}) => {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  };

  function renderMode() {
    const enabled = Boolean(control?.enabled);
    modeSwitch.checked = enabled;
    modeSwitch.disabled = !isAdmin;
    $('modeTitle').textContent = enabled ? 'Алгоритм включён' : 'Алгоритм выключен';
    $('modeDescription').textContent = enabled
      ? 'Для дат с утверждённым планом действуют дневные и почасовые лимиты.'
      : 'Работает текущая схема основных и резервных слотов.';
    $('modeNote').textContent = isAdmin
      ? (enabled
        ? 'Новые записи проверяются по утверждённому плану. Выключение немедленно возвращает текущую схему лимитов.'
        : 'Алгоритм не влияет на запись. Сначала рассчитай и подтверди план, затем включи переключатель.')
      : (enabled
        ? 'Динамический режим включён абсолютным администратором. Ты можешь пересчитать и подтвердить следующий план.'
        : 'Динамический режим выключен абсолютным администратором. До его включения действует текущая схема лимитов.');
    $('modeSwitchWrap').classList.toggle('is-locked', !isAdmin);
  }

  function renderPlan(days, hours) {
    daysList.replaceChildren();
    if (!days?.length) { emptyState.hidden=false; daysList.hidden=true; planFooter.hidden=true; $('planMeta').textContent='Для выбранного периода нет рабочих дат или расчёт ещё не создан.'; return; }
    emptyState.hidden=true; daysList.hidden=false; planFooter.hidden=currentRunStatus!=='draft';
    $('planMeta').textContent=`${days.length} рабочих дат · отдельно основные места и резерв только для заказов ИМ`;
    const byDate=new Map(); (hours||[]).forEach(h=>{if(!byDate.has(h.slot_date))byDate.set(h.slot_date,[]);byDate.get(h.slot_date).push(h);});
    days.forEach(day=>{
      const card=document.createElement('article'); card.className='load-day-card';
      const head=document.createElement('div'); head.className='load-day-heading';
      const copy=document.createElement('div'); copy.className='load-day-copy';
      copy.innerHTML=`<strong>${escapeHtml(dateLabel(day.slot_date))}</strong><span>Прогноз: основные ${Number(day.main_forecast_count)} · ИМ ${Number(day.reserve_forecast_count)} | Записано: основные ${Number(day.main_current_count)} · ИМ ${Number(day.reserve_current_count)}</span>`;
      const controls=document.createElement('div'); controls.className='load-day-dual-limits';
      controls.innerHTML=`<label class="load-daily-limit"><span>Основные / день</span><input type="number" min="0" max="${maxMainDaily}" value="${Number(day.main_daily_limit)}" data-daily-date="${escapeHtml(day.slot_date)}" data-stream="main"><small>Рек. ${Number(day.recommended_main_daily_limit)}</small></label><label class="load-daily-limit"><span>Резерв ИМ / день</span><input type="number" min="0" max="${maxReserveDaily}" value="${Number(day.reserve_daily_limit)}" data-daily-date="${escapeHtml(day.slot_date)}" data-stream="reserve"><small>Рек. ${Number(day.recommended_reserve_daily_limit)}</small></label>`;
      head.append(copy,controls); card.append(head);
      const rows=document.createElement('div'); rows.className='load-hour-grid';
      (byDate.get(day.slot_date)||[]).forEach(h=>{
        const row=document.createElement('div'); row.className='load-hour-row load-hour-row-dual';
        row.innerHTML=`<span class="load-hour-time">${String(h.slot_hour).padStart(2,'0')}:00</span><span class="load-hour-forecast">Основные: ${Number(h.main_current_count)} / прогноз ${Number(h.main_forecast_count)}<br>ИМ: ${Number(h.reserve_current_count)} / прогноз ${Number(h.reserve_forecast_count)}</span><label class="load-hour-limit"><span>Основные (макс. ${maxMainHourly})</span><input type="number" min="0" max="${maxMainHourly}" value="${Number(h.main_hourly_limit)}" data-hour-date="${escapeHtml(h.slot_date)}" data-hour="${Number(h.slot_hour)}" data-stream="main"></label><label class="load-hour-limit"><span>Резерв ИМ (макс. ${maxReserveHourly})</span><input type="number" min="0" max="${maxReserveHourly}" value="${Number(h.reserve_hourly_limit)}" data-hour-date="${escapeHtml(h.slot_date)}" data-hour="${Number(h.slot_hour)}" data-stream="reserve"></label>`;
        rows.append(row);
      }); card.append(rows); daysList.append(card);
    });
    $('approvalState').textContent=currentRunStatus==='approved'?'Этот план уже подтверждён':'Проверь предложенные значения';
    $('approveBtn').textContent=currentRunStatus==='approved'?'План подтверждён':'Подтвердить план'; $('approveBtn').disabled=currentRunStatus!=='draft';
  }

  async function loadPlan(runId, status) {
    currentRunId = runId;
    currentRunStatus = status;
    const [{ data: days, error: dayError }, { data: hours, error: hourError }] = await Promise.all([
      sb.from('load_forecast_days').select('slot_date,forecast_count,current_count,recommended_daily_limit,daily_limit,source_days_count,main_forecast_count,reserve_forecast_count,main_current_count,reserve_current_count,recommended_main_daily_limit,main_daily_limit,recommended_reserve_daily_limit,reserve_daily_limit').eq('run_id', runId).order('slot_date'),
      sb.from('load_forecast_hours').select('slot_date,slot_hour,forecast_count,current_count,recommended_hourly_limit,hourly_limit,source_days_count,main_forecast_count,reserve_forecast_count,main_current_count,reserve_current_count,recommended_main_hourly_limit,main_hourly_limit,recommended_reserve_hourly_limit,reserve_hourly_limit').eq('run_id', runId).order('slot_date').order('slot_hour')
    ]);
    if (dayError) throw dayError;
    if (hourError) throw hourError;
    renderPlan(days || [], hours || []);
  }

  async function loadHistory() {
    const [{ data: runs, error: runsError }, { data: events, error: eventsError }] = await Promise.all([
      sb.from('load_forecast_runs').select('id,created_at,status,lookback_weeks,forecast_days,approved_at').order('created_at', { ascending: false }).limit(6),
      sb.from('load_control_audit').select('event_type,created_at,run_id').order('created_at', { ascending: false }).limit(8)
    ]);
    if (runsError) throw runsError;
    if (eventsError) throw eventsError;
    const history = $('historyList');
    history.replaceChildren();
    const labels = {
      forecast_generated: 'Выполнен автоматический расчёт',
      plan_approved: 'План подтверждён',
      algorithm_enabled: 'Динамический алгоритм включён',
      algorithm_disabled: 'Динамический алгоритм выключен'
    };
    const rows = (events || []).map((event) => ({
      label: labels[event.event_type] || 'Изменение управления нагрузкой',
      at: event.created_at,
      runId: event.run_id
    }));
    if (!rows.length && runs?.length) {
      runs.forEach((run) => rows.push({ label: run.status === 'approved' ? 'План подтверждён' : 'Расчёт сформирован', at: run.approved_at || run.created_at, runId: run.id }));
    }
    if (!rows.length) {
      history.textContent = 'История пока пуста.';
      return;
    }
    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'load-history-item';
      const label = document.createElement('strong');
      label.textContent = row.label;
      const time = document.createElement('time');
      time.textContent = new Date(row.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' });
      item.append(label, time);
      history.append(item);
    });
  }

  async function loadState() {
    const [{ data: settings, error: settingsError }, { data: runs, error: runsError }, { data: capacity, error: capacityError }] = await Promise.all([
      sb.from('load_control_settings').select('enabled,lookback_weeks,forecast_days,active_run_id,updated_at').eq('id', true).single(),
      sb.from('load_forecast_runs').select('id,status,created_at').order('created_at', { ascending: false }).limit(10),
      sb.from('app_settings').select('slots_per_hour,reserve_slots_per_hour,slot_start_hour,slot_end_hour').eq('id', 1).single()
    ]);
    if (settingsError) throw settingsError;
    if (runsError) throw runsError;
    if (capacityError) throw capacityError;
    maxMainHourly=Number(capacity?.slots_per_hour||0); maxReserveHourly=Number(capacity?.reserve_slots_per_hour||0);
    const hoursCount=Math.max(1,Number(capacity?.slot_end_hour||16)-Number(capacity?.slot_start_hour||9)+1);
    maxMainDaily=maxMainHourly*hoursCount; maxReserveDaily=maxReserveHourly*hoursCount;
    control = settings;
    renderMode();
    const draft = (runs || []).find((run) => run.status === 'draft');
    const active = (runs || []).find((run) => run.id === settings.active_run_id && run.status === 'approved');
    const chosen = draft || active;
    if (chosen) await loadPlan(chosen.id, chosen.status);
    else renderPlan([], []);
    await loadHistory();
    const status = $('planStatus');
    status.classList.toggle('is-enabled', Boolean(control.enabled));
    status.querySelector('span:last-child').textContent = control.enabled ? 'Динамический режим включён' : 'Работает текущая схема';
  }

  async function recalculate() {
    setBusy(true);
    try {
      const runId = await rpc('generate_dynamic_load_forecast');
      if (!runId) throw new Error('Сервер не вернул идентификатор расчёта.');
      await loadPlan(runId, 'draft');
      await loadHistory();
      showToast('Расчёт готов. Проверь лимиты и подтверди план.');
    } catch (error) {
      console.error('Dynamic load forecast:', error);
      showToast(error.message || 'Не удалось рассчитать нагрузку.', true);
    } finally { setBusy(false); }
  }

  async function approvePlan() {
    if (!currentRunId || currentRunStatus !== 'draft') return;
    const dailyMap = new Map();
    [...daysList.querySelectorAll('[data-daily-date]')].forEach(input => {
      const row=dailyMap.get(input.dataset.dailyDate)||{slot_date:input.dataset.dailyDate};
      row[input.dataset.stream==='main'?'main_daily_limit':'reserve_daily_limit']=Number(input.value); dailyMap.set(input.dataset.dailyDate,row);
    });
    const hourMap = new Map();
    [...daysList.querySelectorAll('[data-hour-date]')].forEach(input => {
      const key=`${input.dataset.hourDate}|${input.dataset.hour}`;
      const row=hourMap.get(key)||{slot_date:input.dataset.hourDate,slot_hour:Number(input.dataset.hour)};
      row[input.dataset.stream==='main'?'main_hourly_limit':'reserve_hourly_limit']=Number(input.value); hourMap.set(key,row);
    });
    const dailyOverrides=[...dailyMap.values()]; const hourlyOverrides=[...hourMap.values()];
    const hasEmptyInput = [...daysList.querySelectorAll('input[type="number"]')].some((input) => input.value.trim() === '' || !Number.isFinite(Number(input.value)));
    if (hasEmptyInput || [...dailyOverrides, ...hourlyOverrides].some((item) => Object.values(item).some((value) => value === null || Number.isNaN(value)))) {
      showToast('Проверь числовые значения лимитов.', true);
      return;
    }
    setBusy(true);
    try {
      await rpc('approve_dynamic_load_plan', {
        p_run_id: currentRunId,
        p_daily_overrides: dailyOverrides,
        p_hourly_overrides: hourlyOverrides
      });
      const wasEnabled = Boolean(control?.enabled);
      await loadState();
      showToast(wasEnabled
        ? 'План подтверждён и сразу стал активным.'
        : 'План подтверждён. Он начнёт действовать после включения алгоритма абсолютным администратором.');
    } catch (error) {
      console.error('Approve dynamic load plan:', error);
      showToast(error.message || 'Не удалось подтвердить план.', true);
    } finally { setBusy(false); }
  }

  async function toggleMode() {
    if (!isAdmin) return;
    const requested = modeSwitch.checked;
    modeSwitch.disabled = true;
    try {
      await rpc('set_dynamic_load_enabled', { p_enabled: requested });
      control.enabled = requested;
      renderMode();
      $('planStatus').classList.toggle('is-enabled', requested);
      $('planStatus').querySelector('span:last-child').textContent = requested ? 'Динамический режим включён' : 'Работает текущая схема';
      showToast(requested ? 'Динамические лимиты включены.' : 'Возвращена текущая схема лимитов.');
      await loadHistory();
    } catch (error) {
      modeSwitch.checked = Boolean(control?.enabled);
      showToast(error.message || 'Не удалось изменить режим.', true);
    } finally { modeSwitch.disabled = !isAdmin; }
  }

  $('recalculateBtn').addEventListener('click', recalculate);
  $('emptyCalculateBtn').addEventListener('click', recalculate);
  $('approveBtn').addEventListener('click', approvePlan);
  modeSwitch.addEventListener('change', toggleMode);
  $('logoutBtn').addEventListener('click', async (event) => {
    event.preventDefault();
    await sb.auth.signOut();
    window.location.replace('../index.html');
  });

  try { await loadState(); }
  catch (error) {
    console.error('Load management initialization:', error);
    showToast(error.message || 'Не удалось загрузить управление нагрузкой.', true);
    $('planMeta').textContent = 'Проверь, что SQL-миграция dynamic_load_management_v1.sql выполнена в Supabase.';
  }
});
