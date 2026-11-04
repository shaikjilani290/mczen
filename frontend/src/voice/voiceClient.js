export const VOICE_PROTOCOL = "mczen-voice.v1";
const AUDIO_HEADER_BYTES = 11;
const FRAME_SAMPLES = 800;
const AUDIO_FORMAT = "pcm_s16le/16000/mono";

export function resampleTo16k(samples, sourceRate) {
  if (!(samples instanceof Float32Array) || !Number.isFinite(sourceRate) || sourceRate <= 0) {
    throw new TypeError("Audio samples and sample rate are required.");
  }
  if (sourceRate === 16000) return new Float32Array(samples);
  const length = Math.floor((samples.length * 16000) / sourceRate);
  const output = new Float32Array(length);
  const ratio = sourceRate / 16000;
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const fraction = position - left;
    const a = samples[Math.min(left, samples.length - 1)] || 0;
    const b = samples[Math.min(left + 1, samples.length - 1)] || 0;
    output[index] = a + (b - a) * fraction;
  }
  return output;
}

export function floatToPcm16(samples) {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
  }
  return pcm;
}

export function encodeAudioFrame({ type = 1, epoch, sequence, pcm }) {
  if ((type !== 1 && type !== 2) || !Number.isInteger(epoch) || epoch < 0 ||
      !Number.isInteger(sequence) || sequence < 0 || !(pcm instanceof Int16Array) ||
      pcm.length === 0 || pcm.byteLength > 14400) {
    throw new TypeError("Invalid voice audio frame.");
  }
  const frame = new ArrayBuffer(AUDIO_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(frame);
  view.setUint8(0, type);
  view.setUint32(1, epoch >>> 0);
  view.setUint32(5, sequence >>> 0);
  view.setUint16(9, pcm.byteLength);
  for (let index = 0; index < pcm.length; index += 1) {
    view.setInt16(AUDIO_HEADER_BYTES + index * 2, pcm[index], true);
  }
  return frame;
}

export function decodeAudioFrame(frame) {
  if (!(frame instanceof ArrayBuffer) || frame.byteLength <= AUDIO_HEADER_BYTES) return null;
  const view = new DataView(frame);
  const type = view.getUint8(0);
  const length = view.getUint16(9);
  if (type !== 2 || length === 0 || length % 2 !== 0 ||
      length > 14400 || frame.byteLength !== AUDIO_HEADER_BYTES + length) return null;
  const pcm = new Int16Array(length / 2);
  for (let index = 0; index < pcm.length; index += 1) {
    pcm[index] = view.getInt16(AUDIO_HEADER_BYTES + index * 2, true);
  }
  return {
    epoch: view.getUint32(1),
    sequence: view.getUint32(5),
    pcm,
  };
}

const noop = () => {};

function microphoneError(issue) {
  if (issue?.message === "Web Audio is not supported in this browser.") return issue.message;
  if (issue?.name === "NotAllowedError" || issue?.name === "SecurityError") {
    return "Microphone access was denied. Allow microphone access and try again.";
  }
  if (issue?.name === "NotFoundError") return "No microphone was found. Connect a microphone and try again.";
  if (issue?.name === "NotReadableError") return "The microphone is busy in another application.";
  return "Microphone access is required. Check your device permissions and try again.";
}

export class VoiceClient {
  constructor({
    onEvent = noop,
    onState = noop,
    onError = noop,
    fetchFn = globalThis.fetch?.bind(globalThis),
    WebSocketImpl = globalThis.WebSocket,
    mediaDevices = globalThis.navigator?.mediaDevices,
    audioContextFactory = () => {
      const AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextImpl) throw new Error("Web Audio is not supported in this browser.");
      return new AudioContextImpl();
    },
    ticketProvider = null,
    webSocketUrl = () => {
      const scheme = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
      return `${scheme}//${globalThis.location.host}/api/voice/stream`;
    },
  } = {}) {
    this.onEvent = onEvent;
    this.onState = onState;
    this.onError = onError;
    this.fetchFn = fetchFn;
    this.WebSocketImpl = WebSocketImpl;
    this.mediaDevices = mediaDevices;
    this.audioContextFactory = audioContextFactory;
    this.webSocketUrl = webSocketUrl;
    this.ticketProvider = ticketProvider;
    this.socket = null;
    this.stream = null;
    this.audioContext = null;
    this.source = null;
    this.processor = null;
    this.silentGain = null;
    this.pendingSamples = new Float32Array(0);
    this.playing = new Set();
    this.nextAudioTime = 0;
    this.epoch = 0;
    this.sequence = 0;
    this.sessionId = null;
    this.resumeToken = null;
    this.accessToken = null;
    this.options = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.shouldReconnect = false;
    this.disposed = false;
  }

  async start(accessToken, options) {
    await this.stop();
    if (!this.fetchFn || !this.WebSocketImpl) throw new Error("WebSocket audio is not supported in this browser.");
    if (!this.mediaDevices?.getUserMedia || !this.audioContextFactory) {
      throw new Error("Microphone audio is not supported in this browser.");
    }
    this.accessToken = accessToken;
    this.options = { ...options };
    this.sessionId = null;
    this.resumeToken = null;
    this.sequence = 0;
    this.reconnectAttempts = 0;
    this.disposed = false;
    this.shouldReconnect = true;
    this.setState("connecting");
    try {
      await this.openSocket(false);
    } catch (error) {
      await this.stop();
      this.setState("error");
      throw error;
    }
  }

  async stop() {
    this.shouldReconnect = false;
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.sendEvent("voice.session.close", { reason: "user_stop" });
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < 2) socket.close(1000, "CLOSED");
    await this.releaseAudio();
    this.clearPlayback();
    this.accessToken = null;
    this.options = null;
    this.sessionId = null;
    this.resumeToken = null;
    this.pendingSamples = new Float32Array(0);
    this.setState("idle");
  }

  interrupt() {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.clearPlayback();
    this.epoch = (this.epoch + 1) >>> 0;
    this.sendEvent("voice.assistant.interrupt", {});
    this.setState("interrupted");
  }

  setState(state) {
    this.onState(state);
  }

  async fetchTicket() {
    if (this.ticketProvider) return this.ticketProvider();
    const response = await this.fetchFn("/api/voice/ticket", {
      method: "POST",
      credentials: "same-origin",
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    const ticketData = await response.json().catch(() => ({}));
    if (!response.ok || typeof ticketData.ticket !== "string") {
      throw new Error(response.status === 401
        ? "Your sign-in has expired. Please sign in again."
        : "Voice connection could not be authenticated.");
    }
    return ticketData.ticket;
  }
  async openSocket(resume) {
    const ticket = await this.fetchTicket();
    const socket = new this.WebSocketImpl(this.webSocketUrl(), VOICE_PROTOCOL);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error("Voice connection timed out. Please try again."));
      }, 12_000);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      socket.onopen = () => {
        const data = resume && this.resumeToken
          ? {
              ticket,
              resumeToken: this.resumeToken,
              lastEpoch: this.epoch,
            }
          : {
              ticket,
              assistantId: this.options.assistantId,
              conversationId: this.options.conversationId,
              language: this.options.language,
              ...(this.options.voiceId ? { voiceId: this.options.voiceId } : {}),
              audioFormat: AUDIO_FORMAT,
            };
        socket.send(JSON.stringify({
          v: 1,
          type: "voice.session.start",
          ts: new Date().toISOString(),
          data,
        }));
      };
      socket.onmessage = (event) => {
        void this.handleMessage(event.data, finish);
      };
      socket.onerror = () => {
        if (!settled) finish(new Error("Voice connection failed. Check your network and try again."));
      };
      socket.onclose = (event) => {
        if (!settled) finish(new Error(event.code === 4401
          ? "Voice authentication failed. Please sign in again."
          : event.code === 4503
          ? "Local voice services are unavailable. Start the STT, VAD and TTS services, or continue with text."
          : "Voice connection closed before the session started."));
        if (this.socket === socket) this.socket = null;
        this.clearPlayback();
        void this.releaseAudio();
        if (this.shouldReconnect && !this.disposed) this.scheduleReconnect();
      };
    });
  }

  async handleMessage(data, finish = noop) {
    if (typeof data !== "string") {
      const buffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer?.();
      const frame = decodeAudioFrame(buffer);
      if (frame) this.queuePlayback(frame);
      return;
    }
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      this.onError("The voice service sent an invalid response.");
      return;
    }
    if (event?.v !== 1 || typeof event.type !== "string" || !event.data) return;
    if (event.type === "voice.session.resume_token") {
      if (typeof event.data.token === "string") this.resumeToken = event.data.token;
      return;
    }
    if (event.sessionId) this.sessionId = event.sessionId;
    const eventEpoch = Number.isInteger(event.epoch) ? event.epoch : event.data.epoch;
    if (Number.isInteger(eventEpoch) && eventEpoch !== this.epoch) {
      if (eventEpoch > this.epoch) this.clearPlayback();
      this.epoch = eventEpoch >>> 0;
    }
    if (event.type === "voice.session.started" || event.type === "voice.session.resumed") {
      this.reconnectAttempts = 0;
      try {
        await this.startAudioCapture();
        this.setState("listening");
        finish();
      } catch (issue) {
        this.onError(microphoneError(issue));
        await this.stop();
        finish(new Error("Microphone permission is required."));
      }
    } else if (event.type === "voice.assistant.thinking") {
      this.setState(event.data.hint === "transcribing" ? "transcribing" : "processing");
    } else if (event.type === "voice.assistant.epoch" &&
        (event.data.reason === "turn_reset" || event.data.reason === "recovered")) {
      this.setState("listening");
    } else if (event.type === "voice.assistant.response" || event.type === "voice.assistant.audio.chunk") {
      this.setState("speaking");
    } else if (event.type === "voice.assistant.interrupt") {
      this.clearPlayback();
      this.setState("interrupted");
    } else if (event.type === "voice.assistant.turn.end") {
      this.setState("listening");
    } else if (event.type === "voice.session.error") {
      if (event.data.code === "UNAUTHORIZED") this.shouldReconnect = false;
      const message = event.data.code === "VOICE_ENGINE_UNAVAILABLE"
        ? "Local voice services are unavailable. Start the STT, VAD and TTS services, or continue with text."
        : typeof event.data.message === "string" ? event.data.message : "The voice session encountered an error.";
      this.onError(message);
      if (!this.sessionId || !event.data.recoverable) finish(new Error(message));
    } else if (event.type === "voice.session.close") {
      this.shouldReconnect = false;
      await this.releaseAudio();
      this.setState("idle");
    }
    this.onEvent(event);
  }

  async startAudioCapture() {
    if (this.stream) return;
    this.stream = await this.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    this.audioContext = this.audioContextFactory();
    await this.audioContext.resume?.();
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;
    this.processor.onaudioprocess = (event) => {
      if (!this.shouldReconnect || !this.socket || this.socket.readyState !== 1) return;
      const samples = resampleTo16k(event.inputBuffer.getChannelData(0), this.audioContext.sampleRate);
      const joined = new Float32Array(this.pendingSamples.length + samples.length);
      joined.set(this.pendingSamples);
      joined.set(samples, this.pendingSamples.length);
      let offset = 0;
      while (joined.length - offset >= FRAME_SAMPLES) {
        if (this.socket.bufferedAmount > 128_000) break;
        const pcm = floatToPcm16(joined.subarray(offset, offset + FRAME_SAMPLES));
        this.socket.send(encodeAudioFrame({ epoch: this.epoch, sequence: this.sequence, pcm }));
        this.sequence = (this.sequence + 1) >>> 0;
        offset += FRAME_SAMPLES;
      }
      this.pendingSamples = joined.slice(offset);
    };
    this.source.connect(this.processor);
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.audioContext.destination);
  }

  queuePlayback(frame) {
    if (!this.audioContext || frame.epoch !== this.epoch) return;
    const buffer = this.audioContext.createBuffer(1, frame.pcm.length, 16000);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < frame.pcm.length; index += 1) channel[index] = frame.pcm[index] / 32768;
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);
    const when = Math.max(this.audioContext.currentTime + 0.02, this.nextAudioTime);
    this.nextAudioTime = when + buffer.duration;
    this.playing.add(source);
    source.onended = () => this.playing.delete(source);
    source.start(when);
  }

  clearPlayback() {
    for (const source of this.playing) {
      try { source.stop(); } catch { /* a source can finish between interruption and stop */ }
    }
    this.playing.clear();
    this.nextAudioTime = this.audioContext?.currentTime ?? 0;
  }

  sendEvent(type, data) {
    if (!this.sessionId || !this.socket || this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify({
      v: 1,
      type,
      ts: new Date().toISOString(),
      sessionId: this.sessionId,
      data,
    }));
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.reconnectAttempts >= 4) {
      if (this.reconnectAttempts >= 4) {
        this.shouldReconnect = false;
        this.setState("error");
        this.onError("Unable to reconnect to voice. Please start a new session.");
      }
      return;
    }
    this.reconnectAttempts += 1;
    this.setState("reconnecting");
    const delay = Math.min(750 * (2 ** (this.reconnectAttempts - 1)), 6000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket(true).catch(() => this.scheduleReconnect());
    }, delay);
  }

  async releaseAudio() {
    if (this.processor) {
      this.processor.onaudioprocess = null;
      this.processor.disconnect();
    }
    this.source?.disconnect();
    this.silentGain?.disconnect();
    this.processor = null;
    this.source = null;
    this.silentGain = null;
    for (const track of this.stream?.getTracks?.() ?? []) track.stop();
    this.stream = null;
    this.pendingSamples = new Float32Array(0);
    const context = this.audioContext;
    this.audioContext = null;
    if (context && context.state !== "closed") await context.close().catch(() => {});
  }
}
