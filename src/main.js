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
  selectedSegmentByEvent: new Map(),
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
  summaryPanel.className = 'summary-panel liquid-pane';

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
  const segments = new Map();
  const cameraCatalog = [];
  const seenCameras = new Set();
  let clipCount = 0;
  let metadata = null;

  for await (const [name, handle] of folderHandle.entries()) {
    if (handle.kind !== 'file') continue;
    const lower = name.toLowerCase();

    if (lower.endsWith('.mp4')) {
      const cameraKey = detectCameraFromFilename(name);
      const cameraLabel = CAMERA_LABELS[cameraKey] ?? cameraKey ?? 'Unknown';
      const segmentKey = deriveSegmentKey(name);
      const clipTimestamp = parseClipTimestampFromName(name);
      const segment = ensureSegmentContainer(segments, segmentKey, clipTimestamp);

      if (!segment.clips.has(cameraLabel)) {
        segment.clips.set(cameraLabel, []);
        segment.cameraOrder.push(cameraLabel);
      }

      segment.clips.get(cameraLabel).push({
        label: cameraLabel,
        source: createHandleSource(handle),
        filename: name,
        timestamp: clipTimestamp
      });
      segment.clipCount += 1;
      clipCount += 1;

      if (!seenCameras.has(cameraLabel)) {
        seenCameras.add(cameraLabel);
        cameraCatalog.push(cameraLabel);
      }
      continue;
    }

    if (lower.endsWith('.json')) {
      const file = await handle.getFile();
      metadata = await parseMetadataFromText(await file.text(), metadata);
    }
  }

  if (!segments.size) return null;

  const segmentList = Array.from(segments.values()).sort((a, b) => {
    if (Number.isNaN(a.timestamp) && Number.isNaN(b.timestamp)) return a.id.localeCompare(b.id);
    if (Number.isNaN(a.timestamp)) return 1;
    if (Number.isNaN(b.timestamp)) return -1;
    return a.timestamp - b.timestamp;
  });

  let timestamp = parseTimestamp(folderName, metadata?.timestamp);
  if (Number.isNaN(timestamp) && segmentList.length) {
    const midIndex = Math.floor(segmentList.length / 2);
    const midSegment = segmentList[midIndex];
    if (midSegment && !Number.isNaN(midSegment.timestamp)) {
      timestamp = midSegment.timestamp;
    }
  }

  return {
    id: `${category}-${folderName}`,
    folderName,
    category,
    segments: segmentList,
    cameraCatalog,
    clipCount,
    timestamp,
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
        segments: new Map(),
        cameraCatalog: [],
        seenCameras: new Set(),
        clipCount: 0,
        timestamp: parseTimestamp(folderName),
        metadata: null
      });
    }

    const event = events.get(eventId);
    if (ext.endsWith('.mp4')) {
      event.clipCount += 1;
      const cameraKey = detectCameraFromFilename(file.name);
      const cameraLabel = CAMERA_LABELS[cameraKey] ?? cameraKey ?? 'Unknown';
      const segmentKey = deriveSegmentKey(file.name);
      const clipTimestamp = parseClipTimestampFromName(file.name);
      const segment = ensureSegmentContainer(event.segments, segmentKey, clipTimestamp);

      if (!segment.clips.has(cameraLabel)) {
        segment.clips.set(cameraLabel, []);
        segment.cameraOrder.push(cameraLabel);
      }

      segment.clips.get(cameraLabel).push({
        label: cameraLabel,
        source: createFileSource(file),
        filename: file.name,
        timestamp: clipTimestamp
      });
      segment.clipCount += 1;

      if (!event.seenCameras.has(cameraLabel)) {
        event.seenCameras.add(cameraLabel);
        event.cameraCatalog.push(cameraLabel);
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

    const segmentList = Array.from(event.segments.values()).sort((a, b) => {
      if (Number.isNaN(a.timestamp) && Number.isNaN(b.timestamp)) return a.id.localeCompare(b.id);
      if (Number.isNaN(a.timestamp)) return 1;
      if (Number.isNaN(b.timestamp)) return -1;
      return a.timestamp - b.timestamp;
    });

    if (!segmentList.length) {
      continue;
    }

    if (Number.isNaN(event.timestamp)) {
      const midIndex = Math.floor(segmentList.length / 2);
      const midSegment = segmentList[midIndex];
      if (midSegment && !Number.isNaN(midSegment.timestamp)) {
        event.timestamp = midSegment.timestamp;
      }
    }

    resolvedEvents.push({
      id: event.id,
      folderName: event.folderName,
      category: event.category,
      segments: segmentList,
      cameraCatalog: event.cameraCatalog,
      clipCount: event.clipCount,
      timestamp: event.timestamp,
      metadata: event.metadata
    });
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

function deriveSegmentKey(name) {
  const match = name.match(/(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})/);
  return match ? match[1] : name.replace(/\.mp4$/, '');
}

function parseClipTimestampFromName(name) {
  const match = name.match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return Number.NaN;
  const [_, date, hour, minute, second] = match;
  return new Date(`${date}T${hour}:${minute}:${second}Z`).valueOf();
}

function ensureSegmentContainer(collection, key, clipTimestamp) {
  if (!collection.has(key)) {
    collection.set(key, {
      id: key,
      timestamp: clipTimestamp,
      clips: new Map(),
      cameraOrder: [],
      clipCount: 0
    });
  }

  const segment = collection.get(key);
  if (!Number.isNaN(clipTimestamp)) {
    if (Number.isNaN(segment.timestamp) || clipTimestamp < segment.timestamp) {
      segment.timestamp = clipTimestamp;
    }
  }
  return segment;
}

function ensureSelectedSegment(event) {
  if (!event?.segments?.length) return null;

  const currentId = state.selectedSegmentByEvent.get(event.id);
  const existing = event.segments.find((segment) => segment.id === currentId);
  if (existing) {
    return existing;
  }

  const intelligent = chooseIntelligentSegment(event);
  const fallback = intelligent ?? event.segments[0];
  state.selectedSegmentByEvent.set(event.id, fallback.id);
  return fallback;
}

function chooseIntelligentSegment(event) {
  if (!event?.segments?.length) return null;

  const anchor = Number.isNaN(event.timestamp) ? null : event.timestamp;
  let bestSegment = null;
  let bestScore = Number.POSITIVE_INFINITY;

  if (anchor !== null) {
    for (const segment of event.segments) {
      if (Number.isNaN(segment.timestamp)) continue;
      const diff = Math.abs(segment.timestamp - anchor);
      if (diff < bestScore) {
        bestScore = diff;
        bestSegment = segment;
      }
    }
    if (bestSegment) return bestSegment;
  }

  if (event.metadata?.primaryCamera) {
    const primarySegment = event.segments.find((segment) => segment.clips.has(event.metadata.primaryCamera));
    if (primarySegment) return primarySegment;
  }

  const frontSegment = event.segments.find((segment) =>
    segment.cameraOrder.some((label) => label.toLowerCase().includes('front'))
  );
  if (frontSegment) return frontSegment;

  return event.segments[Math.floor(event.segments.length / 2)] ?? event.segments[0];
}

function computeSegmentHighlights(event, limit = 3) {
  if (!event?.segments?.length) return [];
  const anchor = Number.isNaN(event.timestamp) ? null : event.timestamp;
  const totalAngles = event.cameraCatalog.length || 1;

  const scored = event.segments.map((segment) => {
    const diff = anchor === null || Number.isNaN(segment.timestamp) ? Number.MAX_SAFE_INTEGER : Math.abs(segment.timestamp - anchor);
    const coverageRatio = segment.cameraOrder.length / totalAngles;
    const clipBonus = segment.clipCount;
    const score = diff - coverageRatio * 1000 - clipBonus * 5;
    return { id: segment.id, score };
  });

  scored.sort((a, b) => a.score - b.score);

  const highlights = [];
  for (const item of scored) {
    if (!highlights.includes(item.id)) {
      highlights.push(item.id);
    }
    if (highlights.length >= limit) break;
  }
  return highlights;
}

function segmentDeltaSeconds(event, segment) {
  if (!event || !segment) return Number.NaN;
  if (Number.isNaN(event.timestamp) || Number.isNaN(segment.timestamp)) return Number.NaN;
  return Math.round((segment.timestamp - event.timestamp) / 1000);
}

function formatSegmentLabel(event, segment) {
  const delta = segmentDeltaSeconds(event, segment);
  if (!Number.isNaN(delta)) {
    if (delta === 0) return 'Trigger moment';
    const prefix = delta > 0 ? '+' : '-';
    return `${prefix}${Math.abs(delta)}s`;
  }

  if (!Number.isNaN(segment.timestamp)) {
    return new Date(segment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  return `Segment`;
}

function formatSegmentDetails(event, segment) {
  const angles = `${segment.cameraOrder.length} angle${segment.cameraOrder.length === 1 ? '' : 's'}`;
  const delta = segmentDeltaSeconds(event, segment);
  if (!Number.isNaN(delta)) {
    if (delta === 0) {
      return `Primary clip • ${angles}`;
    }
    return `${delta > 0 ? `${delta}s after` : `${Math.abs(delta)}s before`} • ${angles}`;
  }

  if (!Number.isNaN(segment.timestamp)) {
    return `${new Date(segment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} • ${angles}`;
  }

  return angles;
}

function formatAbsoluteTime(segment) {
  if (!segment || Number.isNaN(segment.timestamp)) return 'Time unknown';
  return new Date(segment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function describeSegmentRelativeTiming(event, segment) {
  const delta = segmentDeltaSeconds(event, segment);
  const coverage = `${segment.cameraOrder.length} angle${segment.cameraOrder.length === 1 ? '' : 's'}`;
  if (Number.isNaN(delta)) {
    return `Captured at ${formatAbsoluteTime(segment)} • ${coverage}`;
  }
  if (delta === 0) {
    return `Primary trigger moment • ${coverage}`;
  }
  if (delta < 0) {
    return `${Math.abs(delta)}s before trigger • ${coverage}`;
  }
  return `${delta}s after trigger • ${coverage}`;
}

function createSegmentNavigation(event, currentSegment, highlightIds) {
  const container = document.createElement('div');
  container.className = 'segment-navigation liquid-pane';

  if (highlightIds.size) {
    const highlightGroup = document.createElement('div');
    highlightGroup.className = 'segment-group';

    const heading = document.createElement('h4');
    heading.textContent = 'Smart highlights';
    highlightGroup.appendChild(heading);

    const strip = document.createElement('div');
    strip.className = 'segment-strip';

    event.segments
      .filter((segment) => highlightIds.has(segment.id))
      .forEach((segment) => {
        strip.appendChild(createSegmentChip(event, segment, segment.id === currentSegment.id, true));
      });

    highlightGroup.appendChild(strip);
    container.appendChild(highlightGroup);
  }

  const timelineGroup = document.createElement('div');
  timelineGroup.className = 'segment-group';

  const timelineHeading = document.createElement('h4');
  timelineHeading.textContent = 'All clips';
  timelineGroup.appendChild(timelineHeading);

  const timelineStrip = document.createElement('div');
  timelineStrip.className = 'segment-strip scrollable';

  event.segments.forEach((segment, index) => {
    timelineStrip.appendChild(
      createSegmentChip(event, segment, segment.id === currentSegment.id, highlightIds.has(segment.id), index)
    );
  });

  timelineGroup.appendChild(timelineStrip);
  container.appendChild(timelineGroup);

  return container;
}

function createSegmentChip(event, segment, isActive, isHighlight, indexOverride) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `segment-chip${isActive ? ' is-active' : ''}${isHighlight ? ' is-highlight' : ''}`;
  button.dataset.segmentId = segment.id;

  const label = document.createElement('span');
  label.className = 'segment-chip-label';
  label.textContent = formatSegmentLabel(event, segment);

  const detail = document.createElement('span');
  detail.className = 'segment-chip-detail';
  const detailText = formatSegmentDetails(event, segment);
  const ordinal = typeof indexOverride === 'number' ? `Clip ${indexOverride + 1}` : null;
  detail.textContent = ordinal ? `${ordinal} • ${detailText}` : detailText;

  button.append(label, detail);
  return button;
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
  for (const id of Array.from(state.selectedSegmentByEvent.keys())) {
    if (!validIds.has(id)) {
      state.selectedSegmentByEvent.delete(id);
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
    card.className = `event-card liquid-pane${event.id === state.selectedEventId ? ' active' : ''}`;
    card.dataset.id = event.id;

    const title = document.createElement('div');
    title.className = 'event-title';
    title.textContent = formatEventTitle(event);

    const metaTop = document.createElement('div');
    metaTop.className = 'event-meta';

    const cameraCount = document.createElement('span');
    cameraCount.textContent = `${event.cameraCatalog.length} angle${event.cameraCatalog.length === 1 ? '' : 's'}`;

    const segmentCount = document.createElement('span');
    segmentCount.textContent = `${event.segments.length} segment${event.segments.length === 1 ? '' : 's'}`;

    const clipType = document.createElement('span');
    clipType.className = 'event-type';
    clipType.textContent = prettyTypeLabel(event.category);

    metaTop.append(cameraCount, segmentCount, clipType);

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

  const currentSegment = ensureSelectedSegment(selected);
  if (!currentSegment) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No playable segments found for this event.';
    viewer.appendChild(empty);
    return;
  }

  const highlightIds = new Set(computeSegmentHighlights(selected));
  let segmentIndex = selected.segments.findIndex((segment) => segment.id === currentSegment.id);
  if (segmentIndex === -1) segmentIndex = 0;

  const cameraEntries = await loadCameraEntries(selected, currentSegment);
  if (!cameraEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Unable to load videos for this segment.';
    viewer.appendChild(empty);
    return;
  }

  const activeLabel = ensureSelectedCamera(selected, currentSegment);
  const activeEntry = cameraEntries.find((entry) => entry.label === activeLabel) ?? cameraEntries[0];
  state.selectedCameraByEvent.set(selected.id, activeEntry.label);

  const header = document.createElement('div');
  header.className = 'viewer-header liquid-pane';

  const headingBlock = document.createElement('div');
  headingBlock.className = 'viewer-heading';

  const title = document.createElement('h2');
  title.className = 'viewer-title';
  title.textContent = formatEventTitle(selected);

  const subtitle = document.createElement('span');
  subtitle.className = 'viewer-subtitle';
  subtitle.textContent = `${prettyTypeLabel(selected.category)} • Segment ${segmentIndex + 1} of ${selected.segments.length}`;

  headingBlock.append(title, subtitle);

  const info = document.createElement('div');
  info.className = 'viewer-stats';
  info.textContent = `${selected.cameraCatalog.length} angle${selected.cameraCatalog.length === 1 ? '' : 's'} • ${selected.clipCount} file${selected.clipCount === 1 ? '' : 's'} • ${selected.segments.length} segment${selected.segments.length === 1 ? '' : 's'}`;

  header.append(headingBlock, info);

  const meta = document.createElement('div');
  meta.className = 'viewer-meta liquid-pane';

  const segmentDescriptor = document.createElement('span');
  segmentDescriptor.textContent = describeSegmentRelativeTiming(selected, currentSegment);
  meta.appendChild(segmentDescriptor);

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

  const segmentNav = createSegmentNavigation(selected, currentSegment, highlightIds);

  const primaryView = document.createElement('div');
  primaryView.className = 'primary-view liquid-pane';

  const primaryHeading = document.createElement('div');
  primaryHeading.className = 'primary-heading';

  const cameraTitle = document.createElement('h3');
  cameraTitle.textContent = activeEntry.label;

  const cameraSubheading = document.createElement('span');
  cameraSubheading.className = 'camera-subheading';
  cameraSubheading.textContent = formatAbsoluteTime(currentSegment);

  primaryHeading.append(cameraTitle, cameraSubheading);

  const primaryVideo = document.createElement('video');
  primaryVideo.controls = true;
  primaryVideo.preload = 'metadata';
  primaryVideo.playsInline = true;
  primaryVideo.src = activeEntry.url;
  primaryVideo.className = 'primary-video';

  primaryView.append(primaryHeading, primaryVideo);

  const thumbnailStrip = document.createElement('div');
  thumbnailStrip.className = 'thumbnail-strip liquid-pane';

  cameraEntries.forEach((entry) => {
    const thumbButton = document.createElement('button');
    thumbButton.className = `thumbnail-button${entry.label === activeEntry.label ? ' active' : ''}`;
    thumbButton.type = 'button';
    thumbButton.dataset.label = entry.label;

    const thumbOverlay = document.createElement('div');
    thumbOverlay.className = 'thumbnail-overlay';

    const thumbVideo = document.createElement('video');
    thumbVideo.preload = 'metadata';
    thumbVideo.playsInline = true;
    thumbVideo.muted = true;
    thumbVideo.src = entry.url;

    const thumbLabel = document.createElement('span');
    thumbLabel.textContent = entry.label;

    thumbOverlay.append(thumbVideo, thumbLabel);
    thumbButton.appendChild(thumbOverlay);
    thumbnailStrip.appendChild(thumbButton);
  });

  viewer.append(header);
  if (meta.childElementCount) {
    viewer.appendChild(meta);
  }
  viewer.append(segmentNav, primaryView, thumbnailStrip);

  segmentNav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-segment-id]');
    if (!button) return;
    const { segmentId } = button.dataset;
    if (!segmentId || segmentId === state.selectedSegmentByEvent.get(selected.id)) return;
    state.selectedSegmentByEvent.set(selected.id, segmentId);
    void renderViewer();
  });

  thumbnailStrip.addEventListener('click', (event) => {
    const button = event.target.closest('.thumbnail-button');
    if (!button) return;
    const { label } = button.dataset;
    if (!label || label === state.selectedCameraByEvent.get(selected.id)) return;
    state.selectedCameraByEvent.set(selected.id, label);
    void renderViewer();
  });
}

function ensureSelectedCamera(event, segment) {
  const current = state.selectedCameraByEvent.get(event.id);
  if (current && segment.clips.has(current)) {
    return current;
  }

  if (event.metadata?.primaryCamera && segment.clips.has(event.metadata.primaryCamera)) {
    state.selectedCameraByEvent.set(event.id, event.metadata.primaryCamera);
    return event.metadata.primaryCamera;
  }

  const frontCamera = segment.cameraOrder.find((label) => label.toLowerCase().includes('front'));
  if (frontCamera) {
    state.selectedCameraByEvent.set(event.id, frontCamera);
    return frontCamera;
  }

  const firstCamera = segment.cameraOrder[0];
  if (firstCamera) {
    state.selectedCameraByEvent.set(event.id, firstCamera);
    return firstCamera;
  }

  if (current && event.cameraCatalog.includes(current)) {
    return current;
  }

  const fallback = event.cameraCatalog[0];
  if (fallback) {
    state.selectedCameraByEvent.set(event.id, fallback);
    return fallback;
  }

  return null;
}

async function loadCameraEntries(event, segment) {
  const entries = [];

  for (const label of segment.cameraOrder) {
    const clipOptions = segment.clips.get(label);
    if (!clipOptions?.length) continue;
    const primaryClip = clipOptions[0];
    try {
      const file = await primaryClip.source.getFile();
      const url = URL.createObjectURL(file);
      activeObjectUrls.add(url);
      entries.push({ label, url, timestamp: primaryClip.timestamp });
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
      const swUrl = new URL('./sw.js', window.location.href);
      navigator.serviceWorker.register(swUrl.href).catch((error) => {
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
