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
  dragActive: false,
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
  appShell: null,
  summary: {},
  eventList: null,
  viewer: null,
  filters: null,
  connectButton: null,
  manualButton: null,
  folderInput: null,
  dragOverlay: null,
  statusMessage: null
};

const activeObjectUrls = new Set();
let dragDepth = 0;

function initDom() {
  const app = document.getElementById('app');

  const shell = document.createElement('div');
  shell.className = 'app-shell';
  elements.appShell = shell;

  const header = document.createElement('header');
  header.className = 'app-header liquid-pane';

  const brand = document.createElement('div');
  brand.className = 'app-brand';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'app-eyebrow';
  eyebrow.textContent = 'Dashcam cockpit';

  const title = document.createElement('h1');
  title.textContent = 'TeslaCam Viewer';

  const systemPill = document.createElement('span');
  systemPill.className = 'system-pill';
  systemPill.textContent = SUPPORTS_FILE_SYSTEM_ACCESS ? 'Direct USB access ready' : 'Upload mode enabled';

  const brandRow = document.createElement('div');
  brandRow.className = 'brand-row';
  brandRow.append(title, systemPill);

  const subtitle = document.createElement('p');
  subtitle.className = 'app-subtitle';
  subtitle.textContent =
    'Review Recent, Saved, and Sentry footage from the TeslaCam drive with a calmer, more native-feeling multi-camera viewer.';

  brand.append(eyebrow, brandRow, subtitle);

  const actionBlock = document.createElement('div');
  actionBlock.className = 'header-action-block';

  const controlGroup = document.createElement('div');
  controlGroup.className = 'header-controls';

  const connectButton = document.createElement('button');
  connectButton.className = 'primary-button';
  connectButton.type = 'button';
  connectButton.textContent = SUPPORTS_FILE_SYSTEM_ACCESS ? 'Connect TeslaCam' : 'USB Access Unavailable';
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

  const actionNote = document.createElement('p');
  actionNote.className = 'header-note';
  actionNote.textContent = SUPPORTS_FILE_SYSTEM_ACCESS
    ? 'Best experience on desktop Chromium. You can also drop a TeslaCam folder anywhere on the page.'
    : 'Direct USB browsing is unavailable in this browser, but folder upload and drag-and-drop still work.';

  controlGroup.append(connectButton, manualButton, folderInput);
  actionBlock.append(controlGroup, actionNote);

  header.append(brand, actionBlock);

  const main = document.createElement('main');
  main.className = 'app-main';

  const summaryPanel = document.createElement('section');
  summaryPanel.className = 'summary-panel liquid-pane';

  const summaryIntro = document.createElement('div');
  summaryIntro.className = 'summary-intro';

  const summaryEyebrow = document.createElement('span');
  summaryEyebrow.className = 'section-eyebrow';
  summaryEyebrow.textContent = 'Fleet overview';

  const summaryHeadline = document.createElement('h2');
  summaryHeadline.className = 'section-title';
  summaryHeadline.textContent = 'Recent footage at a glance';

  const summaryCopy = document.createElement('p');
  summaryCopy.className = 'section-copy';
  summaryCopy.textContent =
    'Keep the latest Recent, Saved, and Sentry sessions visible while you decide which event deserves the full multi-camera review.';

  summaryIntro.append(summaryEyebrow, summaryHeadline, summaryCopy);
  summaryPanel.appendChild(summaryIntro);

  const summaryGrid = document.createElement('div');
  summaryGrid.className = 'summary-grid';

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
    summaryGrid.appendChild(tile);
    elements.summary[key] = valueEl;
  });
  summaryPanel.appendChild(summaryGrid);

  const layoutGrid = document.createElement('section');
  layoutGrid.className = 'layout-grid';

  const listContainer = document.createElement('div');
  listContainer.className = 'sidebar-panel liquid-pane';

  const listHeader = document.createElement('div');
  listHeader.className = 'panel-header';

  const listEyebrow = document.createElement('span');
  listEyebrow.className = 'section-eyebrow';
  listEyebrow.textContent = 'Event queue';

  const listTitle = document.createElement('h2');
  listTitle.className = 'section-title';
  listTitle.textContent = 'Recorded events';

  const listCopy = document.createElement('p');
  listCopy.className = 'section-copy';
  listCopy.textContent =
    'Jump between saved incidents, recent clips, and sentry alerts without losing the selected camera or trigger moment.';

  listHeader.append(listEyebrow, listTitle, listCopy);

  const filters = document.createElement('div');
  filters.className = 'filters';
  CLIP_TYPES.forEach(({ id, label }) => {
    const filterButton = document.createElement('button');
    filterButton.className = `filter-button${id === state.filter ? ' active' : ''}`;
    filterButton.type = 'button';
    filterButton.dataset.filter = id;
    filterButton.dataset.label = label;

    const text = document.createElement('span');
    text.className = 'filter-label';
    text.textContent = label;

    const count = document.createElement('span');
    count.className = 'filter-count';
    count.textContent = '0';

    filterButton.append(text, count);
    filters.appendChild(filterButton);
  });
  elements.filters = filters;

  const eventList = document.createElement('div');
  eventList.className = 'event-list';
  elements.eventList = eventList;

  listContainer.append(listHeader, filters, eventList);

  const viewer = document.createElement('section');
  viewer.className = 'viewer-panel liquid-pane';
  elements.viewer = viewer;

  const dragOverlay = document.createElement('div');
  dragOverlay.className = 'drag-overlay';
  dragOverlay.hidden = true;
  dragOverlay.setAttribute('aria-hidden', 'true');

  const dragPanel = document.createElement('div');
  dragPanel.className = 'drag-overlay-panel liquid-pane';

  const dragKicker = document.createElement('span');
  dragKicker.className = 'section-eyebrow';
  dragKicker.textContent = 'Quick import';

  const dragTitle = document.createElement('h2');
  dragTitle.className = 'drag-title';
  dragTitle.textContent = 'Drop your TeslaCam folder to load footage';

  const dragBody = document.createElement('p');
  dragBody.className = 'drag-copy';
  dragBody.textContent =
    'Folders, MP4 clips, and event metadata files are accepted. The viewer will group them into Recent, Saved, and Sentry events automatically.';

  dragPanel.append(dragKicker, dragTitle, dragBody);
  dragOverlay.appendChild(dragPanel);
  elements.dragOverlay = dragOverlay;

  layoutGrid.append(listContainer, viewer);
  main.append(summaryPanel, layoutGrid);
  shell.append(header, main, dragOverlay);
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
    updateStateWithEvents(events);
    if (!events.length) {
      setStatus('No TeslaCam clips detected in the selected directory.', 'warn');
      return;
    }
    setStatus(summarizeImportedFootage(events, 'Connected to TeslaCam drive.'), 'info');
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

  try {
    clearStatus();
    await importEntries(
      normalizeFileEntries(files),
      'No TeslaCam clips detected in the uploaded folder.',
      'Imported from folder upload.'
    );
  } catch (error) {
    console.error(error);
    setStatus('Unable to import the selected folder. Check console for details.', 'error');
  }
}

function normalizeFileEntries(files) {
  return files.map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name
  }));
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

async function loadTeslaCamFromEntries(entries) {
  const events = new Map();
  const categories = new Set(['RecentClips', 'SavedClips', 'SentryClips']);

  entries.forEach(({ file, relativePath }) => {
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

function summarizeImportedFootage(events, suffix = '') {
  const eventCount = events.length;
  const clipCount = events.reduce((total, event) => total + event.clipCount, 0);
  const summary = `Loaded ${eventCount} event${eventCount === 1 ? '' : 's'} and ${clipCount} video file${clipCount === 1 ? '' : 's'}.`;
  return suffix ? `${summary} ${suffix}` : summary;
}

function createRichEmptyState({ kicker, title, body, cards = [], footnote = '', compact = false }) {
  const empty = document.createElement('section');
  empty.className = `empty-state${compact ? ' empty-state-compact' : ''}`;

  const shell = document.createElement('div');
  shell.className = 'empty-shell';

  if (kicker) {
    const kickerEl = document.createElement('span');
    kickerEl.className = 'empty-kicker';
    kickerEl.textContent = kicker;
    shell.appendChild(kickerEl);
  }

  const titleEl = document.createElement('h3');
  titleEl.className = 'empty-title';
  titleEl.textContent = title;
  shell.appendChild(titleEl);

  const bodyEl = document.createElement('p');
  bodyEl.className = 'empty-copy';
  bodyEl.textContent = body;
  shell.appendChild(bodyEl);

  if (cards.length) {
    const grid = document.createElement('div');
    grid.className = 'empty-grid';

    cards.forEach((card) => {
      const cardEl = document.createElement('article');
      cardEl.className = 'empty-card';

      if (card.label) {
        const label = document.createElement('span');
        label.className = 'empty-card-label';
        label.textContent = card.label;
        cardEl.appendChild(label);
      }

      const heading = document.createElement('h4');
      heading.className = 'empty-card-title';
      heading.textContent = card.title;

      const copy = document.createElement('p');
      copy.className = 'empty-card-copy';
      copy.textContent = card.body;

      cardEl.append(heading, copy);
      grid.appendChild(cardEl);
    });

    shell.appendChild(grid);
  }

  if (footnote) {
    const footnoteEl = document.createElement('p');
    footnoteEl.className = 'empty-footnote';
    footnoteEl.textContent = footnote;
    shell.appendChild(footnoteEl);
  }

  empty.appendChild(shell);
  return empty;
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

  const countByFilter = {
    all: state.events.length,
    RecentClips: state.stats.RecentClips,
    SavedClips: state.stats.SavedClips,
    SentryClips: state.stats.SentryClips
  };

  for (const button of elements.filters.querySelectorAll('.filter-button')) {
    button.classList.toggle('active', button.dataset.filter === state.filter);

    const count = button.querySelector('.filter-count');
    if (count) {
      count.textContent = `${countByFilter[button.dataset.filter] ?? 0}`;
    }
  }
}

function renderEventList() {
  if (!elements.eventList) return;
  const list = elements.eventList;
  list.innerHTML = '';

  if (!state.filteredEvents.length) {
    if (state.events.length) {
      list.appendChild(
        createRichEmptyState({
          kicker: 'Filtered view',
          title: `No ${prettyTypeLabel(state.filter).toLowerCase()} events in this queue`,
          body: 'Switch to another filter or import more TeslaCam footage to repopulate this lane.',
          compact: true,
          cards: [
            {
              label: 'Tip',
              title: 'Try All Clips',
              body: 'The full queue keeps every Recent, Saved, and Sentry event visible when a narrower filter comes up empty.'
            }
          ]
        })
      );
      return;
    }

    list.appendChild(
      createRichEmptyState({
        kicker: 'Ready to import',
        title: 'No TeslaCam footage loaded yet',
        body: 'Connect the drive, upload the TeslaCam folder, or drag footage onto the page to populate the event queue.',
        compact: true,
        cards: [
          {
            label: '1',
            title: 'Connect directly',
            body: 'On Chromium desktop you can grant the viewer direct access to the TeslaCam USB drive for the fastest import.'
          },
          {
            label: '2',
            title: 'Upload a folder',
            body: 'The upload flow accepts the standard TeslaCam directory with RecentClips, SavedClips, and SentryClips.'
          }
        ],
        footnote: 'Drag-and-drop also works for folders, MP4 clips, and matching event metadata files.'
      })
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  state.filteredEvents.forEach((event) => {
    const card = document.createElement('article');
    card.className = `event-card liquid-pane${event.id === state.selectedEventId ? ' active' : ''}`;
    card.dataset.id = event.id;
    card.tabIndex = 0;

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
    if (state.events.length) {
      viewer.appendChild(
        createRichEmptyState({
          kicker: 'Viewer standby',
          title: 'Choose an event to enter playback',
          body: 'The selected event becomes the primary cockpit view with trigger-aware clip navigation and camera switching.',
          cards: [
            {
              label: 'Timeline',
              title: 'Trigger-aware segments',
              body: 'Smart highlights surface the most relevant moment first, then keep the full timeline one tap away.'
            },
            {
              label: 'Cameras',
              title: 'Front-first angle selection',
              body: 'The viewer favors the front camera automatically but lets you jump between every available angle instantly.'
            }
          ]
        })
      );
      return;
    }

    viewer.appendChild(
      createRichEmptyState({
        kicker: 'Tesla-style playback',
        title: 'Bring the TeslaCam drive online',
        body: 'Once footage is loaded, this area becomes a quieter review surface with event metadata, smart highlights, and synchronized camera switching.',
        cards: [
          {
            label: 'Direct access',
            title: 'Plug in the USB drive',
            body: 'Use Connect TeslaCam on Chromium desktop to browse the live TeslaCam directory without exporting clips first.'
          },
          {
            label: 'Folder import',
            title: 'Upload from Finder',
            body: 'Choose the TeslaCam folder if you prefer the fallback flow or if the browser blocks the File System Access API.'
          },
          {
            label: 'Drag and drop',
            title: 'Drop footage anywhere',
            body: 'Folders, MP4 files, and event metadata can be dropped onto the page and will be grouped into events automatically.'
          }
        ],
        footnote: 'The viewer understands RecentClips, SavedClips, SentryClips, MP4 footage, and optional event.json metadata.'
      })
    );
    return;
  }

  const currentSegment = ensureSelectedSegment(selected);
  if (!currentSegment) {
    viewer.appendChild(
      createRichEmptyState({
        kicker: 'Playback unavailable',
        title: 'No playable segments were found for this event',
        body: 'The event loaded into the queue, but none of its files could be turned into a camera segment for playback.',
        compact: true
      })
    );
    return;
  }

  const highlightIds = new Set(computeSegmentHighlights(selected));
  let segmentIndex = selected.segments.findIndex((segment) => segment.id === currentSegment.id);
  if (segmentIndex === -1) segmentIndex = 0;

  const cameraEntries = await loadCameraEntries(selected, currentSegment);
  if (!cameraEntries.length) {
    viewer.appendChild(
      createRichEmptyState({
        kicker: 'Playback unavailable',
        title: 'Unable to load videos for this segment',
        body: 'The footage exists in the event, but the browser could not create playable video sources for the selected moment.',
        compact: true
      })
    );
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
  segmentDescriptor.className = 'meta-pill';
  segmentDescriptor.textContent = describeSegmentRelativeTiming(selected, currentSegment);
  meta.appendChild(segmentDescriptor);

  if (selected.metadata?.reason) {
    const reason = document.createElement('span');
    reason.className = 'meta-pill';
    reason.textContent = formatReason(selected.metadata.reason);
    meta.appendChild(reason);
  }

  if (selected.metadata?.city) {
    const city = document.createElement('span');
    city.className = 'meta-pill';
    city.textContent = selected.metadata.city;
    meta.appendChild(city);
  }

  if (Number.isFinite(selected.metadata?.latitude) && Number.isFinite(selected.metadata?.longitude)) {
    const link = document.createElement('a');
    link.className = 'meta-pill meta-link';
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
    thumbButton.setAttribute('aria-pressed', entry.label === activeEntry.label ? 'true' : 'false');

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

function handleListKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;

  const card = event.target.closest('.event-card');
  if (!card) return;

  event.preventDefault();
  card.click();
}

function handleFilterClick(event) {
  const button = event.target.closest('.filter-button');
  if (!button) return;

  const { filter } = button.dataset;
  if (!filter || filter === state.filter) return;

  applyFilter(filter);
}

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function setDragOverlayVisible(isVisible) {
  state.dragActive = isVisible;
  elements.appShell?.classList.toggle('drag-active', isVisible);
  if (!elements.dragOverlay) return;
  elements.dragOverlay.hidden = !isVisible;
  elements.dragOverlay.setAttribute('aria-hidden', `${!isVisible}`);
}

async function collectEntriesFromTransferHandle(handle, pathParts, entries) {
  if (handle.kind === 'file') {
    const file = await handle.getFile();
    entries.push({
      file,
      relativePath: [...pathParts, file.name].join('/')
    });
    return;
  }

  for await (const [name, childHandle] of handle.entries()) {
    if (childHandle.kind === 'directory') {
      await collectEntriesFromTransferHandle(childHandle, [...pathParts, name], entries);
      continue;
    }

    const file = await childHandle.getFile();
    entries.push({
      file,
      relativePath: [...pathParts, name].join('/')
    });
  }
}

async function extractDroppedEntries(dataTransfer) {
  const items = Array.from(dataTransfer?.items ?? []);
  if (items.length && typeof items[0]?.getAsFileSystemHandle === 'function') {
    const handles = [];

    for (const item of items) {
      if (item.kind !== 'file') continue;
      try {
        const handle = await item.getAsFileSystemHandle();
        if (handle) {
          handles.push(handle);
        }
      } catch (error) {
        console.warn('Unable to inspect dropped item via File System Access handle', error);
      }
    }

    if (handles.length) {
      const entries = [];
      for (const handle of handles) {
        const rootPath = handle.kind === 'directory' ? [handle.name] : [];
        await collectEntriesFromTransferHandle(handle, rootPath, entries);
      }
      if (entries.length) {
        return entries;
      }
    }
  }

  return normalizeFileEntries(Array.from(dataTransfer?.files ?? []));
}

async function importEntries(entries, emptyMessage, successSuffix) {
  const events = await loadTeslaCamFromEntries(entries);
  updateStateWithEvents(events);

  if (!events.length) {
    setStatus(emptyMessage, 'warn');
    return;
  }

  setStatus(summarizeImportedFootage(events, successSuffix), 'info');
}

function handleWindowDragEnter(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth += 1;
  setDragOverlayVisible(true);
}

function handleWindowDragOver(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
  if (!state.dragActive) {
    dragDepth = 1;
    setDragOverlayVisible(true);
  }
}

function handleWindowDragLeave(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) {
    setDragOverlayVisible(false);
  }
}

async function handleWindowDrop(event) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  setDragOverlayVisible(false);
  clearStatus();

  try {
    const entries = await extractDroppedEntries(event.dataTransfer);
    if (!entries.length) {
      setStatus('Drop a TeslaCam folder, MP4 clip, or matching event metadata to import footage.', 'warn');
      return;
    }

    await importEntries(entries, 'No TeslaCam clips detected in the dropped files.', 'Imported from drag-and-drop.');
  } catch (error) {
    console.error(error);
    setStatus('Unable to import the dropped footage. Check console for details.', 'error');
  }
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
    <p>This browser does not expose the File System Access API. Use Upload Folder or drag the TeslaCam folder onto the page, or switch to a Chromium-based desktop browser for direct USB access.</p>
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
  elements.eventList?.addEventListener('keydown', handleListKeydown);
  elements.filters?.addEventListener('click', handleFilterClick);
  window.addEventListener('dragenter', handleWindowDragEnter);
  window.addEventListener('dragover', handleWindowDragOver);
  window.addEventListener('dragleave', handleWindowDragLeave);
  window.addEventListener('drop', (event) => {
    void handleWindowDrop(event);
  });
  renderSummary();
  renderEventList();
  void renderViewer();
});
