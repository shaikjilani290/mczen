export const VOICE_PROTOCOL = "mczen-voice.v1";
const AUDIO_HEADER_BYTES = 11;
const FRAME_SAMPLES = 1600;
const FRAME_INTERVAL_MS = 100;
const MAX_PENDING_SAMPLES = 32000;
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
  if (issue?.message?.startsWith("AudioWorklet")) return issue.message;
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
    onMetrics = noop,
    onDiagnostic = noop,
    audioDiagnostics = false,
    fetchFn = globalThis.fetch?.bind(globalThis),
    WebSocketImpl = globalThis.WebSocket,
    mediaDevices = globalThis.navigator?.mediaDevices,
    audioContextFactory = () => {
      const AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextImpl) throw new Error("Web Audio is not supported in this browser.");
      return new AudioContextImpl({ sampleRate: 16000 });
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
    this.onMetrics = onMetrics;
    this.onDiagnostic = onDiagnostic;
    this.audioDiagnostics = audioDiagnostics === true &&
      ["localhost", "127.0.0.1", "[::1]"].includes(globalThis.location?.hostname);
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
    this.captureTimer = null;
    this.sendTimer = null;
    this.captureGeneration = 0;
    this.pendingFrames = [];
    this.inFlight = new Map();
    this.flowControl = false;
    this.serverPaused = false;
    this.lastSendAt = -Infinity;
    this.metrics = { capturedMs: 0, sentMs: 0, captureCallbackMs: 0, captureDeliveryMs: 0, captureQueueMs: 0 };
    this.lastMetricsAt = 0;
    this.pingAt = null;
    this.lastPingAt = -Infinity;
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
    this.startupAbort = null;
    this.cancelStartup = null;
    this.startupStage = "idle";
  }

  diagnose(stage) {
    this.startupStage = stage;
    this.onDiagnostic({ stage, elapsedMs: Math.round(performance.now() - (this.startupAt ?? performance.now())) });
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
    this.lastSendAt = -Infinity;
    this.lastPingAt = -Infinity;
    this.pingAt = null;
    this.metrics = { capturedMs: 0, sentMs: 0, captureCallbackMs: 0, captureDeliveryMs: 0, captureQueueMs: 0 };
    this.reconnectAttempts = 0;
    this.disposed = false;
    this.shouldReconnect = true;
    this.startupAt = performance.now();
    this.diagnose("start_requested");
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
    this.startupAbort?.abort();
    this.startupAbort = null;
    this.cancelStartup?.();
    this.cancelStartup = null;
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
    this.pendingFrames = [];
    this.inFlight.clear();
    this.flowControl = false;
    this.serverPaused = false;
    this.setState("idle");
  }

  interrupt() {
    if (!this.socket || this.socket.readyState !== 1) return;
    this.clearPlayback();
    this.epoch = (this.epoch + 1) >>> 0;
    this.pendingSamples = new Float32Array(0);
    this.resetCaptureEpoch();
    this.sendEvent("voice.assistant.interrupt", {});
    this.setState("interrupted");
  }

  setState(state) {
    this.onState(state);
  }

  async fetchTicket(signal) {
    if (this.ticketProvider) return this.ticketProvider({ signal });
    const response = await this.fetchFn("/api/voice/ticket", {
      method: "POST",
      credentials: "same-origin",
      signal,
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
    const abort = new AbortController();
    this.startupAbort = abort;
    this.diagnose("ticket_requested");
    let timer;
    let cancelled;
    const ticket = await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        this.diagnose("ticket_timeout");
        reject(new Error("Voice session creation timed out. The voice-ticket API did not respond."));
        abort.abort();
      }, 12_000);
      cancelled = () => reject(new Error("Voice startup was cancelled."));
      abort.signal.addEventListener("abort", cancelled, { once: true });
      Promise.resolve().then(() => this.fetchTicket(abort.signal)).then(resolve, (error) => {
        if (!abort.signal.aborted) this.diagnose("ticket_failed");
        reject(error);
      });
    }).finally(() => {
      clearTimeout(timer);
      abort.signal.removeEventListener("abort", cancelled);
    });
    if (abort.signal.aborted || this.disposed) throw new Error("Voice startup was cancelled.");
    this.startupAbort = null;
    this.diagnose("ticket_received");
    this.diagnose("websocket_connecting");
    const resumingSession = resume && typeof this.resumeToken === "string";
    const socket = new this.WebSocketImpl(this.webSocketUrl(), VOICE_PROTOCOL);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    return new Promise((resolve, reject) => {
      let settled = false;
      let restartSession = false;
      let timeout = setTimeout(() => {
        if (settled) return;
        const stage = this.startupStage;
        this.diagnose("connection_timeout");
        finish(new Error(stage === "awaiting_session_ack"
          ? "Voice connection timed out: the server did not acknowledge the session."
          : "Voice connection timed out: the WebSocket could not open. Check the API address and proxy."));
        socket.close();
      }, 12_000);
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.cancelStartup = null;
        if (error) reject(error);
        else resolve();
      };
      this.cancelStartup = () => finish(new Error("Voice startup was cancelled."));
      const sessionStarted = () => {
        if (settled) return;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          if (settled) return;
          this.diagnose("microphone_timeout");
          finish(new Error("Microphone startup timed out. Check microphone permission and your audio device, then try again."));
          socket.close();
        }, 60_000);
      };
      socket.onopen = () => {
        this.diagnose("websocket_open");
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
        this.diagnose("awaiting_session_ack");
      };
      socket.onmessage = (event) => {
        if (this.socket === socket) void this.handleMessage(event.data, finish, sessionStarted, resumingSession ? () => {
          restartSession = true;
          this.resumeToken = null;
          this.sessionId = null;
          this.diagnose("resume_unavailable_starting_new_session");
          finish(new Error("The previous voice session is unavailable."));
          return true;
        } : undefined);
      };
      socket.onerror = () => {
        this.diagnose("websocket_error");
        if (!settled) finish(new Error("Voice connection failed. Check your network and try again."));
      };
      socket.onclose = (event) => {
        this.diagnose(`socket_closed_${event.code}`);
        if (!settled) finish(new Error(event.code === 4401
          ? "Voice authentication failed. Please sign in again."
          : event.code === 4503
          ? "Local voice services are unavailable. Start the STT, VAD and TTS services, or continue with text."
          : "Voice connection closed before the session started."));
        if (this.socket !== socket) return;
        this.socket = null;
        this.clearPlayback();
        void this.releaseAudio();
        if (!restartSession && ![1001, 1006, 1011, 1012, 1013, 4408].includes(event.code)) this.shouldReconnect = false;
        if (this.shouldReconnect && !this.disposed) this.scheduleReconnect();
        else if (!this.disposed) this.setState("error");
      };
    });
  }

  async handleMessage(data, finish = noop, sessionStarted = noop, recoverResume) {
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
    if (event.type === "voice.audio.ack") {
      if ((event.data.audioEpoch ?? event.epoch) !== this.epoch) return;
      const frame = this.inFlight.get(event.data.sequence);
      if (frame) {
        this.metrics.captureToVadMs = performance.now() - frame.capturedAt;
        this.inFlight.delete(event.data.sequence);
      }
      this.serverPaused = event.data.paused === true;
      Object.assign(this.metrics, { backendQueueMs: event.data.queueMs, backendQueueDepth: event.data.queueDepth,
        vadMs: event.data.vadMs, backendProcessingMs: event.data.processingMs });
      this.metrics.maxBackendQueueMs = Math.max(this.metrics.maxBackendQueueMs ?? 0, event.data.queueMs ?? 0);
      this.metrics.maxCaptureToVadMs = Math.max(this.metrics.maxCaptureToVadMs ?? 0, this.metrics.captureToVadMs ?? 0);
      this.flushCapture();
      this.reportMetrics();
      return;
    }
    if (event.type === "voice.audio.flow") {
      this.serverPaused = event.data.paused === true;
      this.flushCapture();
      return;
    }
    if (event.type === "voice.session.pong") {
      if (this.pingAt !== null && event.data.clientTime === this.pingAt) {
        this.metrics.roundTripMs = performance.now() - this.pingAt;
        this.pingAt = null;
      }
      return;
    }
    if (event.type === "voice.speech.started") {
      // TTS generation may have ended while its scheduled audio is still playing.
      if (this.playing.size) this.clearPlayback();
      const frame = this.inFlight.get(event.data.sequence);
      this.utteranceCaptureAt = frame ? frame.capturedAt - frame.audioMs + event.data.offsetMs : undefined;
      this.outputGenerationEnded = false;
      this.metrics.turnId = event.data.turnId;
      this.metrics.firstPlaybackMs = undefined;
      this.metrics.completePlaybackMs = undefined;
      return;
    }
    if (event.sessionId) this.sessionId = event.sessionId;
    const eventEpoch = Number.isInteger(event.epoch) ? event.epoch : event.data.epoch;
    if (Number.isInteger(eventEpoch) && eventEpoch !== this.epoch) {
      const normalCompletion = event.type === "voice.assistant.epoch" && event.data.reason === "turn_reset";
      // Generation can finish before already-scheduled speech finishes playing.
      if (eventEpoch > this.epoch && !normalCompletion) this.clearPlayback();
      this.epoch = eventEpoch >>> 0;
      this.pendingSamples = new Float32Array(0);
      this.resetCaptureEpoch();
    }
    if (event.type === "voice.session.started" || event.type === "voice.session.resumed") {
      if (typeof event.sessionId !== "string" || !Number.isInteger(event.epoch)) {
        this.diagnose("invalid_session_ack");
        finish(new Error("The voice service sent an invalid session acknowledgement."));
        return;
      }
      this.diagnose("session_acknowledged");
      sessionStarted();
      this.setState("requesting_microphone");
      this.flowControl = event.data.flowControl === "ack-v1";
      this.reconnectAttempts = 0;
      try {
        if (await this.startAudioCapture() === false) return;
        this.setState("listening");
        this.diagnose("audio_ready");
        finish();
      } catch (issue) {
        const message = microphoneError(issue);
        finish(new Error(message));
        this.onError(message);
        await this.stop();
      }
    } else if (event.type === "voice.assistant.thinking") {
      this.setState(event.data.hint === "transcribing" ? "transcribing" : "processing");
    } else if (event.type === "voice.transcript.final") {
      Object.assign(this.metrics, { sttMs: event.data.sttMs, transcriptionLatencyMs: event.data.durationMs,
        utteranceAudioMs: event.data.audioMs,
        endToEndTranscriptionMs: this.utteranceCaptureAt === undefined ? undefined : performance.now() - this.utteranceCaptureAt });
      this.reportMetrics(true);
    } else if (event.type === "voice.assistant.epoch" &&
        (event.data.reason === "turn_reset" || event.data.reason === "recovered")) {
      this.setState("listening");
    } else if (event.type === "voice.assistant.response" || event.type === "voice.assistant.audio.chunk") {
      if (event.data.agentMs !== undefined) this.metrics.agentMs = event.data.agentMs;
      if (event.data.ttsFirstAudioMs !== undefined) this.metrics.ttsFirstAudioMs = event.data.ttsFirstAudioMs;
      this.setState("speaking");
    } else if (event.type === "voice.assistant.audio.end") {
      Object.assign(this.metrics, event.data.timing ?? {}, { outputAudioMs: event.data.totalMs });
      this.outputGenerationEnded = true;
      this.reportMetrics(true);
    } else if (event.type === "voice.assistant.interrupt") {
      this.clearPlayback();
      this.setState("interrupted");
    } else if (event.type === "voice.assistant.turn.end") {
      this.setState("listening");
    } else if (event.type === "voice.session.error") {
      this.diagnose("server_rejected_session");
      if (event.data.code === "SESSION_MISMATCH" && recoverResume?.()) return;
      if (event.data.code === "UNAUTHORIZED" || !event.data.recoverable) this.shouldReconnect = false;
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
    const generation = ++this.captureGeneration;
    this.diagnose("microphone_requested");
    const stream = await this.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    if (generation !== this.captureGeneration || !this.shouldReconnect) {
      for (const track of stream.getTracks()) track.stop();
      return false;
    }
    this.stream = stream;
    this.diagnose("microphone_granted");
    this.audioContext = this.audioContextFactory();
    if (this.audioDiagnostics) {
      const settings = stream.getAudioTracks?.()[0]?.getSettings?.() ?? {};
      this.onDiagnostic({ stage: "audio_format", sessionId: this.sessionId,
        deviceSampleRate: settings.sampleRate, deviceChannels: settings.channelCount,
        sampleSize: settings.sampleSize, contextSampleRate: this.audioContext.sampleRate,
        wireSampleRate: 16000, wireChannels: 1, encoding: "pcm_s16le",
        echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl });
    }
    this.nextAudioTime = this.audioContext.currentTime;
    this.diagnose("audio_context_starting");
    await this.audioContext.resume?.();
    if (generation !== this.captureGeneration) return false;
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;
    if (this.audioContext.audioWorklet && globalThis.AudioWorkletNode) {
      this.diagnose("worklet_loading");
      const url = URL.createObjectURL(new Blob([captureWorkletSource], { type: "text/javascript" }));
      try {
        await this.audioContext.audioWorklet.addModule(url);
      } catch {
        throw new Error("AudioWorklet capture could not load. Check the browser CSP permits blob: AudioWorklet modules.");
      } finally {
        URL.revokeObjectURL(url);
      }
      if (generation !== this.captureGeneration) return false;
      this.processor = new AudioWorkletNode(this.audioContext, "mczen-capture", {
        processorOptions: { audioDiagnostics: this.audioDiagnostics },
        channelCount: 1, channelCountMode: "explicit", numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      });
      this.processor.port.onmessage = ({ data }) => {
        const started = performance.now();
        if (generation !== this.captureGeneration) return;
        if (data.type === "diagnostics" && this.audioDiagnostics) {
          this.onDiagnostic({ stage: "audio_levels", sessionId: this.sessionId,
            epoch: data.epoch, source: data.source, resampled: data.resampled });
          return;
        }
        if (data.type === "overflow") return this.captureOverflow();
        if (data.type !== "audio" || data.epoch !== this.epoch) return;
        const now = performance.now();
        this.metrics.capturedMs += data.pcm.length / 16;
        this.metrics.captureQueueMs = data.bufferedMs;
        this.metrics.maxCaptureQueueMs = Math.max(this.metrics.maxCaptureQueueMs ?? 0, data.bufferedMs);
        this.metrics.captureDeliveryMs = Math.max(0, (this.audioContext.currentTime - data.capturedAt) * 1000);
        this.pendingFrames.push({ pcm: data.pcm, capturedAt: now - this.metrics.captureDeliveryMs });
        this.flushCapture();
        this.metrics.captureCallbackMs = performance.now() - started;
      };
      this.processor.port.postMessage({ type: "reset", epoch: this.epoch });
      this.metrics.captureMode = "AudioWorklet";
    } else {
      this.metrics.captureMode = "ScriptProcessor";
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (event) => {
        const started = performance.now();
        if (!this.shouldReconnect || !this.socket || this.socket.readyState !== 1) return;
        const samples = resampleTo16k(event.inputBuffer.getChannelData(0), this.audioContext.sampleRate);
        const joined = new Float32Array(this.pendingSamples.length + samples.length);
        joined.set(this.pendingSamples);
        joined.set(samples, this.pendingSamples.length);
        if (joined.length > MAX_PENDING_SAMPLES) {
          this.captureOverflow();
          return;
        }
        this.pendingSamples = joined;
        this.metrics.capturedMs += samples.length / 16;
        this.metrics.captureCallbackMs = performance.now() - started;
        this.flushCapture();
      };
    }
    this.source.connect(this.processor);
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.audioContext.destination);
    const retry = () => {
      this.captureTimer = null;
      if (generation !== this.captureGeneration || !this.shouldReconnect) return;
      this.flushCapture();
      const now = performance.now();
      if (this.flowControl && now - this.lastPingAt >= 5000) {
        this.pingAt = now;
        this.lastPingAt = now;
        this.sendEvent("voice.session.ping", { clientTime: now });
      }
      this.reportMetrics();
      this.captureTimer = setTimeout(retry, FRAME_INTERVAL_MS);
    };
    this.captureTimer = setTimeout(retry, FRAME_INTERVAL_MS);
  }

  resetCaptureEpoch() {
    this.pendingFrames = [];
    this.inFlight.clear();
    this.serverPaused = false;
    this.metrics.captureQueueMs = 0;
    this.utteranceCaptureAt = undefined;
    this.processor?.port?.postMessage({ type: "reset", epoch: this.epoch });
  }

  captureOverflow() {
    this.onError("Microphone audio exceeded the 2-second buffer while processing was paused. Voice stopped to avoid transcribing incomplete speech. Please start again.");
    void this.stop();
  }

  flushCapture() {
    this.metrics.maxWebSocketBufferedBytes = Math.max(this.metrics.maxWebSocketBufferedBytes ?? 0, this.socket?.bufferedAmount ?? 0);
    if (!this.shouldReconnect || this.socket?.readyState !== 1 || this.serverPaused) return;
    if (!this.pendingFrames.length && this.pendingSamples.length < FRAME_SAMPLES) return;
    const now = performance.now();
    const inFlightBytes = [...this.inFlight.values()].reduce((sum, frame) => sum + frame.bytes, 0);
    if (this.flowControl && inFlightBytes >= 16000) return;
    // Schedule against the last actual send, not a drifting polling interval.
    const delay = Math.max(0, 50 - (now - this.lastSendAt));
    if (delay > 0 || this.socket.bufferedAmount > 6400) {
      if (this.sendTimer === null) this.sendTimer = setTimeout(() => {
        this.sendTimer = null;
        this.flushCapture();
      }, Math.max(delay, this.socket.bufferedAmount > 6400 ? 50 : 1));
      return;
    }
    let frame = this.pendingFrames.shift();
    let credits = frame ? 1 : 0;
    if (frame && this.pendingFrames.length && (!this.flowControl || inFlightBytes <= 9600)) {
      const next = this.pendingFrames.shift();
      const pcm = new Int16Array(frame.pcm.length + next.pcm.length);
      pcm.set(frame.pcm);
      pcm.set(next.pcm, frame.pcm.length);
      frame = { pcm, capturedAt: next.capturedAt };
      credits++;
    }
    if (!frame && this.pendingSamples.length >= FRAME_SAMPLES) {
      frame = { pcm: floatToPcm16(this.pendingSamples.subarray(0, FRAME_SAMPLES)),
        capturedAt: now - this.pendingSamples.length / 16 + FRAME_INTERVAL_MS };
      this.pendingSamples = this.pendingSamples.slice(FRAME_SAMPLES);
    }
    if (!frame) return;
    this.socket.send(encodeAudioFrame({ epoch: this.epoch, sequence: this.sequence, pcm: frame.pcm }));
    if (this.flowControl) this.inFlight.set(this.sequence, {
      capturedAt: frame.capturedAt, audioMs: frame.pcm.length / 16, bytes: frame.pcm.byteLength,
    });
    this.sequence = (this.sequence + 1) >>> 0;
    this.lastSendAt = now;
    this.metrics.sentMs += frame.pcm.length / 16;
    this.metrics.chunkMs = frame.pcm.length / 16;
    this.metrics.chunkBytes = frame.pcm.byteLength;
    if (credits) this.processor?.port?.postMessage({ type: "credit", epoch: this.epoch, count: credits });
    if (this.pendingFrames.length || this.pendingSamples.length >= FRAME_SAMPLES) this.flushCapture();
  }

  reportMetrics(force = false) {
    const now = performance.now();
    if (!force && now - this.lastMetricsAt < 5000) return;
    this.lastMetricsAt = now;
    this.onMetrics({ ...this.metrics, sampleRate: this.audioContext?.sampleRate, wireSampleRate: 16000,
      sessionId: this.sessionId,
      encoding: "pcm_s16le", channels: 1, sequence: this.sequence, timestampMs: now,
      webSocketBufferedBytes: this.socket?.bufferedAmount ?? 0, unacknowledgedPackets: this.inFlight.size,
      pendingMs: this.pendingSamples.length / 16 + this.pendingFrames.reduce((n, f) => n + f.pcm.length / 16, 0) });
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
    if (this.metrics.firstPlaybackMs === undefined && this.utteranceCaptureAt !== undefined) {
      this.metrics.firstPlaybackMs = performance.now() - this.utteranceCaptureAt + Math.max(0, when - this.audioContext.currentTime) * 1000;
      this.reportMetrics(true);
    }
    source.onended = () => {
      this.playing.delete(source);
      if (!this.playing.size && this.outputGenerationEnded && this.utteranceCaptureAt !== undefined) {
        this.metrics.completePlaybackMs = performance.now() - this.utteranceCaptureAt;
        this.reportMetrics(true);
      }
    };
    source.start(when);
  }

  clearPlayback() {
    this.outputGenerationEnded = false;
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
    if (!this.shouldReconnect || this.disposed) return;
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
      if (!this.shouldReconnect || this.disposed) return;
      void this.openSocket(true).catch(error => {
        this.diagnose("reconnect_attempt_failed");
        if (error?.code === "expired" || error?.code === "unavailable") {
          this.shouldReconnect = false;
          this.setState("error");
          this.onError(error.message);
          return;
        }
        this.scheduleReconnect();
      });
    }, delay);
  }

  async releaseAudio() {
    this.captureGeneration++;
    if (this.captureTimer !== null) clearTimeout(this.captureTimer);
    if (this.sendTimer !== null) clearTimeout(this.sendTimer);
    this.captureTimer = null;
    this.sendTimer = null;
    if (this.processor) {
      if (this.processor.port) {
        this.processor.port.onmessage = null;
        this.processor.port.close();
      }
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
    this.pendingFrames = [];
    this.inFlight.clear();
    const context = this.audioContext;
    this.audioContext = null;
    if (context && context.state !== "closed") await context.close().catch(() => {});
  }
}
import { captureWorkletSource } from "./capture-worklet.js";
