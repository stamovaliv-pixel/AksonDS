/* Shared, non-blocking load visualization for supplier and operator calendars. */
(() => {
  'use strict';

  const STATUS = {
    favorable: { icon: '✓', colorClass: 'favorable' },
    normal: { icon: '≈', colorClass: 'normal' },
    dense: { icon: '▲', colorClass: 'dense' },
    unknown: { icon: '?', colorClass: 'unknown' }
  };

  const safeNumber = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const labelFor = (status, settings = {}) => {
    if (status === 'favorable') return String(settings.favorable_label || 'Благоприятно');
    if (status === 'normal') return String(settings.normal_label || 'Штатно');
    if (status === 'dense') return String(settings.dense_label || 'Плотно');
    return 'Недостаточно данных';
  };

  const densityBarState = (item) => {
    const pct = item?.load_percent === null || item?.load_percent === undefined
      ? null
      : safeNumber(item.load_percent, NaN);
    if (Number.isFinite(pct) && pct >= 100) {
      return { level: 4, label: 'Плотно', percent: Math.round(pct) };
    }
    switch (item?.status) {
      case 'favorable':
        return { level: 1, label: 'Свободно', percent: Number.isFinite(pct) ? Math.round(pct) : null };
      case 'normal':
        return { level: 2, label: 'Умеренно', percent: Number.isFinite(pct) ? Math.round(pct) : null };
      case 'dense':
        return { level: 3, label: 'Плотно', percent: Number.isFinite(pct) ? Math.round(pct) : null };
      default:
        return { level: 0, label: '', percent: Number.isFinite(pct) ? Math.round(pct) : null };
    }
  };

  const densityBarTitle = (state) => {
    if (state.unavailable) return 'Недоступно';
    const percentText = state.percent === null ? '—' : `${state.percent}%`;
    return `Занято ${percentText} слотов`;
  };

  const makeDensityBar = (item, { unavailable = false } = {}) => {
    // Unavailable dates use four solid-gray segments, independently of forecast data.
    const state = unavailable
      ? { level: 4, label: '', percent: 100, unavailable: true }
      : densityBarState(item);
    const track = document.createElement('span');
    track.className = `load-advisory-density-track load-advisory-density-level-${state.level}`;
    if (unavailable) track.classList.add('load-advisory-density-unavailable');
    track.setAttribute('role', 'img');
    const title = densityBarTitle(state);
    track.setAttribute('aria-label', title);
    track.setAttribute('title', title);

    for (let index = 1; index <= 4; index += 1) {
      const segment = document.createElement('span');
      segment.className = `load-advisory-density-segment load-advisory-density-segment-${index}`;
      if (index <= state.level) segment.classList.add('is-filled');
      segment.setAttribute('aria-hidden', 'true');
      track.appendChild(segment);
    }
    return track;
  };

  const visualClasses = (status, settings = {}) => {
    const meta = STATUS[status] || STATUS.unknown;
    const classes = [`load-advisory-${meta.colorClass}`];
    if (!settings.visual_icon_only) {
      if (settings.visual_fill) classes.push('load-advisory-fill');
      if (settings.visual_gradient) classes.push('load-advisory-gradient');
      if (settings.visual_pulse) classes.push('load-advisory-pulse');
    }
    if (settings.visual_icon_only) classes.push('load-advisory-icon-only');
    return classes;
  };

  const makeMarker = (status, settings = {}) => {
    const meta = STATUS[status] || STATUS.unknown;
    const marker = document.createElement('span');
    marker.className = 'load-advisory-marker';
    const glyph = document.createElement('span');
    glyph.className = 'load-advisory-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = meta.icon;
    const text = document.createElement('span');
    text.className = 'load-advisory-text';
    text.textContent = labelFor(status, settings);
    marker.append(glyph, text);
    return marker;
  };

  const detailsFor = (item, settings = {}) => {
    const pct = item?.load_percent === null || item?.load_percent === undefined
      ? null
      : `${Math.round(safeNumber(item.load_percent))}%`;
    const count = safeNumber(item?.forecast_count);
    const capacity = safeNumber(item?.capacity);
    const mainPct = item?.main_load_percent === null || item?.main_load_percent === undefined ? null : `${Math.round(safeNumber(item.main_load_percent))}%`;
    const reservePct = item?.reserve_load_percent === null || item?.reserve_load_percent === undefined ? null : `${Math.round(safeNumber(item.reserve_load_percent))}%`;
    const mainCount = safeNumber(item?.forecast_main_count);
    const reserveCount = safeNumber(item?.forecast_reserve_count);
    const mainCapacity = safeNumber(item?.main_capacity);
    const reserveCapacity = safeNumber(item?.reserve_capacity);
    const share = safeNumber(item?.weekly_share_percent);
    let message;
    switch (item?.status) {
      case 'favorable':
        message = 'Прогнозируется низкая загруженность. Ожидаются более благоприятные условия обработки и меньше вероятность ожидания.';
        break;
      case 'normal':
        message = 'Ожидается штатная загруженность РЦ. Обработка должна проходить в обычном режиме.';
        break;
      case 'dense':
        message = item?.high_concentration
          ? `Плотная запись: на этот день приходится ${Math.round(share)}% прогнозируемого недельного потока. Возможна повышенная нагрузка на парковку и увеличение времени обработки входящего потока.`
          : 'Прогнозируется высокая загруженность. Возможно увеличение времени ожидания и обработки входящего потока.';
        break;
      default:
        message = 'Исторических данных пока недостаточно для надёжного прогноза. Показатель основан преимущественно на текущих записях.';
    }
    return {
      label: labelFor(item?.status, settings), message, pct, count, capacity,
      mainPct, reservePct, mainCount, reserveCount, mainCapacity, reserveCapacity, share
    };
  };

  async function loadSnapshot(sb, fromDate, toDate, preview = false) {
    if (!sb || !fromDate || !toDate) return null;
    const { data, error } = await sb.rpc('get_load_advisory_snapshot', {
      p_from: fromDate,
      p_to: toDate,
      p_preview: Boolean(preview)
    });
    if (error) {
      console.warn('[DockSlot load advisory] Snapshot unavailable:', error.message || error);
      return null;
    }
    return data || null;
  }

  function syncDensityLegend(cell, settings = {}) {
    // During calendar rendering a day cell may not yet be appended to the grid.
    // Resolve the grid by its stable page id first, then fall back to DOM ancestry.
    const grid = document.getElementById('calendarGrid')
      || cell?.closest?.('.calendar-grid');
    if (!grid) return;

    const parent = grid.parentElement;
    const existing = parent?.querySelector(':scope > .load-advisory-density-legend');

    if (settings.enabled === false || settings.visual_density_bar === false) {
      existing?.remove();
      return;
    }
    if (settings.enabled !== true || settings.visual_density_bar !== true) return;

    if (existing) {
      if (grid.nextElementSibling !== existing) grid.insertAdjacentElement('afterend', existing);
      return;
    }

    const legend = document.createElement('div');
    legend.className = 'load-advisory-density-legend';
    legend.setAttribute('aria-label', 'Расшифровка индикатора загруженности');

    const items = [
      ['free', 'Свободно', 1],
      ['moderate', 'Умеренно', 2],
      ['dense', 'Плотно', 3],
      ['full', 'Запись полная', 4],
      ['unavailable', 'Недоступно (свыше 30 дней)', 4]
    ];

    items.forEach(([key, label, level]) => {
      const item = document.createElement('span');
      item.className = `load-advisory-density-legend-item load-advisory-density-legend-${key}`;

      const swatch = document.createElement('span');
      swatch.className = `load-advisory-density-legend-swatch load-advisory-density-level-${level}`;
      if (key === 'unavailable') swatch.classList.add('load-advisory-density-unavailable');
      swatch.setAttribute('aria-hidden', 'true');

      for (let index = 1; index <= 4; index += 1) {
        const segment = document.createElement('span');
        segment.className = `load-advisory-density-segment load-advisory-density-segment-${index}`;
        if (index <= level) segment.classList.add('is-filled');
        swatch.appendChild(segment);
      }

      const text = document.createElement('span');
      text.textContent = label;
      item.append(swatch, text);
      legend.appendChild(item);
    });

    grid.insertAdjacentElement('afterend', legend);
  }

  function applyCalendarCell(cell, item, settings = {}) {
    if (!cell) return;
    syncDensityLegend(cell, settings);

    if (!Object.prototype.hasOwnProperty.call(cell.dataset, 'loadAdvisoryOriginalAria')) {
      cell.dataset.loadAdvisoryOriginalAria = cell.getAttribute('aria-label') || cell.textContent.trim();
    }
    if (!Object.prototype.hasOwnProperty.call(cell.dataset, 'loadAdvisoryOriginalTitle')) {
      cell.dataset.loadAdvisoryOriginalTitle = cell.getAttribute('title') || '';
    }

    cell.querySelector('.load-advisory-marker')?.remove();
    cell.querySelector('.load-advisory-page-corner')?.remove();
    cell.querySelector('.load-advisory-led-strip')?.remove();
    cell.querySelector('.load-advisory-density-track')?.remove();
    cell.classList.remove(
      'load-advisory-favorable', 'load-advisory-normal', 'load-advisory-dense', 'load-advisory-unknown',
      'load-advisory-fill', 'load-advisory-gradient', 'load-advisory-pulse',
      'load-advisory-icon-only', 'load-advisory-high-concentration',
      'load-advisory-page-corner-active', 'load-advisory-led-active',
      'load-advisory-density-bar-active'
    );
    cell.title = cell.dataset.loadAdvisoryOriginalTitle || '';
    cell.setAttribute('aria-label', cell.dataset.loadAdvisoryOriginalAria || cell.textContent.trim());
    if (!settings.enabled) return;

    const date = String(cell.dataset.date || '');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const limitDateObj = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    limitDateObj.setDate(limitDateObj.getDate() + 30);
    const limitDate = `${limitDateObj.getFullYear()}-${String(limitDateObj.getMonth() + 1).padStart(2, '0')}-${String(limitDateObj.getDate()).padStart(2, '0')}`;

    const isPastDate = Boolean(date && date < today);
    const isBeyondThirtyDays = Boolean(date && date > limitDate);
    const isExplicitlyExcluded = cell.classList.contains('date-excluded');

    // Dates beyond the 30-day booking horizon (and explicitly excluded dates)
    // always use four solid-gray segments, never the colored gradient.
    if (settings.visual_density_bar && (isBeyondThirtyDays || isExplicitlyExcluded)) {
      cell.classList.add('load-advisory-density-bar-active');
      cell.appendChild(makeDensityBar(null, { unavailable: true }));
      cell.title = 'Недоступно';
      cell.setAttribute('aria-label', `${cell.dataset.loadAdvisoryOriginalAria || cell.textContent.trim()}. Недоступно`);
      return;
    }

    // Past dates retain their real 1/4–4/4 color state and are only dimmed.
    // If the snapshot has no historical row, keep the one-segment neutral fallback,
    // but do not replace a known historical level with a blue-only marker.
    if (settings.visual_density_bar && isPastDate) {
      cell.classList.add('load-advisory-density-bar-active');
      const bar = makeDensityBar(item || null);
      bar.classList.add('load-advisory-density-past');
      cell.appendChild(bar);
      cell.title = bar.getAttribute('title') || 'Прошедшая дата';
      return;
    }

    // Inactive dates inside the visible horizon are not automatically treated as
    // >30-day dates; preserve their forecast indication whenever one is available.
    if (!item) {
      if (settings.visual_density_bar && cell.classList.contains('inactive')) {
        cell.classList.add('load-advisory-density-bar-active');
        cell.appendChild(makeDensityBar(null));
      }
      return;
    }

    cell.classList.add(...visualClasses(item.status, settings));
    if (item.high_concentration) cell.classList.add('load-advisory-high-concentration');
    if (settings.visual_center_status !== false) cell.appendChild(makeMarker(item.status, settings));

    if (settings.visual_density_bar) {
      cell.classList.add('load-advisory-density-bar-active');
      const bar = makeDensityBar(item);
      cell.appendChild(bar);
      cell.title = bar.getAttribute('title') || '';
    } else {
      const detail = detailsFor(item, settings);
      cell.title = `${detail.label} · Максимальная загрузка пула ${detail.pct || '—'} · Основные места ${detail.mainCount}/${detail.mainCapacity} (${detail.mainPct || '—'}) · Резерв ИМ ${detail.reserveCount}/${detail.reserveCapacity} (${detail.reservePct || '—'})${item.high_concentration ? ' · Высокая концентрация недельного потока' : ''}`;
    }
    cell.setAttribute('aria-label', `${cell.dataset.loadAdvisoryOriginalAria || cell.textContent.trim()}. ${cell.title}`);
  }

  function applyHourCard(card, item, settings = {}) {
    if (!card) return;
    if (!Object.prototype.hasOwnProperty.call(card.dataset, 'loadAdvisoryOriginalTitle')) {
      card.dataset.loadAdvisoryOriginalTitle = card.getAttribute('title') || '';
    }
    card.querySelector('.load-advisory-marker')?.remove();
    card.classList.remove('load-advisory-hour');
    card.classList.remove(
      'load-advisory-favorable', 'load-advisory-normal', 'load-advisory-dense', 'load-advisory-unknown',
      'load-advisory-fill', 'load-advisory-gradient', 'load-advisory-pulse', 'load-advisory-icon-only'
    );
    card.title = card.dataset.loadAdvisoryOriginalTitle || '';
    if (!item || !settings.enabled || settings.display_mode !== 'calendar_detail') return;
    card.classList.add('load-advisory-hour');
    card.classList.add(...visualClasses(item.status, settings));
    const marker = settings.visual_center_status !== false ? makeMarker(item.status, settings) : null;
    if (marker) {
      const existingTime = card.querySelector('.slot-time, .hour-period-label, .hour-header');
      if (existingTime && existingTime.parentElement === card) existingTime.insertAdjacentElement('afterend', marker);
      else card.insertBefore(marker, card.firstChild);
    }
    const detail = detailsFor(item, settings);
    card.title = `${detail.label} · Максимальная загрузка пула ${detail.pct || '—'} · Основные места ${detail.mainCount}/${detail.mainCapacity} (${detail.mainPct || '—'}) · Резерв ИМ ${detail.reserveCount}/${detail.reserveCapacity} (${detail.reservePct || '—'})`;
  }

  function renderDayDetail(container, item, settings = {}) {
    if (!container) return;
    container.replaceChildren();
    if (!item || !settings.enabled || settings.display_mode !== 'calendar_detail') return;
    const detail = detailsFor(item, settings);
    const panel = document.createElement('div');
    panel.className = `load-advisory-day-detail load-advisory-${STATUS[item.status] ? STATUS[item.status].colorClass : 'unknown'}`;
    const marker = makeMarker(item.status, { ...settings, visual_icon_only: false });
    marker.classList.add('load-advisory-detail-marker');
    const copy = document.createElement('div');
    copy.className = 'load-advisory-detail-copy';
    const heading = document.createElement('strong');
    heading.textContent = `${detail.label}${detail.pct ? ` · ${detail.pct}` : ''}`;
    const message = document.createElement('span');
    const breakdown = `Основные места: ${detail.mainCount}/${detail.mainCapacity} (${detail.mainPct || '—'}) · резерв ИМ: ${detail.reserveCount}/${detail.reserveCapacity} (${detail.reservePct || '—'})`;
    message.textContent = `${detail.message} Прогноз: ${detail.count} машин суммарно. Максимальная загрузка отдельного пула: ${detail.pct || '—'}. ${breakdown}.`;
    copy.append(heading, message);
    panel.append(marker, copy);
    container.appendChild(panel);
  }

  function renderCalendarPanel(grid, snapshot) {
    if (!grid) return;
    grid.parentElement?.querySelector('.load-advisory-summary')?.remove();
    const settings = snapshot?.settings;
    const days = snapshot?.days || [];
    if (!settings?.enabled || settings.display_mode !== 'calendar_panel' || !days.length) return;
    const counts = days.reduce((acc, day) => {
      acc[day.status] = (acc[day.status] || 0) + 1;
      return acc;
    }, {});
    const panel = document.createElement('div');
    panel.className = 'load-advisory-summary';
    const heading = document.createElement('strong');
    heading.textContent = 'Прогноз ближайших рабочих дней:';
    panel.appendChild(heading);
    [
      ['favorable', settings.favorable_label || 'Благоприятно'],
      ['normal', settings.normal_label || 'Штатно'],
      ['dense', settings.dense_label || 'Плотно'],
      ['unknown', 'Недостаточно данных']
    ].forEach(([key, label]) => {
      if (!counts[key]) return;
      const item = document.createElement('span');
      item.textContent = `${label}: ${counts[key]}`;
      panel.appendChild(item);
    });
    const concentrationCount = days.filter((day) => day.high_concentration).length;
    if (concentrationCount > 0) {
      const concentration = document.createElement('span');
      concentration.className = 'load-advisory-concentration-summary';
      concentration.textContent = `Высокая концентрация потока: ${concentrationCount}`;
      panel.appendChild(concentration);
    }
    grid.parentElement?.insertBefore(panel, grid);
  }

  function watch(sb, callback, settings = {}) {
    let intervalId = null;
    let channel = null;
    let debounceId = null;
    const run = () => {
      if (document.visibilityState === 'hidden') return;
      Promise.resolve().then(callback).catch((error) => {
        console.warn('[DockSlot load advisory] Refresh failed:', error?.message || error);
      });
    };
    if (settings.refresh_mode === 'poll_3m') {
      intervalId = window.setInterval(run, 150000);
    } else if (settings.refresh_mode === 'realtime' && sb?.channel) {
      const scheduleRefresh = () => {
        window.clearTimeout(debounceId);
        debounceId = window.setTimeout(run, 900);
      };
      // Safe aggregate signal avoids exposing other suppliers' booking rows through Realtime.
      // A five-minute poll is retained as a fallback if the Realtime channel disconnects silently.
      intervalId = window.setInterval(run, 300000);
      channel = sb.channel('dockslot-load-advisory-live')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'load_advisory_signal' }, scheduleRefresh)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'load_advisory_settings' }, scheduleRefresh)
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[DockSlot load advisory] Realtime subscription unavailable; using periodic fallback refresh.');
          }
        });
    }
    return () => {
      if (intervalId !== null) window.clearInterval(intervalId);
      if (debounceId !== null) window.clearTimeout(debounceId);
      if (channel) sb.removeChannel(channel);
    };
  }

  window.dockslotLoadAdvisory = {
    loadSnapshot,
    applyCalendarCell,
    applyHourCard,
    renderDayDetail,
    renderCalendarPanel,
    watch,
    detailsFor
  };
})();
