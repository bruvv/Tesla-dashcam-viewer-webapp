import protobuf from 'protobufjs/light';

const DASHCAM_SCHEMA = {
  nested: {
    SeiMetadata: {
      fields: {
        version: { type: 'uint32', id: 1 },
        gearState: { type: 'Gear', id: 2 },
        frameSeqNo: { type: 'uint64', id: 3 },
        vehicleSpeedMps: { type: 'float', id: 4 },
        acceleratorPedalPosition: { type: 'float', id: 5 },
        steeringWheelAngle: { type: 'float', id: 6 },
        blinkerOnLeft: { type: 'bool', id: 7 },
        blinkerOnRight: { type: 'bool', id: 8 },
        brakeApplied: { type: 'bool', id: 9 },
        autopilotState: { type: 'AutopilotState', id: 10 },
        latitudeDeg: { type: 'double', id: 11 },
        longitudeDeg: { type: 'double', id: 12 },
        headingDeg: { type: 'double', id: 13 },
        linearAccelerationMps2X: { type: 'double', id: 14 },
        linearAccelerationMps2Y: { type: 'double', id: 15 },
        linearAccelerationMps2Z: { type: 'double', id: 16 }
      },
      nested: {
        Gear: {
          values: {
            GEAR_PARK: 0,
            GEAR_DRIVE: 1,
            GEAR_REVERSE: 2,
            GEAR_NEUTRAL: 3
          }
        },
        AutopilotState: {
          values: {
            NONE: 0,
            SELF_DRIVING: 1,
            AUTOSTEER: 2,
            TACC: 3
          }
        }
      }
    }
  }
};

const SEI_TYPE = protobuf.Root.fromJSON(DASHCAM_SCHEMA).lookupType('SeiMetadata');

const GEAR_STATE_LABELS = {
  0: 'Park',
  1: 'Drive',
  2: 'Reverse',
  3: 'Neutral'
};

const AUTOPILOT_STATE_LABELS = {
  0: 'Manual',
  1: 'Self-Driving',
  2: 'Autosteer',
  3: 'TACC'
};

const CSV_FIELDS = [
  { key: 'frameIndex', header: 'frame_index' },
  { key: 'timeSeconds', header: 'time_seconds' },
  { key: 'frameSeqNo', header: 'frame_seq_no' },
  { key: 'version', header: 'version' },
  { key: 'gearState', header: 'gear_state' },
  { key: 'vehicleSpeedMps', header: 'vehicle_speed_mps' },
  { key: 'vehicleSpeedKph', header: 'vehicle_speed_kph' },
  { key: 'acceleratorPedalPosition', header: 'accelerator_pedal_position' },
  { key: 'steeringWheelAngle', header: 'steering_wheel_angle' },
  { key: 'blinkerOnLeft', header: 'blinker_on_left' },
  { key: 'blinkerOnRight', header: 'blinker_on_right' },
  { key: 'brakeApplied', header: 'brake_applied' },
  { key: 'autopilotState', header: 'autopilot_state' },
  { key: 'latitudeDeg', header: 'latitude_deg' },
  { key: 'longitudeDeg', header: 'longitude_deg' },
  { key: 'headingDeg', header: 'heading_deg' },
  { key: 'linearAccelerationMps2X', header: 'linear_acceleration_mps2_x' },
  { key: 'linearAccelerationMps2Y', header: 'linear_acceleration_mps2_y' },
  { key: 'linearAccelerationMps2Z', header: 'linear_acceleration_mps2_z' }
];

const DEFAULT_FRAME_DURATION_MS = 1000 / 30;

export async function extractTelemetryFromFile(file) {
  const buffer = await file.arrayBuffer();
  return extractTelemetryFromBuffer(buffer);
}

export function extractTelemetryFromBuffer(buffer) {
  const parser = new DashcamTelemetryParser(buffer);
  return parser.extractTimeline();
}

export function findTelemetrySampleAtTime(track, currentTimeSeconds) {
  if (!track?.samples?.length) return null;

  const targetMs = Math.max(0, currentTimeSeconds * 1000);
  const samples = track.samples;
  let low = 0;
  let high = samples.length - 1;
  let bestIndex = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const sample = samples[middle];

    if (sample.timeMs <= targetMs) {
      bestIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return samples[bestIndex];
}

export function buildTelemetryCsv(track) {
  if (!track?.samples?.length) return '';

  const lines = [CSV_FIELDS.map((field) => field.header).join(',')];

  for (const sample of track.samples) {
    const row = CSV_FIELDS.map(({ key }) => serializeCsvValue(sample[key]));
    lines.push(row.join(','));
  }

  return lines.join('\n');
}

function serializeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const normalized =
    typeof value === 'number' && !Number.isInteger(value) ? Number(value.toFixed(6)) : value;
  const text = String(normalized);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

class DashcamTelemetryParser {
  constructor(buffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this._config = null;
    this._mdat = null;
  }

  extractTimeline() {
    const { durations } = this.getConfig();
    const { offset, size } = this.findMdat();
    const samples = [];
    const end = offset + size;

    let cursor = offset;
    let frameIndex = 0;
    let elapsedMs = 0;
    let pendingSei = null;

    while (cursor + 4 <= end) {
      const nalSize = this.view.getUint32(cursor);
      cursor += 4;

      if (!Number.isFinite(nalSize) || nalSize < 1 || cursor + nalSize > this.view.byteLength) {
        break;
      }

      const nal = new Uint8Array(this.buffer, cursor, nalSize);
      const nalType = nal[0] & 0x1f;

      if (nalType === 6) {
        pendingSei = this.decodeSei(nal);
      } else if (nalType === 5 || nalType === 1) {
        const durationMs = durations[frameIndex] ?? durations[durations.length - 1] ?? DEFAULT_FRAME_DURATION_MS;
        if (pendingSei) {
          samples.push({
            frameIndex,
            timeMs: elapsedMs,
            timeSeconds: Number((elapsedMs / 1000).toFixed(3)),
            durationMs,
            ...pendingSei
          });
        }
        elapsedMs += durationMs;
        frameIndex += 1;
        pendingSei = null;
      }

      cursor += nalSize;
    }

    return {
      available: samples.length > 0,
      sampleCount: samples.length,
      totalFrames: frameIndex,
      durationMs: elapsedMs,
      samples
    };
  }

  getConfig() {
    if (this._config) return this._config;

    const moov = this.findBox(0, this.view.byteLength, 'moov');
    const { mdia, stbl } = this.findVideoTrackBoxes(moov);
    const mdhd = this.findBox(mdia.start, mdia.end, 'mdhd');
    const stts = this.findBox(stbl.start, stbl.end, 'stts');
    const mdhdVersion = this.view.getUint8(mdhd.start);
    const timescale = mdhdVersion === 1 ? this.view.getUint32(mdhd.start + 20) : this.view.getUint32(mdhd.start + 12);
    const entryCount = this.view.getUint32(stts.start + 4);
    const durations = [];

    let cursor = stts.start + 8;
    for (let index = 0; index < entryCount; index += 1) {
      const count = this.view.getUint32(cursor);
      const delta = this.view.getUint32(cursor + 4);
      const durationMs = timescale ? (delta / timescale) * 1000 : DEFAULT_FRAME_DURATION_MS;
      for (let repeat = 0; repeat < count; repeat += 1) {
        durations.push(durationMs);
      }
      cursor += 8;
    }

    this._config = { durations };
    return this._config;
  }

  findVideoTrackBoxes(moov) {
    const tracks = this.findBoxes(moov.start, moov.end, 'trak');

    for (const track of tracks) {
      try {
        const mdia = this.findBox(track.start, track.end, 'mdia');
        const hdlr = this.findBox(mdia.start, mdia.end, 'hdlr');
        const handlerType = this.readAscii(hdlr.start + 8, 4);
        if (handlerType !== 'vide') continue;

        const minf = this.findBox(mdia.start, mdia.end, 'minf');
        const stbl = this.findBox(minf.start, minf.end, 'stbl');
        return { mdia, stbl };
      } catch (error) {
        continue;
      }
    }

    throw new Error('Video track not found');
  }

  findMdat() {
    if (this._mdat) return this._mdat;
    const mdat = this.findBox(0, this.view.byteLength, 'mdat');
    this._mdat = { offset: mdat.start, size: mdat.size };
    return this._mdat;
  }

  decodeSei(nal) {
    if (nal.length < 4) return null;
    if ((nal[0] & 0x1f) !== 6 || nal[1] !== 5) return null;

    let cursor = 3;
    while (cursor < nal.length && nal[cursor] === 0x42) {
      cursor += 1;
    }

    if (cursor <= 3 || cursor + 1 >= nal.length || nal[cursor] !== 0x69) {
      return null;
    }

    try {
      const message = SEI_TYPE.decode(this.stripEmulationBytes(nal.subarray(cursor + 1, nal.length - 1)));
      return normalizeMessage(message);
    } catch (error) {
      return null;
    }
  }

  stripEmulationBytes(data) {
    const output = [];
    let zeroCount = 0;

    for (const byte of data) {
      if (zeroCount >= 2 && byte === 0x03) {
        zeroCount = 0;
        continue;
      }
      output.push(byte);
      zeroCount = byte === 0 ? zeroCount + 1 : 0;
    }

    return Uint8Array.from(output);
  }

  findBoxes(start, end, name) {
    const matches = [];
    for (let cursor = start; cursor + 8 <= end;) {
      const box = this.readBox(cursor, end);
      if (!box) break;
      if (box.type === name) {
        matches.push(box);
      }
      cursor += box.totalSize;
    }
    return matches;
  }

  findBox(start, end, name) {
    for (let cursor = start; cursor + 8 <= end;) {
      const box = this.readBox(cursor, end);
      if (!box) break;
      if (box.type === name) {
        return box;
      }
      cursor += box.totalSize;
    }
    throw new Error(`MP4 box "${name}" not found`);
  }

  readBox(cursor, end) {
    if (cursor + 8 > end) return null;

    let totalSize = this.view.getUint32(cursor);
    let headerSize = 8;
    const type = this.readAscii(cursor + 4, 4);

    if (totalSize === 1) {
      if (cursor + 16 > end) return null;
      const high = this.view.getUint32(cursor + 8);
      const low = this.view.getUint32(cursor + 12);
      totalSize = Number((BigInt(high) << 32n) | BigInt(low));
      headerSize = 16;
    } else if (totalSize === 0) {
      totalSize = end - cursor;
    }

    if (!Number.isFinite(totalSize) || totalSize < headerSize) {
      return null;
    }

    return {
      type,
      totalSize,
      start: cursor + headerSize,
      end: cursor + totalSize,
      size: totalSize - headerSize
    };
  }

  readAscii(start, length) {
    let value = '';
    for (let index = 0; index < length; index += 1) {
      value += String.fromCharCode(this.view.getUint8(start + index));
    }
    return value;
  }
}

function normalizeMessage(message) {
  const speedMps = safeNumber(message.vehicleSpeedMps);
  const headingDeg = safeNumber(message.headingDeg);
  const latitudeDeg = safeNumber(message.latitudeDeg);
  const longitudeDeg = safeNumber(message.longitudeDeg);
  const accelerationX = safeNumber(message.linearAccelerationMps2X);
  const accelerationY = safeNumber(message.linearAccelerationMps2Y);
  const accelerationZ = safeNumber(message.linearAccelerationMps2Z);

  return {
    version: safeNumber(message.version),
    frameSeqNo: safeIntegerLike(message.frameSeqNo),
    gearState: GEAR_STATE_LABELS[message.gearState] ?? 'Unknown',
    gearStateId: safeNumber(message.gearState),
    vehicleSpeedMps: speedMps,
    vehicleSpeedKph: speedMps === null ? null : Number((speedMps * 3.6).toFixed(1)),
    acceleratorPedalPosition: safeNumber(message.acceleratorPedalPosition),
    steeringWheelAngle: safeNumber(message.steeringWheelAngle),
    blinkerOnLeft: Boolean(message.blinkerOnLeft),
    blinkerOnRight: Boolean(message.blinkerOnRight),
    brakeApplied: Boolean(message.brakeApplied),
    autopilotState: AUTOPILOT_STATE_LABELS[message.autopilotState] ?? 'Unknown',
    autopilotStateId: safeNumber(message.autopilotState),
    latitudeDeg,
    longitudeDeg,
    headingDeg,
    linearAccelerationMps2X: accelerationX,
    linearAccelerationMps2Y: accelerationY,
    linearAccelerationMps2Z: accelerationZ,
    hasGpsFix: latitudeDeg !== null && longitudeDeg !== null,
    accelerationMagnitude:
      accelerationX === null || accelerationY === null || accelerationZ === null
        ? null
        : Number(Math.hypot(accelerationX, accelerationY, accelerationZ).toFixed(3))
  };
}

function safeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeIntegerLike(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value && typeof value.toString === 'function') {
    return value.toString();
  }
  return null;
}
