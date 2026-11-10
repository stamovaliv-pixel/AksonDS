document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

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

  const isSuperAdmin = role === 'super_admin';
  const modeSwitch = $('modeSwitch');
  modeSwitch.disabled = true; // enabled only after role and saved state are confirmed
  const form = $('advisorySettingsForm');
  const settingFields = [
    'algorithm', 'lookbackWeeks', 'forecastDays', 'favorableThreshold', 'denseThreshold',
    'weeklyConcentrationThreshold', 'favorableLabel', 'normalLabel', 'denseLabel', 'displayMode',
    'refreshMode', 'visualIconOnly', 'visualFill', 'visualGradient', 'visualPulse', 'visualPageCorner'
  ];
  let settings = null;
  let toastTimer = null;
  let previewBusy = false;

  const showToast = (message, isError = false) => {
    const node = $('loadToast');
    node.textContent = message;
    node.classList.toggle('is-error', isError);
    node.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => node.classList.remove('is-visible'), 3600);
  };

  const businessTodayISO = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };

  const shiftIsoDate = (iso, days) => {
    const [year, month, day] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  };

  const dateLabel = (iso) => {
    const [year, month, day] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })
      .format(new Date(Date.UTC(year, month - 1, day, 12)));
  };

  const setBusy = (busy) => {
    $('saveSettingsBtn').disabled = busy;
    $('refreshPreviewBtn').disabled = busy || previewBusy;
    settingFields.forEach((id) => { $(id).disabled = busy; });
    modeSwitch.disabled = busy || !isSuperAdmin;
  };

  const renderMode = () => {
    const enabled = Boolean(settings?.enabled);
    modeSwitch.checked = enabled;
    modeSwitch.disabled = !isSuperAdmin;
    $('modeTitle').textContent = enabled ? 'Рекомендации включены' : 'Рекомендации выключены';
    $('modeDescription').textContent = enabled
      ? 'Цветовые и текстовые индикаторы загруженности отображаются в календарях.'
      : 'Индикаторы загруженности скрыты. Все штатные правила записи продолжают работать.';
    $('modeNote').textContent = isSuperAdmin
      ? 'Переключатель управляет только визуальными рекомендациями и не меняет вместимость слотов.'
      : 'У оператора нет права включать или выключать систему. Глобальное состояние задаёт суперадминистратор.';
    $('modeSwitchWrap').classList.toggle('is-locked', !isSuperAdmin);
    $('advisoryStatus').classList.toggle('is-enabled', enabled);
    $('advisoryStatus').querySelector('span:last-child').textContent = enabled ? 'Визуализация включена' : 'Визуализация выключена';
  };

  const populateForm = (row) => {
    $('algorithm').value = row.algorithm || 'combined';
    $('lookbackWeeks').value = String(row.lookback_weeks || 8);
    $('forecastDays').value = String(row.forecast_days || 14);
    $('favorableThreshold').value = String(row.favorable_threshold ?? 50);
    $('denseThreshold').value = String(row.dense_threshold ?? 80);
    $('weeklyConcentrationThreshold').value = String(row.weekly_concentration_threshold ?? 30);
    $('favorableLabel').value = row.favorable_label || 'Благоприятно';
    $('normalLabel').value = row.normal_label || 'Штатно';
    $('denseLabel').value = row.dense_label || 'Плотно';
    $('displayMode').value = row.display_mode || 'calendar_detail';
    $('refreshMode').value = row.refresh_mode || 'poll_3m';
    $('visualIconOnly').checked = Boolean(row.visual_icon_only);
    $('visualFill').checked = Boolean(row.visual_fill);
    $('visualGradient').checked = Boolean(row.visual_gradient);
    $('visualPulse').checked = Boolean(row.visual_pulse);
    $('visualPageCorner').checked = Boolean(row.visual_page_corner);
    syncVisualOptions();
  };

  const syncVisualOptions = () => {
    const iconOnly = $('visualIconOnly').checked;
    ['visualFill', 'visualGradient', 'visualPulse', 'visualPageCorner'].forEach((id) => {
      $(id).disabled = iconOnly;
      $(id).closest('.load-check-option')?.classList.toggle('is-disabled', iconOnly);
      if (iconOnly) $(id).checked = false;
    });
  };

  const collectSettings = () => ({
    algorithm: $('algorithm').value,
    lookback_weeks: Number($('lookbackWeeks').value),
    forecast_days: Number($('forecastDays').value),
    favorable_threshold: Number($('favorableThreshold').value),
    dense_threshold: Number($('denseThreshold').value),
    weekly_concentration_threshold: Number($('weeklyConcentrationThreshold').value),
    favorable_label: $('favorableLabel').value.trim(),
    normal_label: $('normalLabel').value.trim(),
    dense_label: $('denseLabel').value.trim(),
    display_mode: $('displayMode').value,
    refresh_mode: $('refreshMode').value,
    visual_icon_only: $('visualIconOnly').checked,
    visual_fill: $('visualFill').checked,
    visual_gradient: $('visualGradient').checked,
    visual_pulse: $('visualPulse').checked,
    visual_page_corner: $('visualPageCorner').checked
  });

  const statusLabel = (day, row) => {
    if (day.status === 'favorable') return row.favorable_label || 'Благоприятно';
    if (day.status === 'normal') return row.normal_label || 'Штатно';
    if (day.status === 'dense') return row.dense_label || 'Плотно';
    return 'Недостаточно данных';
  };

  async function refreshPreview() {
    if (!settings || previewBusy) return;
    previewBusy = true;
    $('refreshPreviewBtn').disabled = true;
    $('previewList').replaceChildren();
    const today = businessTodayISO();
    // Preview always reflects the last saved server configuration, not unsaved form edits.
    const savedHorizon = Number(settings.forecast_days || 14);
    const toDate = shiftIsoDate(today, savedHorizon - 1);
    try {
      const snapshot = await window.dockslotLoadAdvisory?.loadSnapshot(sb, today, toDate, true);
      const days = snapshot?.days || [];
      $('previewMeta').textContent = `${days.length} рабочих дат · горизонт ${savedHorizon} дней · алгоритм: ${settings.algorithm} · расчёт не ограничивает запись`;
      if (!days.length) {
        const empty = document.createElement('div');
        empty.className = 'load-empty-inline';
        empty.textContent = 'В выбранном горизонте нет рабочих дат для отображения.';
        $('previewList').appendChild(empty);
        return;
      }
      days.slice(0, 12).forEach((day) => {
        const card = document.createElement('article');
        card.className = 'load-preview-card';
        const heading = document.createElement('strong');
        heading.textContent = dateLabel(day.slot_date);
        const tag = document.createElement('span');
        tag.className = `load-preview-tag ${day.status || 'unknown'}`;
        tag.textContent = statusLabel(day, settings);
        const metric = document.createElement('div');
        metric.className = 'load-preview-metric';
        const pct = document.createElement('b');
        pct.textContent = day.load_percent === null || day.load_percent === undefined ? '—' : `${Math.round(Number(day.load_percent))}%`;
        const counts = document.createElement('small');
        counts.textContent = `Всего ${Number(day.forecast_count || 0)} машин · основные места ${Number(day.forecast_main_count || 0)}/${Number(day.main_capacity || 0)} · резерв ИМ ${Number(day.forecast_reserve_count || 0)}/${Number(day.reserve_capacity || 0)}`;
        metric.append(pct, tag);
        const note = document.createElement('p');
        note.textContent = day.high_concentration
          ? `Доля недели ${Math.round(Number(day.weekly_share_percent || 0))}% · возможна плотная концентрация потока.`
          : `Текущие записи: ${Number(day.current_count || 0)} · прогноз: ${Number(day.forecast_count || 0)}.`;
        card.append(heading, metric, counts, note);
        $('previewList').appendChild(card);
      });
    } catch (error) {
      console.error('Load advisory preview:', error);
      const empty = document.createElement('div');
      empty.className = 'load-empty-inline';
      empty.textContent = error.message || 'Не удалось получить предварительный прогноз.';
      $('previewList').appendChild(empty);
    } finally {
      previewBusy = false;
      $('refreshPreviewBtn').disabled = false;
    }
  }

  async function loadState() {
    const { data, error } = await sb.from('load_advisory_settings')
      .select('enabled,algorithm,lookback_weeks,forecast_days,favorable_threshold,dense_threshold,weekly_concentration_threshold,favorable_label,normal_label,dense_label,display_mode,refresh_mode,visual_icon_only,visual_fill,visual_gradient,visual_pulse,visual_page_corner,updated_at')
      .eq('id', true)
      .single();
    if (error) throw error;
    settings = data;
    populateForm(data);
    renderMode();
    await refreshPreview();
  }

  async function saveSettings(event) {
    event.preventDefault();
    const next = collectSettings();
    if (!next.favorable_label || !next.normal_label || !next.dense_label) {
      showToast('Заполните все три названия категорий.', true);
      return;
    }
    if (!Number.isFinite(next.favorable_threshold) || !Number.isFinite(next.dense_threshold)
      || next.favorable_threshold >= next.dense_threshold) {
      showToast('Порог «Благоприятно» должен быть меньше порога «Плотно».', true);
      return;
    }
    if (next.visual_icon_only) {
      next.visual_fill = false;
      next.visual_gradient = false;
      next.visual_pulse = false;
      next.visual_page_corner = false;
    }
    setBusy(true);
    try {
      const { data, error } = await sb.from('load_advisory_settings')
        .update(next)
        .eq('id', true)
        .select('enabled,algorithm,lookback_weeks,forecast_days,favorable_threshold,dense_threshold,weekly_concentration_threshold,favorable_label,normal_label,dense_label,display_mode,refresh_mode,visual_icon_only,visual_fill,visual_gradient,visual_pulse,visual_page_corner,updated_at')
        .single();
      if (error) throw error;
      settings = data;
      populateForm(data);
      renderMode();
      $('saveMeta').textContent = `Сохранено: ${new Date(data.updated_at).toLocaleString('ru-RU')}`;
      showToast('Настройки рекомендаций загруженности сохранены.');
      await refreshPreview();
    } catch (error) {
      console.error('Save load advisory settings:', error);
      showToast(error.message || 'Не удалось сохранить настройки.', true);
    } finally {
      setBusy(false);
      syncVisualOptions();
    }
  }

  async function toggleAdvisory() {
    if (!isSuperAdmin) {
      modeSwitch.checked = Boolean(settings?.enabled);
      return;
    }
    const requested = modeSwitch.checked;
    modeSwitch.disabled = true;
    try {
      const { data, error } = await sb.rpc('set_load_advisory_enabled', { p_enabled: requested });
      if (error) throw error;
      if (data !== true) throw new Error('Сервер не подтвердил изменение режима.');
      settings.enabled = requested;
      renderMode();
      showToast(requested ? 'Рекомендации загруженности включены.' : 'Рекомендации загруженности выключены.');
      await refreshPreview();
    } catch (error) {
      console.error('Toggle load advisory:', error);
      modeSwitch.checked = Boolean(settings?.enabled);
      showToast(error.message || 'Не удалось изменить состояние системы.', true);
    } finally {
      modeSwitch.disabled = !isSuperAdmin;
    }
  }

  $('visualIconOnly').addEventListener('change', syncVisualOptions);
  ['visualFill', 'visualGradient', 'visualPulse', 'visualPageCorner'].forEach((id) => $(id).addEventListener('change', () => {
    if ($(id).checked) $('visualIconOnly').checked = false;
    syncVisualOptions();
  }));
  form.addEventListener('submit', saveSettings);
  $('refreshPreviewBtn').addEventListener('click', refreshPreview);
  modeSwitch.addEventListener('change', toggleAdvisory);
  $('logoutBtn').addEventListener('click', async (event) => {
    event.preventDefault();
    await sb.auth.signOut();
    window.location.replace('../index.html');
  });

  try {
    await loadState();
  } catch (error) {
    console.error('Load advisory initialization:', error);
    showToast(error.message || 'Не удалось загрузить управление нагрузкой.', true);
    $('previewMeta').textContent = 'Проверь, что миграция load_advisory_management_v1.sql выполнена в Supabase.';
    $('previewList').replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'load-empty-inline';
    empty.textContent = 'Нет соединения с настройками рекомендаций. После применения SQL-миграции обновите страницу.';
    $('previewList').appendChild(empty);
  }
});
