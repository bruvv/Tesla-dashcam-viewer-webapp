import './style.css';

const CAMERA_LABELS = {
  front: 'Front',
  front_wide: 'Front Wide',
  left_repeater: 'Left Repeater',
  right_repeater: 'Right Repeater',
  rear: 'Rear',
  back: 'Rear',
  cabin: 'Cabin',
  front_left_fender: 'Front Left Fender',
  front_right_fender: 'Front Right Fender'
};

const CAMERA_INDEX_MAP = {
  '0': 'front',
  '1': 'front_wide',
  '2': 'front',
  '3': 'left_repeater',
  '4': 'right_repeater',
  '5': 'rear',
  '6': 'cabin',
  '7': 'front_right_fender',
  '8': 'front_left_fender'
};

const CLIP_TYPES = [
  { id: 'all', label: 'All Clips' },
  { id: 'RecentClips', label: 'Recent' },
  { id: 'SavedClips', label: 'Saved' },
  { id: 'SentryClips', label: 'Sentry' }
];

const REASON_LABELS = {
  sentry_aware_object_detection: 'Sentry detected activity',
  sentry_aware_glass_break: 'Sentry detected glass break',
  sentry_aware_door_opened: 'Sentry detected door open',
  sentry_aware_intrusion: 'Sentry detected intrusion',
  sentry_aware_tilt: 'Sentry detected vehicle tilt',
  sentry_aware_impact: 'Sentry detected impact',
  user_interaction_dashcam_launcher_action_tapped: 'Manual save via dashcam icon',
  user_interaction_save_clip: 'Manual save (long press)',
  user_interaction_honk: 'Horn triggered recording',
  user_interaction_security_alert: 'Manual security alert',
  user_interaction_shield_mode_enabled: 'Shield mode enabled',
  user_interaction_shield_mode_disabled: 'Shield mode disabled'
};

const SUPPORTS_FILE_SYSTEM_ACCESS = typeof window.showDirectoryPicker === 'function';

const state = {
  events: [],
  filteredEvents: [],
  selectedEventId: null,
  filter: 'all',
  selectedCameraByEvent: new Map(),
  stats: {
    totalEvents: 0,
    totalClips: 0,
    RecentClips: 0,
    SavedClips: 0,
    SentryClips: 0
  }
};

const elements = {
  summary: {},
  eventList: null,
  viewer: null,
  filters: null,
  connectButton: null,
  manualButton: null,
  folderInput: null,
  statusMessage: null
};

const activeObjectUrls = new Set();

function initDom() {
  const app = document.getElementById('app');

  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const header = document.createElement('header');
  header.className = 'app-header';

  const title = document.createElement('h1');
  title.textContent = 'TeslaCam Viewer';

  const controlGroup = document.createElement('div');
  controlGroup.className = 'header-controls';

  const connectButton = document.createElement('button');
  connectButton.className = 'primary-button';
  connectButton.type = 'button';
  connectButton.textContent = SUPPORTS_FILE_SYSTEM_ACCESS ? 'Connect Drive' : 'Filesystem API Unavailable';
  connectButton.disabled = !SUPPORTS_FILE_SYSTEM_ACCESS;

  const manualButton = document.createElement('button');
  manualButton.className = 'secondary-button';
  manualButton.type = 'button';
  manualButton.textContent = 'Upload Folder';

  const folderInput = document.createElement('input');
  folderInput.type = 'file';
  folderInput.accept = 'video/mp4,application/json';
  folderInput.multiple = true;
  folderInput.style.display = 'none';
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.setAttribute('directory', '');

  controlGroup.append(connectButton, manualButton, folderInput);

  header.append(title, controlGroup);

  const main = document.createElement('main');
  main.className = 'app-main';

  const summaryPanel = document.createElement('section');
  summaryPanel.className = 'summary-panel';

  const summaryItems = [
    ['Total Events', 'totalEvents'],
    ['Recent', 'RecentClips'],
    ['Saved', 'SavedClips'],
    ['Sentry', 'SentryClips'],
    ['Video Files', 'totalClips']
  ];

  summaryItems.forEach(([label, key]) => {
    const tile = document.createElement('div');
    tile.className = 'summary-tile';

    const labelEl = document.createElement('div');
    labelEl.className = 'summary-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = 'summary-value';
    valueEl.textContent = '0';

    tile.append(labelEl, valueEl);
    summaryPanel.appendChild(tile);
    elements.summary[key] = valueEl;
  });

  const layoutGrid = document.createElement('section');
  layoutGrid.className = 'layout-grid';

  const listContainer = document.createElement('div');

  const filters = document.createElement('div');
  filters.className = 'filters';
  CLIP_TYPES.forEach(({ id, label }) => {
    const filterButton = document.createElement('button');
    filterButton.className = `filter-button${id === state.filter ? ' active' : ''}`;
    filterButton.dataset.filter = id;
    filterButton.textContent = label;
    filters.appendChild(filterButton);
  });
  elements.filters = filters;

  const eventList = document.createElement('div');
  eventList.className = 'event-list';
  elements.eventList = eventList;

  listContainer.append(filters, eventList);

  const viewer = document.createElement('section');
  viewer.className = 'viewer-panel';
  elements.viewer = viewer;

  layoutGrid.append(listContainer, viewer);
  main.append(summaryPanel, layoutGrid);
  shell.append(header, main);
  app.appendChild(shell);

  elements.connectButton = connectButton;
  elements.manualButton = manualButton;
  elements.folderInput = folderInput;
}

async function handleConnectClick() {
  try {
    clearStatus();

    const rootHandle = await window.showDirectoryPicker();
    const events = await loadTeslaCamFromDirectoryHandle(rootHandle);

    if (!events.length) {
      setStatus('No TeslaCam clips detected in the selected directory.', 'warn');
    }

    updateStateWithEvents(events);
  } catch (error) {
    if (error.name === 'AbortError') {
      setStatus('Directory selection cancelled.', 'info');
      return;
    }
    console.error(error);
    setStatus('Unable to read TeslaCam data. Check console for details.', 'error');
  }
}

async function handleFolderUpload(event) {
  const files = Array.from(event.target.files ?? []);
  event.target.value = '';
  if (!files.length) return;

  clearStatus();

  const events = await loadTeslaCamFromFileList(files);
  if (!events.length) {
    setStatus('No TeslaCam clips detected in the uploaded folder.', 'warn');
  }
  updateStateWithEvents(events);
}

async function loadTeslaCamFromDirectoryHandle(rootHandle) {
  const categories = ['RecentClips', 'SavedClips', 'SentryClips'];
  const allEvents = [];

  for (const category of categories) {
    const directory = await findSubdirectory(rootHandle, category);
    if (!directory) continue;

    const events = await collectEventsFromDirectory(directory, category);
    allEvents.push(...events);
  }

  return allEvents.sort((a, b) => b.timestamp - a.timestamp);
}

async function findSubdirectory(rootHandle, directoryName) {
  for await (const [name, handle] of rootHandle.entries()) {
    if (name === directoryName && handle.kind === 'directory') {
      return handle;
    }
  }
  return null;
}

async function collectEventsFromDirectory(directoryHandle, category) {
  const results = [];

  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind !== 'directory') continue;

    const event = await parseEventFolderFromHandle(handle, name, category);
    if (event) {
      results.push(event);
    }
  }

  return results;
}

async function parseEventFolderFromHandle(folderHandle, folderName, category) {
  const cameraSources = new Map();
  let clipCount = 0;
  let metadata = null;

  for await (const [name, handle] of folderHandle.entries()) {
    if (handle.kind !== 'file') continue;
    const lower = name.toLowerCase();

    if (lower.endsWith('.mp4')) {
      const cameraKey = detectCameraFromFilename(name);
      const cameraLabel = CAMERA_LABELS[cameraKey] ?? cameraKey ?? 'Unknown';
      cameraSources.set(cameraLabel, createHandleSource(handle));
      clipCount += 1;
      continue;
    }

    if (lower.endsWith('.json')) {
      const file = await handle.getFile();
      metadata = await parseMetadataFromText(await file.text(), metadata);
    }
  }

  if (!cameraSources.size) return null;

  const timestamp = parseTimestamp(folderName, metadata?.timestamp);

  return {
    id: `${category}-${folderName}`,
    folderName,
    category,
    cameraSources,
    clipCount,
    timestamp,
    cameraOrder: Array.from(cameraSources.keys()),
    metadata
  };
}

async function loadTeslaCamFromFileList(files) {
  const events = new Map();
  const categories = new Set(['RecentClips', 'SavedClips', 'SentryClips']);

  files.forEach((file) => {
    const relativePath = file.webkitRelativePath || file.name;
    const parts = relativePath.split(/[/\\]/).filter(Boolean);
    if (!parts.length) return;
    const categoryIndex = parts.findIndex((part) => categories.has(part));
    if (categoryIndex === -1 || categoryIndex + 1 >= parts.length) return;

    const category = parts[categoryIndex];
    const folderName = parts[categoryIndex + 1];
    const ext = file.name.toLowerCase();
    const eventId = `${category}-${folderName}`;

    if (!events.has(eventId)) {
      events.set(eventId, {
        id: eventId,
        folderName,
        category,
        cameraSources: new Map(),
        clipCount: 0,
        timestamp: parseTimestamp(folderName),
        cameraOrder: [],
        metadata: null
      });
    }

    const event = events.get(eventId);
    if (ext.endsWith('.mp4')) {
      event.clipCount += 1;
      const cameraKey = detectCameraFromFilename(file.name);
      const cameraLabel = CAMERA_LABELS[cameraKey] ?? cameraKey ?? 'Unknown';
      if (!event.cameraSources.has(cameraLabel)) {
        event.cameraSources.set(cameraLabel, createFileSource(file));
        event.cameraOrder.push(cameraLabel);
      }
    } else if (ext.endsWith('.json')) {
      if (!event.pendingMetadataFiles) {
        event.pendingMetadataFiles = [];
      }
      event.pendingMetadataFiles.push(file);
    }
  });

  const resolvedEvents = [];

  for (const event of events.values()) {
    if (event.pendingMetadataFiles) {
      for (const file of event.pendingMetadataFiles) {
        try {
          const text = await file.text();
          event.metadata = await parseMetadataFromText(text, event.metadata);
        } catch (error) {
          console.warn('Failed to parse metadata JSON from upload', error);
        }
      }
      delete event.pendingMetadataFiles;
    }

    if (event.metadata?.timestamp) {
      const ts = parseTimestamp(event.folderName, event.metadata.timestamp);
      if (!Number.isNaN(ts)) {
        event.timestamp = ts;
      }
    }

    if (!event.cameraOrder.length) {
      event.cameraOrder = Array.from(event.cameraSources.keys());
    }

    if (event.cameraSources.size) {
      resolvedEvents.push(event);
    }
  }

  return resolvedEvents.sort((a, b) => b.timestamp - a.timestamp);
}

function createHandleSource(handle) {
  return {
    async getFile() {
      return handle.getFile();
    }
  };
}

function createFileSource(file) {
  return {
    async getFile() {
      return file;
    }
  };
}

function detectCameraFromFilename(name) {
  const normalized = name.toLowerCase();

  if (normalized.includes('front_left')) return 'front_left_fender';
  if (normalized.includes('front_right')) return 'front_right_fender';
  if (normalized.includes('left_repeater')) return 'left_repeater';
  if (normalized.includes('right_repeater')) return 'right_repeater';
  if (normalized.includes('front_wide')) return 'front_wide';
  if (normalized.includes('front')) return 'front';
  if (normalized.includes('cabin')) return 'cabin';
  if (normalized.includes('rear')) return 'rear';
  if (normalized.includes('back')) return 'back';
  return normalized.replace(/\.mp4$/, '');
}

async function parseMetadataFromText(text, fallback) {
  if (!text) return fallback ?? null;
  try {
    const parsed = JSON.parse(text);
    return normalizeMetadata(parsed, fallback);
  } catch (error) {
    console.warn('Failed to parse metadata json', error);
    return fallback ?? null;
  }
}

function normalizeMetadata(raw, fallback) {
  if (!raw || typeof raw !== 'object') return fallback ?? null;

  const cameraIndexRaw = raw.camera ?? fallback?.cameraIndex ?? null;
  const cameraIndex = cameraIndexRaw === null || cameraIndexRaw === undefined ? null : String(cameraIndexRaw);

  const metadata = {
    timestamp: raw.timestamp ?? fallback?.timestamp ?? null,
    city: raw.city ?? fallback?.city ?? null,
    latitude: safeNumber(raw.est_lat ?? raw.latitude ?? raw.lat),
    longitude: safeNumber(raw.est_lon ?? raw.longitude ?? raw.lon),
    reason: raw.reason ?? fallback?.reason ?? null,
    cameraIndex,
    primaryCamera: fallback?.primaryCamera ?? null
  };

  if (cameraIndex) {
    const mapped = CAMERA_INDEX_MAP[cameraIndex];
    if (mapped) {
      metadata.primaryCamera = CAMERA_LABELS[mapped] ?? mapped;
    }
  }

  return metadata;
}

function safeNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimestamp(folderName, metadataTimestamp) {
  if (metadataTimestamp) {
    const parsed = Date.parse(metadataTimestamp);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  const match = folderName.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return Number.NaN;

  const [_, year, month, day, hour, minute, second] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).valueOf();
}

function updateStateWithEvents(events) {
  state.events = events;
  state.stats.totalEvents = events.length;
  state.stats.totalClips = events.reduce((acc, event) => acc + event.clipCount, 0);
  state.stats.RecentClips = events.filter((event) => event.category === 'RecentClips').length;
  state.stats.SavedClips = events.filter((event) => event.category === 'SavedClips').length;
  state.stats.SentryClips = events.filter((event) => event.category === 'SentryClips').length;

  const validIds = new Set(events.map((event) => event.id));
  for (const id of Array.from(state.selectedCameraByEvent.keys())) {
    if (!validIds.has(id)) {
      state.selectedCameraByEvent.delete(id);
    }
  }

  applyFilter(state.filter);
  renderSummary();
}

function applyFilter(filterId) {
  state.filter = filterId;

  if (filterId === 'all') {
    state.filteredEvents = [...state.events];
  } else {
    state.filteredEvents = state.events.filter((event) => event.category === filterId);
  }

  if (!state.filteredEvents.length) {
    state.selectedEventId = null;
  } else if (!state.selectedEventId) {
    state.selectedEventId = state.filteredEvents[0].id;
  } else if (!state.filteredEvents.some((event) => event.id === state.selectedEventId)) {
    state.selectedEventId = state.filteredEvents[0].id;
  }

  renderFilters();
  renderEventList();
  void renderViewer();
}

function renderSummary() {
  Object.entries(state.stats).forEach(([key, value]) => {
    if (elements.summary[key]) {
      elements.summary[key].textContent = `${value}`;
    }
  });
}

function renderFilters() {
  if (!elements.filters) return;

  for (const button of elements.filters.querySelectorAll('.filter-button')) {
    button.classList.toggle('active', button.dataset.filter === state.filter);
  }
}

function renderEventList() {
  if (!elements.eventList) return;
  const list = elements.eventList;
  list.innerHTML = '';

  if (!state.filteredEvents.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No clips available in this view yet. Connect your TeslaCam drive or upload a folder to populate the list.';
    list.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.filteredEvents.forEach((event) => {
    const card = document.createElement('article');
    card.className = `event-card${event.id === state.selectedEventId ? ' active' : ''}`;
    card.dataset.id = event.id;

    const title = document.createElement('div');
    title.className = 'event-title';
    title.textContent = formatEventTitle(event);

    const metaTop = document.createElement('div');
    metaTop.className = 'event-meta';

    const cameraCount = document.createElement('span');
    cameraCount.textContent = `${event.cameraSources.size} camera${event.cameraSources.size === 1 ? '' : 's'}`;

    const clipType = document.createElement('span');
    clipType.className = 'event-type';
    clipType.textContent = prettyTypeLabel(event.category);

    metaTop.append(cameraCount, clipType);

    const metaBottom = document.createElement('div');
    metaBottom.className = 'event-meta-secondary';

    if (event.metadata?.reason) {
      const reason = document.createElement('span');
      reason.textContent = formatReason(event.metadata.reason);
      metaBottom.appendChild(reason);
    }

    if (event.metadata?.city) {
      const city = document.createElement('span');
      city.textContent = event.metadata.city;
      metaBottom.appendChild(city);
    }

    card.append(title, metaTop);
    if (metaBottom.childElementCount) {
      card.appendChild(metaBottom);
    }
    fragment.appendChild(card);
  });

  list.appendChild(fragment);
}

function formatEventTitle(event) {
  if (Number.isNaN(event.timestamp)) {
    return event.folderName;
  }
  const date = new Date(event.timestamp);
  return `${date.toLocaleDateString()} • ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function prettyTypeLabel(category) {
  if (category === 'RecentClips') return 'Recent';
  if (category === 'SavedClips') return 'Saved';
  if (category === 'SentryClips') return 'Sentry';
  return category;
}

async function renderViewer() {
  if (!elements.viewer) return;

  const viewer = elements.viewer;
  viewer.innerHTML = '';

  clearObjectUrls();

  const selected = state.events.find((event) => event.id === state.selectedEventId);
  if (!selected) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Select a clip to start playback. Multi-camera footage will appear here.';
    viewer.appendChild(empty);
    return;
  }

  ensureSelectedCamera(selected);

  const header = document.createElement('div');
  header.className = 'viewer-header';

  const title = document.createElement('h2');
  title.className = 'viewer-title';
  title.textContent = formatEventTitle(selected);

  const type = document.createElement('span');
  type.className = 'event-type';
  type.textContent = prettyTypeLabel(selected.category);

  const info = document.createElement('span');
  info.textContent = `${selected.cameraSources.size} camera feeds, ${selected.clipCount} files`;

  header.append(title, type, info);

  const meta = document.createElement('div');
  meta.className = 'viewer-meta';

  if (selected.metadata?.reason) {
    const reason = document.createElement('span');
    reason.textContent = formatReason(selected.metadata.reason);
    meta.appendChild(reason);
  }

  if (selected.metadata?.city) {
    const city = document.createElement('span');
    city.textContent = selected.metadata.city;
    meta.appendChild(city);
  }

  if (Number.isFinite(selected.metadata?.latitude) && Number.isFinite(selected.metadata?.longitude)) {
    const link = document.createElement('a');
    link.href = `https://www.google.com/maps?q=${selected.metadata.latitude},${selected.metadata.longitude}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = formatCoordinates(selected.metadata.latitude, selected.metadata.longitude);
    meta.appendChild(link);
  }

  const cameraEntries = await loadCameraEntries(selected);
  if (!cameraEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Unable to load videos for this event.';
    viewer.append(header, meta, empty);
    return;
  }

  const activeLabel = state.selectedCameraByEvent.get(selected.id) ?? cameraEntries[0].label;
  const activeEntry = cameraEntries.find((entry) => entry.label === activeLabel) ?? cameraEntries[0];
  state.selectedCameraByEvent.set(selected.id, activeEntry.label);

  const primaryView = document.createElement('div');
  primaryView.className = 'primary-view';

  const primaryHeading = document.createElement('h3');
  primaryHeading.textContent = activeEntry.label;

  const primaryVideo = document.createElement('video');
  primaryVideo.controls = true;
  primaryVideo.preload = 'metadata';
  primaryVideo.playsInline = true;
  primaryVideo.src = activeEntry.url;
  primaryVideo.className = 'primary-video';

  primaryView.append(primaryHeading, primaryVideo);

  const thumbnailStrip = document.createElement('div');
  thumbnailStrip.className = 'thumbnail-strip';

  cameraEntries.forEach((entry) => {
    const thumbButton = document.createElement('button');
    thumbButton.className = `thumbnail-button${entry.label === activeEntry.label ? ' active' : ''}`;
    thumbButton.type = 'button';
    thumbButton.dataset.label = entry.label;

    const thumbVideo = document.createElement('video');
    thumbVideo.preload = 'metadata';
    thumbVideo.playsInline = true;
    thumbVideo.muted = true;
    thumbVideo.src = entry.url;

    const thumbLabel = document.createElement('span');
    thumbLabel.textContent = entry.label;

    thumbButton.append(thumbVideo, thumbLabel);
    thumbnailStrip.appendChild(thumbButton);
  });

  viewer.append(header);
  if (meta.childElementCount) {
    viewer.appendChild(meta);
  }
  viewer.append(primaryView, thumbnailStrip);

  thumbnailStrip.addEventListener('click', (event) => {
    const button = event.target.closest('.thumbnail-button');
    if (!button) return;
    const { label } = button.dataset;
    if (!label || label === state.selectedCameraByEvent.get(selected.id)) return;
    state.selectedCameraByEvent.set(selected.id, label);
    void renderViewer();
  });
}

function ensureSelectedCamera(event) {
  if (state.selectedCameraByEvent.has(event.id)) return;

  if (event.metadata?.primaryCamera && event.cameraSources.has(event.metadata.primaryCamera)) {
    state.selectedCameraByEvent.set(event.id, event.metadata.primaryCamera);
    return;
  }

  const frontCamera = event.cameraOrder.find((label) => label.toLowerCase().includes('front'));
  if (frontCamera) {
    state.selectedCameraByEvent.set(event.id, frontCamera);
    return;
  }

  const firstCamera = event.cameraOrder[0];
  if (firstCamera) {
    state.selectedCameraByEvent.set(event.id, firstCamera);
  }
}

async function loadCameraEntries(event) {
  const entries = [];

  for (const label of event.cameraOrder) {
    const source = event.cameraSources.get(label);
    if (!source) continue;
    try {
      const file = await source.getFile();
      const url = URL.createObjectURL(file);
      activeObjectUrls.add(url);
      entries.push({ label, url });
    } catch (error) {
      console.error(`Failed to load video for ${label}`, error);
    }
  }

  return entries;
}

function formatReason(reason) {
  return REASON_LABELS[reason] ?? toTitle(reason.replace(/_/g, ' '));
}

function toTitle(text) {
  return text.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function formatCoordinates(lat, lon) {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

function clearObjectUrls() {
  for (const url of activeObjectUrls) {
    URL.revokeObjectURL(url);
  }
  activeObjectUrls.clear();
}

function handleListClick(event) {
  const card = event.target.closest('.event-card');
  if (!card) return;

  const id = card.dataset.id;
  if (id === state.selectedEventId) return;

  state.selectedEventId = id;
  renderEventList();
  void renderViewer();
}

function handleFilterClick(event) {
  const button = event.target.closest('.filter-button');
  if (!button) return;

  const { filter } = button.dataset;
  if (!filter || filter === state.filter) return;

  applyFilter(filter);
}

function clearStatus() {
  if (!elements.statusMessage) return;
  elements.statusMessage.remove();
  elements.statusMessage = null;
}

function setStatus(message, tone = 'info') {
  clearStatus();
  const status = document.createElement('div');
  status.textContent = message;
  status.className = `status-message status-${tone}`;
  elements.statusMessage = status;
  elements.eventList?.prepend(status);
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('Service worker registration failed:', error);
      });
    });
  }
}

function addGlobalHelpBanner() {
  if (SUPPORTS_FILE_SYSTEM_ACCESS) return;
  const app = document.getElementById('app');
  const banner = document.createElement('div');
  banner.className = 'global-banner';
  banner.innerHTML = `
    <p>Your browser does not expose the File System Access API. Use the Upload Folder option or switch to a Chromium-based desktop browser with the API enabled.</p>
  `;
  app.insertBefore(banner, app.firstChild);
}

document.addEventListener('DOMContentLoaded', () => {
  initDom();
  addGlobalHelpBanner();
  registerServiceWorker();

  elements.connectButton?.addEventListener('click', handleConnectClick);
  elements.manualButton?.addEventListener('click', () => elements.folderInput?.click());
  elements.folderInput?.addEventListener('change', handleFolderUpload);
  elements.eventList?.addEventListener('click', handleListClick);
  elements.filters?.addEventListener('click', handleFilterClick);
  renderSummary();
  renderEventList();
  void renderViewer();
});
