"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var VoiceSessionManager_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceSessionManager = exports.MAX_TENANT_SESSIONS = exports.MAX_GLOBAL_SESSIONS = exports.MAX_SESSION_MS = void 0;
const common_1 = require("@nestjs/common");
const product_identity_service_1 = require("../website-integrations/product-identity.service");
const node_crypto_1 = require("node:crypto");
const node_v8_1 = require("node:v8");
const ws_1 = require("ws");
const conversations_service_1 = require("../conversations/conversations.service");
const uuid_1 = require("../common/ids/uuid");
const tenant_context_store_1 = require("../common/tenant/tenant-context.store");
const agent_invocation_port_1 = require("./agent-invocation.port");
const shared_state_1 = require("../shared-state/shared-state");
const voice_auth_service_1 = require("./voice-auth.service");
const voice_session_repository_1 = require("./voice-session.repository");
const voice_provider_util_1 = require("./voice-provider.util");
const stt_port_1 = require("./stt/stt.port");
const vad_port_1 = require("./vad/vad.port");
const tts_port_1 = require("./tts/tts.port");
const voice_library_service_1 = require("./voice-library.service");
const audio_diagnostics_1 = require("./audio-diagnostics");
const HEADER_BYTES = 11;
const MAX_PAYLOAD_BYTES = 14_400;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_UTTERANCE_BYTES = 640_000;
const MAX_SESSION_AUDIO_BYTES = 20 * 1024 * 1024;
exports.MAX_SESSION_MS = 60 * 60_000;
const RESUME_TTL_MS = 120_000;
const RESUME_ROTATE_MS = 30_000;
const FRAME_BYTES = 640;
const PARTIAL_WINDOW_BYTES = 3 * 32_000;
const EVENT_LIMIT = 50;
const FRAME_LIMIT = 40;
exports.MAX_GLOBAL_SESSIONS = 24;
exports.MAX_TENANT_SESSIONS = 3;
const MAX_GLOBAL_INGRESS_BYTES_PER_SECOND = 4_000 * 1024;
const SLOT_TTL_MS = 90_000;
const SLOT_RENEW_MS = 30_000;
const INSTANCE_ID = (0, node_crypto_1.randomUUID)();
const subjectOf = (identity) => identity.widget ? `w:${identity.widget.widgetSessionId}` : identity.userId;
let VoiceSessionManager = VoiceSessionManager_1 = class VoiceSessionManager {
    auth;
    persistence;
    conversations;
    stt;
    vad;
    tts;
    agent;
    store;
    library;
    productIdentity;
    logger = new common_1.Logger(VoiceSessionManager_1.name);
    sessions = new Map();
    ingressWindowStart = Date.now();
    ingressWindowBytes = 0;
    constructor(auth, persistence, conversations, stt, vad, tts, agent, store, library, productIdentity) {
        this.auth = auth;
        this.persistence = persistence;
        this.conversations = conversations;
        this.stt = stt;
        this.vad = vad;
        this.tts = tts;
        this.agent = agent;
        this.store = store;
        this.library = library;
        this.productIdentity = productIdentity;
    }
    async begin(socket, identity, input, userAgent, signal) {
        const since = performance.now();
        const diagnose = (stage) => {
            this.logger.log({ event: 'voice_session_start_stage', stage, elapsedMs: Math.round(performance.now() - since) });
        };
        const checkStartup = () => {
            if (signal?.aborted || socket.readyState !== ws_1.WebSocket.OPEN)
                throw new Error('Voice startup cancelled.');
        };
        checkStartup();
        diagnose('resolving_identity');
        rejectUnknownFields(input, ['assistantId', 'conversationId', 'language', 'resumeToken', 'lastEpoch', 'audioFormat', 'voiceId']);
        if (input.audioFormat !== undefined && input.audioFormat !== 'pcm_s16le/16000/mono') {
            return this.fail(socket, 'AUDIO_FORMAT_MISMATCH', 'Only 16 kHz mono PCM16 audio is supported.', 4410);
        }
        if (typeof input.resumeToken === 'string') {
            diagnose('resuming_session');
            await this.resume(socket, identity, input.resumeToken, input.lastEpoch, signal);
            return;
        }
        const widget = identity.widget;
        if (widget && ((input.assistantId !== undefined && input.assistantId !== widget.assistantId) ||
            (input.conversationId !== undefined && input.conversationId !== widget.conversationId))) {
            return this.fail(socket, 'INVALID_SESSION_START', 'The voice session request is invalid.', 4410);
        }
        const assistantId = widget ? widget.assistantId : input.assistantId;
        const requestedConversationId = widget ? widget.conversationId : input.conversationId;
        if (typeof assistantId !== 'string') {
            return this.fail(socket, 'INVALID_SESSION_START', 'A valid assistant is required.', 4410);
        }
        const language = parseLanguage(input.language);
        const { settings, allowedLanguages, ttsLanguages, defaultLanguage } = await this.auth.resolveSettings(identity.tenantId, assistantId, language);
        checkStartup();
        diagnose('settings_resolved');
        if (input.voiceId !== undefined) {
            const selectedLanguage = language === 'auto' ? defaultLanguage : language;
            if (typeof input.voiceId === 'string' && input.voiceId.startsWith('clone:') && this.library) {
                await this.library.assertActive(identity.tenantId, input.voiceId, selectedLanguage);
            }
            else if (typeof input.voiceId !== 'string' || !this.tts.supportsVoice(selectedLanguage, input.voiceId)) {
                return this.fail(socket, 'INVALID_VOICE', 'The selected voice is unavailable.', 4410);
            }
            settings.ttsVoice = input.voiceId;
        }
        if (language === 'auto' && allowedLanguages.length === 0) {
            throw new common_1.ForbiddenException('Voice is not enabled for this assistant.');
        }
        if (widget) {
            const disconnected = [...this.sessions.values()].filter(session => !session.socket && session.state !== 'closed' &&
                session.context.agent.tenantId === identity.tenantId &&
                session.context.widgetSessionId === widget.widgetSessionId &&
                session.context.assistantId === assistantId &&
                session.context.conversationId === widget.conversationId);
            for (const previous of disconnected) {
                await this.runInTenant(previous, () => this.closeSession(previous, 'disconnected_session_replaced'));
            }
            checkStartup();
        }
        if (this.sessions.size >= exports.MAX_GLOBAL_SESSIONS ||
            process.memoryUsage().heapUsed > (0, node_v8_1.getHeapStatistics)().heap_size_limit * 0.7) {
            return this.fail(socket, 'SESSION_LIMIT_REACHED', 'The voice service is at capacity.', 4409);
        }
        const [sttReady, vadReady, ttsReady] = await Promise.all([
            this.stt.healthCheck(),
            this.vad.healthCheck(),
            this.tts.healthCheck(),
        ]);
        checkStartup();
        diagnose('health_checked');
        if (!sttReady || !vadReady || !ttsReady) {
            return this.fail(socket, 'VOICE_ENGINE_UNAVAILABLE', 'A required voice engine is unavailable.', 4503);
        }
        const sessionId = (0, uuid_1.newUuidv7)();
        const slotScopes = [`vs:u:${identity.tenantId}:${subjectOf(identity)}`, `vs:t:${identity.tenantId}`];
        const slotLimits = [1, exports.MAX_TENANT_SESSIONS];
        let acquired;
        try {
            acquired = await this.acquireSlots(sessionId, slotScopes, slotLimits);
        }
        catch (error) {
            if (error instanceof shared_state_1.SharedStateUnavailableError) {
                return this.fail(socket, 'VOICE_SESSION_UNAVAILABLE', 'The voice service is temporarily unavailable.', 4503);
            }
            throw error;
        }
        if (acquired.length !== slotScopes.length) {
            await this.persistRejectedStart(identity, 'session_limit_rejected');
            return this.fail(socket, 'SESSION_LIMIT_REACHED', 'Only one active voice session is allowed per user.', 4409);
        }
        const agentContext = Object.freeze({
            tenantId: identity.tenantId,
            ...(identity.widget ? { channel: 'widget' } : { userId: identity.userId }),
            ...(identity.widget?.merchant ? { merchant: identity.widget.merchant } : {}),
            assistantId,
            permissions: identity.permissions,
            requestId: (0, node_crypto_1.randomUUID)(),
        });
        const session = {
            id: sessionId,
            context: {
                agent: agentContext,
                permissions: identity.permissions,
                sessionId,
                assistantId,
                ...(identity.widget ? { widgetSessionId: identity.widget.widgetSessionId } : {}),
                language,
                allowedLanguages,
                defaultLanguage,
                voiceOptions: {
                    en: this.tts.voices('en'),
                    hi: this.tts.voices('hi'),
                    te: this.tts.voices('te'),
                },
                settings,
            },
            socket,
            startedAt: Date.now(),
            state: 'listening',
            epoch: 1,
            outgoingSequence: 0,
            audioBytes: 0,
            currentAudio: [],
            preRoll: [],
            audioQueue: [],
            audioProcessing: false,
            currentAudioBytes: 0,
            pendingAudioBytes: 0,
            processing: Promise.resolve(),
            recentFrameTimes: [],
            recentEventTimes: [],
            recentViolationTimes: [],
            vadPending: Buffer.alloc(0),
            speechMs: 0,
            silenceMs: 0,
            turnsCompleted: 0,
            interrupts: 0,
            listenMs: 0,
            speakMs: 0,
            lastActivityAt: Date.now(),
            lastNudgeAt: Date.now(),
        };
        session.slotScopes = slotScopes;
        const releaseOnCancel = () => { void this.releaseSlots(sessionId, slotScopes); };
        signal?.addEventListener('abort', releaseOnCancel, { once: true });
        try {
            checkStartup();
            diagnose('slots_acquired');
            await this.runInTenant(session, async () => {
                let conversationId;
                if (typeof requestedConversationId === 'string') {
                    const prepared = await this.conversations.prepareAgentTurn(requestedConversationId, agentContext);
                    checkStartup();
                    diagnose('conversation_authorized');
                    if (prepared.assistantId !== assistantId) {
                        throw new common_1.ForbiddenException('Conversation access is unavailable.');
                    }
                    conversationId = requestedConversationId;
                    session.context.conversationId = conversationId;
                }
                else if (requestedConversationId !== undefined) {
                    throw new common_1.ForbiddenException('Conversation access is unavailable.');
                }
                await this.persistence.create(session, classifyUserAgent(userAgent));
                if (signal?.aborted || socket.readyState !== ws_1.WebSocket.OPEN) {
                    await this.persistence.close(session, 'startup_cancelled', null);
                    checkStartup();
                }
                diagnose('session_persisted');
                this.sessions.set(sessionId, session);
                session.slotTimer = setInterval(() => void this.renewSlots(session), SLOT_RENEW_MS);
                session.slotTimer.unref?.();
                this.sendEvent(socket, 'voice.session.started', {
                    flowControl: 'ack-v1',
                    sessionId,
                    epoch: session.epoch,
                    settings: {
                        sttEngineId: settings.sttEngineId,
                        ttsEngineId: settings.ttsEngineId,
                        vadSensitivity: settings.vadSensitivity,
                        endpointSilenceMs: settings.endpointSilenceMs,
                        audioFormat: 'pcm_s16le/16000/mono',
                        partialTranscription: this.stt.supportsPartial !== false,
                        defaultLanguage,
                        allowedLanguages,
                        ttsLanguages,
                        voices: session.context.voiceOptions,
                        conversationId: conversationId ?? null,
                    },
                    language,
                }, session);
                diagnose('acknowledgement_sent');
                this.rotateResumeToken(session);
                this.armTimers(session);
            });
        }
        catch (error) {
            if (session.slotTimer)
                clearInterval(session.slotTimer);
            this.sessions.delete(sessionId);
            await this.releaseSlots(sessionId, slotScopes);
            throw error;
        }
        finally {
            signal?.removeEventListener('abort', releaseOnCancel);
        }
    }
    async acquireSlots(member, scopes, limits) {
        const held = [];
        try {
            for (let index = 0; index < scopes.length; index++) {
                if (!(await this.store.acquireSlot(scopes[index], member, limits[index], SLOT_TTL_MS))) {
                    await this.releaseSlots(member, held);
                    return [];
                }
                held.push(scopes[index]);
            }
        }
        catch (error) {
            await this.releaseSlots(member, held);
            throw error;
        }
        return held;
    }
    async releaseSlots(member, scopes) {
        await Promise.all(scopes.map((scope) => this.store.releaseSlot(scope, member).catch(() => {
            this.logger.warn({ event: 'voice_session_slot_release_failed', sessionId: member });
        })));
    }
    async renewSlots(session) {
        if (session.state === 'closed')
            return;
        try {
            await Promise.all((session.slotScopes ?? []).map((scope) => this.store.renewSlot(scope, session.id, SLOT_TTL_MS)));
        }
        catch {
            this.logger.warn(JSON.stringify({ event: 'voice_slot_renew_failed', sessionId: session.id }));
        }
    }
    async handleText(socket, data) {
        const raw = typeof data === 'string' ? data : data.toString('utf8');
        if (Buffer.byteLength(raw, 'utf8') > 8 * 1024) {
            socket.close(4413, 'MESSAGE_TOO_LARGE');
            return;
        }
        const event = parseEvent(raw);
        if (!event) {
            socket.close(4410, 'PROTOCOL_VIOLATION');
            return;
        }
        const session = this.sessions.get(event.sessionId ?? '');
        if (!session || session.socket !== socket) {
            return this.fail(socket, 'SESSION_MISMATCH', 'The voice session is unavailable.', 4404);
        }
        if (event.data && 'tenantId' in event.data) {
            await this.recordEvent(session, 'session_error', 'PROTO_VIOLATION');
            this.sendError(session, 'PROTO_VIOLATION', 'The event contains an unsupported field.', true);
            return;
        }
        if (!this.checkRate(session.recentEventTimes, EVENT_LIMIT)) {
            this.sendError(session, 'RATE_LIMITED', 'Too many events were sent.', false);
            socket.close(4429, 'RATE_LIMITED');
            return;
        }
        session.lastActivityAt = Date.now();
        this.armIdleTimer(session);
        const dataObject = event.data ?? {};
        if (event.type === 'voice.session.ping') {
            if (typeof dataObject.clientTime !== 'number' || !Number.isFinite(dataObject.clientTime)) {
                return this.fail(socket, 'PROTO_VIOLATION', 'Invalid timing probe.', 4410);
            }
            this.sendEvent(socket, 'voice.session.pong', { clientTime: dataObject.clientTime }, session);
            return;
        }
        if (event.type === 'voice.audio.end') {
            void session.processing.then(() => this.runInTenant(session, () => this.finalizeUtterance(session, 'client_end')))
                .catch(() => this.pipelineFailure(session, new Error('Audio end processing failed.')));
            return;
        }
        if (event.type === 'voice.assistant.interrupt') {
            await this.interrupt(session, 'client_interrupt');
            return;
        }
        if (event.type === 'voice.session.close') {
            await this.closeSession(session, stringField(dataObject.reason, 50) ?? 'user_stop');
            socket.close(1000, 'CLOSED');
            return;
        }
        socket.close(4410, 'PROTOCOL_VIOLATION');
    }
    handleBinary(socket, data) {
        const session = [...this.sessions.values()].find((item) => item.socket === socket);
        if (!session) {
            socket.close(4401, 'UNAUTHORIZED');
            return;
        }
        if (data.length > MAX_MESSAGE_BYTES) {
            void this.recordEvent(session, 'oversize_frame_rejected', 'MESSAGE_TOO_LARGE');
            socket.close(4413, 'MESSAGE_TOO_LARGE');
            return;
        }
        const frame = decodeAudioFrame(data);
        if (!frame) {
            this.rejectMalformedFrame(session, 'MALFORMED_FRAME');
            return;
        }
        if (frame.type !== 1 || frame.payload.length > MAX_PAYLOAD_BYTES) {
            this.rejectMalformedFrame(session, 'WRONG_DIRECTION');
            return;
        }
        if (frame.epoch > session.epoch) {
            this.rejectMalformedFrame(session, 'FUTURE_EPOCH');
            return;
        }
        if (frame.epoch < session.epoch) {
            void this.recordEvent(session, 'stale_frame_dropped');
            return;
        }
        if ((0, audio_diagnostics_1.audioDiagnosticsEnabled)()) {
            session.audioDiagnostics ??= new audio_diagnostics_1.PcmDiagnostics();
            session.audioDiagnostics.packet(frame.sequence, frame.epoch);
        }
        if (!this.checkSequence(session, frame.sequence))
            return;
        if (!this.checkRate(session.recentFrameTimes, FRAME_LIMIT)) {
            this.sendError(session, 'RATE_LIMITED', 'Audio frame rate is too high.', false);
            session.socket?.close(4429, 'RATE_LIMITED');
            return;
        }
        if (session.audioBytes + frame.payload.length > MAX_SESSION_AUDIO_BYTES) {
            this.sendError(session, 'QUOTA_EXCEEDED', 'The voice session audio limit was reached.', false);
            void this.closeSession(session, 'quota_exceeded', 'QUOTA_EXCEEDED');
            return;
        }
        const now = Date.now();
        if (now - this.ingressWindowStart >= 1000) {
            this.ingressWindowStart = now;
            this.ingressWindowBytes = 0;
        }
        this.ingressWindowBytes += frame.payload.length;
        if (this.ingressWindowBytes > MAX_GLOBAL_INGRESS_BYTES_PER_SECOND) {
            this.sendError(session, 'INGRESS_BACKPRESSURE', 'Audio could not be accepted because the voice service is busy. Voice stopped to avoid incomplete transcription.', false);
            void this.closeSession(session, 'ingress_backpressure');
            return;
        }
        if (session.pendingAudioBytes + frame.payload.length > 64_000) {
            this.sendError(session, 'AUDIO_QUEUE_OVERFLOW', 'The audio processing queue exceeded 2 seconds. Voice stopped to avoid incomplete transcription.', false);
            void this.closeSession(session, 'audio_queue_overflow');
            return;
        }
        session.audioBytes += frame.payload.length;
        session.audioDiagnostics?.append(frame.payload);
        session.pendingAudioBytes += frame.payload.length;
        session.audioQueue.push({ payload: frame.payload, epoch: frame.epoch, sequence: frame.sequence, receivedAt: performance.now() });
        session.lastActivityAt = now;
        this.armIdleTimer(session);
        if (session.pendingAudioBytes >= 16_000 && !session.flowPaused) {
            session.flowPaused = true;
            this.sendEvent(socket, 'voice.audio.flow', { paused: true, queueMs: session.pendingAudioBytes / 32 }, session);
        }
        this.drainAudio(session);
    }
    onDisconnect(socket) {
        const session = [...this.sessions.values()].find((item) => item.socket === socket);
        if (!session || session.state === 'closed')
            return;
        session.socket = undefined;
        session.vadAbort?.abort();
        session.ttsAbort?.abort();
        session.turnAbort?.abort();
        session.sttAbort?.abort();
        session.partialAbort?.abort();
        session.currentAudio = [];
        session.currentAudioBytes = 0;
        session.audioQueue = [];
        session.pendingAudioBytes = 0;
        session.flowPaused = false;
        session.vadPending = Buffer.alloc(0);
        session.state = 'interrupted';
        this.bumpEpoch(session, 'recovered');
        session.closeTimer = setTimeout(() => {
            void this.runInTenant(session, () => this.closeSession(session, 'resume_expired'));
        }, RESUME_TTL_MS);
    }
    async closeAll() {
        await Promise.all([...this.sessions.values()].map((session) => this.runInTenant(session, () => this.closeSession(session, 'server_shutdown'))));
    }
    get activeSessionCount() {
        return this.sessions.size;
    }
    drainAudio(session) {
        if (session.audioProcessing)
            return;
        session.audioProcessing = true;
        session.processing = (async () => {
            try {
                while (session.audioQueue.length > 0 && session.state !== 'closed') {
                    const frame = session.audioQueue.shift();
                    const started = performance.now();
                    try {
                        if (frame.epoch === session.epoch) {
                            await this.runInTenant(session, () => this.consumeAudio(session, frame.payload, frame.sequence));
                        }
                    }
                    catch (error) {
                        if (frame.epoch === session.epoch)
                            await this.pipelineFailure(session, error);
                    }
                    finally {
                        session.pendingAudioBytes = session.audioQueue.reduce((sum, item) => sum + item.payload.length, 0);
                        if (session.pendingAudioBytes <= 6400)
                            session.flowPaused = false;
                        this.sendEvent(session.socket, 'voice.audio.ack', {
                            sequence: frame.sequence, audioEpoch: frame.epoch, bytes: frame.payload.length,
                            receivedAtMs: frame.receivedAt, audioMs: frame.payload.length / 32,
                            queueDepth: session.audioQueue.length, queueMs: session.pendingAudioBytes / 32,
                            processingMs: performance.now() - started, queueWaitMs: started - frame.receivedAt,
                            vadMs: session.vadMs ?? 0, paused: session.flowPaused ?? false,
                        }, session);
                    }
                }
            }
            finally {
                session.audioProcessing = false;
                if (session.audioQueue.length > 0 && session.state !== 'closed')
                    this.drainAudio(session);
            }
        })();
    }
    rejectMalformedFrame(session, detail) {
        const now = Date.now();
        while (session.recentViolationTimes.length && now - session.recentViolationTimes[0] >= 60_000) {
            session.recentViolationTimes.shift();
        }
        session.recentViolationTimes.push(now);
        void this.recordEvent(session, 'malformed_frame', detail);
        this.sendError(session, 'PROTO_VIOLATION', 'The audio frame is invalid.', true);
        if (session.recentViolationTimes.length >= 5) {
            session.socket?.close(4410, 'PROTOCOL_VIOLATION');
            void this.runInTenant(session, () => this.closeSession(session, 'protocol_violation', 'PROTO_VIOLATION'));
        }
    }
    async resume(socket, identity, token, lastEpoch, signal) {
        if (!/^mzv_[A-Za-z0-9_-]{43}$/.test(token) ||
            (lastEpoch !== undefined && (!Number.isInteger(lastEpoch) || Number(lastEpoch) < 0))) {
            return this.fail(socket, 'SESSION_MISMATCH', 'The voice session is unavailable.', 4404);
        }
        const key = `vr:${(0, node_crypto_1.createHash)('sha256').update(token).digest('hex')}`;
        let record;
        try {
            const raw = await this.store.get(key);
            record = raw ? JSON.parse(raw) : undefined;
        }
        catch {
            return this.fail(socket, 'VOICE_SESSION_UNAVAILABLE', 'The voice service is temporarily unavailable.', 4503);
        }
        const session = record && record.instanceId === INSTANCE_ID ? this.sessions.get(record.sessionId) : undefined;
        if (!record || !session ||
            record.tenantId !== identity.tenantId || record.subject !== subjectOf(identity) ||
            (lastEpoch !== undefined && Number(lastEpoch) > session.epoch)) {
            return this.fail(socket, 'SESSION_MISMATCH', 'The voice session is unavailable.', 4404);
        }
        let claimed;
        try {
            claimed = await this.store.take(key);
        }
        catch {
            claimed = null;
        }
        if (signal?.aborted || socket.readyState !== ws_1.WebSocket.OPEN)
            throw new Error('Voice startup cancelled.');
        if (!claimed || session.state === 'closed') {
            return this.fail(socket, 'SESSION_MISMATCH', 'The voice session is unavailable.', 4404);
        }
        if (session.closeTimer)
            clearTimeout(session.closeTimer);
        if (session.socket && session.socket !== socket && session.socket.readyState < ws_1.WebSocket.CLOSING) {
            session.socket.close(4404, 'SESSION_REBOUND');
        }
        session.socket = socket;
        session.state = 'listening';
        session.currentAudio = [];
        session.currentAudioBytes = 0;
        session.vadPending = Buffer.alloc(0);
        this.sendEvent(socket, 'voice.session.resumed', { sessionId: session.id, epoch: session.epoch, flowControl: 'ack-v1' }, session);
        await this.recordEvent(session, 'session_resume');
        this.rotateResumeToken(session);
        this.armTimers(session);
    }
    async consumeAudio(session, payload, sequence) {
        const extended = session;
        let epoch = session.epoch;
        const combined = session.vadPending.length ? Buffer.concat([session.vadPending, payload]) : payload;
        const length = combined.length - combined.length % FRAME_BYTES;
        session.vadPending = combined.subarray(length);
        const complete = combined.subarray(0, length);
        const started = performance.now();
        const controller = new AbortController();
        session.vadAbort = controller;
        let batch;
        try {
            batch = complete.length && this.vad.detectBatch
                ? await this.vad.detectBatch({
                    streamId: session.id, audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: complete },
                    signal: controller.signal,
                })
                : undefined;
            if (session.epoch !== epoch || controller.signal.aborted)
                return;
        }
        finally {
            if (session.vadAbort === controller)
                session.vadAbort = undefined;
        }
        if (batch && batch.length !== length / FRAME_BYTES)
            throw new Error('Invalid VAD batch length.');
        session.vadMs = batch ? performance.now() - started : 0;
        for (let offset = 0; offset < length; offset += FRAME_BYTES) {
            if (session.epoch !== epoch || session.state === 'closed')
                return;
            const vadFrame = complete.subarray(offset, offset + FRAME_BYTES);
            session.listenMs += 20;
            const controller = new AbortController();
            const vadStarted = performance.now();
            const result = batch?.[offset / FRAME_BYTES] ?? await this.vad.detect({
                streamId: session.id,
                audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: vadFrame },
                signal: controller.signal,
            });
            if (!batch)
                session.vadMs += performance.now() - vadStarted;
            if (session.epoch !== epoch)
                return;
            const speech = result.speech && result.probability >= session.context.settings.vadSensitivity;
            if (speech) {
                if (session.state === 'speaking' && session.context.settings.bargeInEnabled) {
                    await this.interrupt(session, 'vad_barge_in');
                    epoch = session.epoch;
                }
                if (session.state === 'listening' || session.state === 'interrupted') {
                    session.currentAudio = [...extended.preRoll];
                    session.currentAudioBytes = session.currentAudio.reduce((sum, block) => sum + block.length, 0);
                    session.speechMs = 0;
                    session.silenceMs = 0;
                    session.utteranceStartedAt = Date.now();
                    session.timing = { turnId: (0, node_crypto_1.randomUUID)(), startedAt: performance.now(), preRollMs: session.currentAudioBytes / 32 };
                    this.sendEvent(session.socket, 'voice.speech.started', { sequence, offsetMs: offset / 32, turnId: session.timing.turnId }, session);
                    session.state = 'detecting_end_of_speech';
                    await this.recordEvent(session, 'turn_start');
                }
                if (session.state === 'detecting_end_of_speech') {
                    this.appendAudio(session, vadFrame);
                    session.speechMs += 20;
                    session.silenceMs = 0;
                }
            }
            else {
                extended.preRoll.push(Buffer.from(vadFrame));
                while (extended.preRoll.length > 50)
                    extended.preRoll.shift();
                if (session.state === 'detecting_end_of_speech') {
                    this.appendAudio(session, vadFrame);
                    session.silenceMs += 20;
                    if (session.speechMs >= session.context.settings.minSpeechMs &&
                        session.silenceMs >= session.context.settings.endpointSilenceMs) {
                        void this.finalizeUtterance(session, 'silence').catch(() => {
                            this.logger.error(JSON.stringify({ event: 'voice_turn_failed', sessionId: session.id }));
                            this.sendError(session, 'VOICE_SESSION_UNAVAILABLE', 'The voice service is temporarily unavailable.', false);
                            session.socket?.close(4503, 'VOICE_SESSION_UNAVAILABLE');
                        });
                    }
                    if (this.stt.supportsPartial !== false && session.state === 'detecting_end_of_speech' &&
                        session.currentAudioBytes > 48_000 &&
                        Date.now() - (session.lastPartialAt ?? 0) >= 1_500) {
                        session.lastPartialAt = Date.now();
                        void this.transcribePartial(session);
                    }
                }
                else if (session.state === 'listening') {
                    session.silenceMs += 20;
                    const nudgeMs = session.context.settings.silenceNudgeMs;
                    if (session.silenceMs >= nudgeMs && Date.now() - (session.lastNudgeAt ?? 0) >= nudgeMs) {
                        session.lastNudgeAt = Date.now();
                        session.silenceMs = 0;
                        this.sendEvent(session.socket, 'voice.assistant.thinking', { hint: 'silence' }, session);
                    }
                }
            }
            if (session.currentAudioBytes >= MAX_UTTERANCE_BYTES) {
                this.sendError(session, 'UTTERANCE_TOO_LARGE', 'Please pause after at most 20 seconds of speech. This overlong turn was not transcribed.', true);
                await this.resetTurn(session, 'turn_reset');
            }
        }
    }
    async transcribePartial(session) {
        if (session.partialAbort && !session.partialAbort.signal.aborted)
            return;
        const turnId = session.turnId;
        const epoch = session.epoch;
        const controller = new AbortController();
        session.partialAbort = controller;
        try {
            const result = await this.stt.transcribe({
                audio: {
                    encoding: 'pcm_s16le',
                    sampleRate: 16000,
                    channels: 1,
                    data: Buffer.concat(session.currentAudio).subarray(-PARTIAL_WINDOW_BYTES),
                },
                language: session.context.language,
                partial: true,
                requestId: session.timing?.turnId,
                signal: controller.signal,
            });
            if (session.epoch !== epoch || session.state !== 'detecting_end_of_speech' || session.turnId !== turnId)
                return;
            if (result.text.trim())
                this.sendEvent(session.socket, 'voice.transcript.partial', {
                    text: normalizeTranscript(result.text, 2000),
                    language: result.language,
                    confidence: result.confidence,
                }, session);
        }
        catch (error) {
            if (session.state === 'detecting_end_of_speech' && session.epoch === epoch && !controller.signal.aborted) {
                this.logger.warn(JSON.stringify({
                    event: 'voice_partial_transcription_failed',
                    sessionId: session.id,
                    error: error instanceof Error ? error.message : 'Unknown provider failure',
                }));
                this.sendError(session, 'STT_PARTIAL_UNAVAILABLE', 'Live captions are temporarily unavailable.', true);
            }
        }
        finally {
            if (session.partialAbort === controller)
                session.partialAbort = undefined;
        }
    }
    async finalizeUtterance(session, reason) {
        if (session.state !== 'detecting_end_of_speech' || session.speechMs < session.context.settings.minSpeechMs ||
            session.currentAudioBytes === 0)
            return;
        const epoch = session.epoch;
        const buffering = {
            preRollMs: session.timing?.preRollMs,
            trailingSilenceMs: session.silenceMs,
            vadSpeechMs: session.speechMs,
            reason,
        };
        if (session.timing)
            session.timing.endpointAt = performance.now();
        session.state = 'transcribing';
        this.sendEvent(session.socket, 'voice.assistant.thinking', { hint: 'transcribing' }, session);
        await this.persistState(session);
        await this.recordEvent(session, 'endpoint_detected', reason);
        const audio = Buffer.concat(session.currentAudio);
        let diagnosticMetadata;
        if (session.audioDiagnostics) {
            const segmented = new audio_diagnostics_1.PcmDiagnostics();
            segmented.append(audio);
            diagnosticMetadata = { ingress: session.audioDiagnostics.snapshot(), finalStt: segmented.snapshot() };
            this.logger.log({
                event: 'voice_audio_diagnostics', sessionId: session.id, turnId: session.timing?.turnId,
                ...diagnosticMetadata,
                vadStartMs: session.timing?.startedAt, vadEndMs: session.timing?.endpointAt, buffering,
            });
        }
        session.partialAbort?.abort();
        session.sttAbort?.abort();
        const controller = new AbortController();
        session.sttAbort = controller;
        const sttStarted = performance.now();
        let sttMs;
        const timing = session.timing;
        try {
            const vocabulary = await this.productIdentity?.vocabulary(session.context.agent) ?? [];
            const result = await this.stt.transcribe({
                audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: audio },
                language: session.context.language === 'auto'
                    ? session.context.settings.sttLanguageHint
                    : session.context.language,
                partial: false,
                requestId: session.timing?.turnId,
                vocabulary: vocabulary.map(product => product.name),
                signal: controller.signal,
            });
            sttMs = performance.now() - sttStarted;
            if (session.epoch !== epoch || session.state !== 'transcribing') {
                await this.recordEvent(session, 'late_agent_response_discarded', 'stale_transcription');
                return;
            }
            const text = normalizeTranscript(result.text, 2000);
            this.logger.log({
                event: 'voice_product_transcript', requestId: session.timing?.turnId,
                audioBytes: audio.length, audioMs: audio.length / 32,
                rawLength: result.text.length, normalizedLength: text.length,
                normalizationChanged: result.text !== text,
                rawProductMentions: (0, product_identity_service_1.productMentions)(result.text, vocabulary),
                normalizedProductMentions: (0, product_identity_service_1.productMentions)(text, vocabulary),
                vocabularyCount: vocabulary.length, confidence: result.confidence ?? null,
                recognitionReliable: result.recognitionQuality?.reliable ?? null,
            });
            if (!text) {
                await this.resetTurn(session, 'turn_reset');
                return;
            }
            session.context.language = session.context.language === 'auto' ? result.language : session.context.language;
            if (session.timing) {
                session.timing.sttMs = sttMs;
                session.timing.sttProcessingMs = result.processingMs;
            }
            this.sendEvent(session.socket, 'voice.transcript.final', {
                text,
                rawText: result.text,
                language: result.language,
                confidence: result.confidence ?? null,
                durationMs: Date.now() - (session.utteranceStartedAt ?? Date.now()),
                sttMs,
                audioMs: audio.length / 32,
                buffering,
                ...(diagnosticMetadata ? { audioDiagnostics: diagnosticMetadata } : {}),
                turnId: session.timing?.turnId,
                endpointMs: session.timing?.endpointAt === undefined ? undefined : session.timing.endpointAt - session.timing.startedAt,
                sttProcessingMs: result.processingMs,
                sttTimings: result.timings,
                recognitionQuality: result.recognitionQuality,
            }, session);
            await this.recordEvent(session, 'transcript_final', `language_${result.language}`);
            await this.invokeAgent(session, text, epoch, result.recognitionQuality?.reliable !== false);
        }
        catch (error) {
            if (session.epoch !== epoch || !this.sessions.has(session.id) || controller.signal.aborted)
                return;
            const code = error instanceof Error && error.name === 'AbortError'
                ? 'VOICE_PROVIDER_TIMEOUT'
                : 'STT_UNAVAILABLE';
            this.sendError(session, code, 'Speech could not be transcribed. Please try again.', true);
            await this.resetTurn(session, 'recovered');
        }
        finally {
            this.logger.log({
                event: 'voice_stt_timing', sessionId: session.id, turnId: timing?.turnId, epoch,
                audioMs: audio.length / 32, processingMs: sttMs ?? performance.now() - sttStarted,
                aborted: controller.signal.aborted,
            });
            if (session.sttAbort === controller)
                session.sttAbort = undefined;
        }
    }
    async invokeAgent(session, text, epoch, recognitionReliable = true) {
        if (session.state !== 'transcribing' || session.epoch !== epoch)
            return;
        session.state = 'thinking';
        const turnId = session.timing?.turnId ?? (0, node_crypto_1.randomUUID)();
        session.turnId = turnId;
        session.context.agent = Object.freeze({ ...session.context.agent, requestId: turnId });
        session.turnAbort = new AbortController();
        await this.persistState(session);
        this.sendEvent(session.socket, 'voice.assistant.thinking', {}, session);
        await this.recordEvent(session, 'turn_start', 'agent');
        const progress = { generatingSpeech: false };
        try {
            await this.runInTenant(session, async () => {
                if (!session.context.conversationId) {
                    const ownerId = session.context.agent.userId;
                    if (!ownerId)
                        throw new Error('Widget voice session has no conversation.');
                    const conversationId = await this.conversations.create({
                        assistantId: session.context.assistantId,
                        userId: ownerId,
                        title: 'Voice conversation',
                        channel: 'voice',
                        language: session.context.language === 'auto' ? null : session.context.language,
                        metadata: null,
                    });
                    session.context.conversationId = conversationId;
                    session.context.agent = Object.freeze({
                        ...session.context.agent,
                        conversationId,
                        modality: 'voice',
                        ...(session.context.language === 'auto' ? {} : { language: session.context.language }),
                    });
                    await this.persistence.updateConversation(session, conversationId);
                }
                else {
                    session.context.agent = Object.freeze({
                        ...session.context.agent,
                        conversationId: session.context.conversationId,
                        modality: 'voice',
                        ...(session.context.language === 'auto' ? {} : { language: session.context.language }),
                    });
                }
                const agentStarted = performance.now();
                if (recognitionReliable && this.agent.stream) {
                    const events = this.agent.stream(text, session.context.agent, session.turnAbort.signal)[Symbol.asyncIterator]();
                    try {
                        const first = await events.next();
                        if (first.done)
                            throw new Error('Empty agent stream.');
                        if ('text' in first.value) {
                            const firstText = first.value.text;
                            let finalResponse;
                            let agentMs;
                            const sentences = async function* () {
                                try {
                                    yield* splitSentences(firstText);
                                    while (true) {
                                        const next = await events.next();
                                        if (next.done)
                                            break;
                                        if ('text' in next.value)
                                            yield* splitSentences(next.value.text);
                                        else {
                                            finalResponse = next.value.response;
                                            agentMs = next.value.agentMs;
                                            if (!finalResponse.success)
                                                throw new Error('Streamed agent answer failed.');
                                        }
                                    }
                                    if (!finalResponse)
                                        throw new Error('Incomplete agent stream.');
                                }
                                catch (error) {
                                    progress.generatingSpeech = false;
                                    throw error;
                                }
                            };
                            this.logger.log({ event: 'voice_agent_first_text', turnId, firstTextMs: performance.now() - agentStarted });
                            progress.generatingSpeech = true;
                            await this.speakResponse(session, { success: true, answer: '', model: '', toolCalls: [], sources: [] }, epoch, turnId, sentences(), () => {
                                if (!finalResponse)
                                    throw new Error('Missing final agent response.');
                                if (session.timing?.turnId === turnId)
                                    session.timing.agentMs = agentMs;
                                return finalResponse;
                            });
                            return;
                        }
                        if (session.timing?.turnId === turnId)
                            session.timing.agentMs = performance.now() - agentStarted;
                        progress.generatingSpeech = true;
                        await this.speakResponse(session, first.value.response, epoch, turnId);
                        return;
                    }
                    finally {
                        await events.return?.();
                    }
                }
                const response = recognitionReliable
                    ? await this.agent.invoke(text, session.context.agent, session.turnAbort.signal)
                    : { success: true, answer: 'I could not hear that clearly. Please repeat your request.',
                        model: 'voice-clarification', toolCalls: [], sources: [] };
                const agentMs = performance.now() - agentStarted;
                if (session.timing?.turnId === turnId)
                    session.timing.agentMs = agentMs;
                this.logger.log({ event: 'voice_agent_timing', sessionId: session.id, turnId, agentMs });
                if (session.state !== 'thinking' || session.epoch !== epoch || session.turnId !== turnId) {
                    await this.recordEvent(session, 'late_agent_response_discarded');
                    return;
                }
                progress.generatingSpeech = true;
                await this.speakResponse(session, response, epoch, turnId);
            });
        }
        catch {
            if (this.sessions.get(session.id) === session && session.epoch === epoch && session.turnId === turnId) {
                const ttsFailed = progress.generatingSpeech;
                this.sendError(session, ttsFailed ? 'TTS_UNAVAILABLE' : 'AGENT_UNAVAILABLE', ttsFailed ? 'Speech playback could not be generated. The answer is available as text.' : 'The assistant could not complete this turn.', true);
                await this.resetTurn(session, 'recovered');
            }
        }
    }
    async speakResponse(session, response, epoch, turnId, streamedSentences, completedResponse) {
        if (!response || typeof response.answer !== 'string' || response.answer.length > 32_000) {
            throw new Error('Invalid agent response.');
        }
        const sentences = splitSentences(response.answer);
        const sendResponse = (result) => this.sendEvent(session.socket, 'voice.assistant.response', {
            success: result.success,
            answer: result.answer,
            model: result.model,
            toolCalls: result.toolCalls.slice(0, 50),
            sources: result.sources.slice(0, 50),
            ...(result.products ? { products: result.products.slice(0, 5) } : {}),
            turnId,
            agentMs: session.timing?.agentMs,
        }, session);
        if (!streamedSentences)
            sendResponse(response);
        for (const sentence of sentences) {
            if (!this.isCurrentTurn(session, epoch, turnId))
                return;
            this.sendEvent(session.socket, 'voice.assistant.text.delta', { delta: sentence, turnId }, session);
        }
        if (!streamedSentences && (!response.success || !sentences.length)) {
            await this.finishSpokenTurn(session, epoch, turnId, 0);
            return;
        }
        const language = session.context.language;
        const voiceSettings = await this.auth.resolveLanguageVoice(session.context.agent.tenantId, session.context.assistantId, language);
        if (!voiceSettings.enabled || !this.tts.supports(language)) {
            this.sendEvent(session.socket, 'voice.session.error', {
                code: 'LANGUAGE_TTS_UNAVAILABLE',
                message: 'A voice for this language is not configured; the answer is available as text.',
                recoverable: true,
                epoch,
            }, session);
            await this.finishSpokenTurn(session, epoch, turnId, 0);
            return;
        }
        const configuredVoice = voiceSettings.voice ?? defaultVoice(language);
        const voice = typeof session.context.settings.ttsVoice === 'string' &&
            (this.tts.supportsVoice(language, session.context.settings.ttsVoice) ||
                (session.context.settings.ttsVoice.startsWith('clone:') && this.library))
            ? session.context.settings.ttsVoice
            : configuredVoice;
        const rate = voiceSettings.rate ?? session.context.settings.speechRate;
        const ttsAbort = new AbortController();
        session.ttsAbort = ttsAbort;
        session.state = 'speaking';
        session.speakingStartedAt = Date.now();
        await this.persistState(session);
        let totalBytes = 0;
        let sampleRate = 16000;
        let announced = false;
        const ttsStarted = performance.now();
        let firstAudioMs;
        for await (const sentence of streamedSentences ?? sentences) {
            const request = {
                text: sentence,
                language,
                voice,
                rate,
                signal: ttsAbort.signal,
            };
            if (streamedSentences)
                this.sendEvent(session.socket, 'voice.assistant.text.delta', { delta: sentence, turnId, streamed: true }, session);
            const iterable = voice.startsWith('clone:') && this.library
                ? this.library.synthesize(session.context.agent.tenantId, request)
                : this.tts.synthesize(request);
            for await (const chunk of iterable) {
                if (!this.isCurrentTurn(session, epoch, turnId) || ttsAbort.signal.aborted) {
                    await this.recordEvent(session, 'late_agent_response_discarded', 'stale_tts_chunk');
                    return;
                }
                sampleRate = chunk.sampleRate;
                totalBytes += chunk.data.length;
                if (totalBytes > sampleRate * 2 * 60) {
                    throw new Error('TTS output limit exceeded.');
                }
                if (!announced) {
                    firstAudioMs = performance.now() - ttsStarted;
                    this.logger.log({ event: 'voice_first_audio', sessionId: session.id, turnId,
                        endpointToFirstAudioMs: session.timing?.endpointAt === undefined
                            ? undefined : performance.now() - session.timing.endpointAt });
                    this.sendEvent(session.socket, 'voice.assistant.audio.chunk', {
                        epoch,
                        turnId,
                        encoding: 'pcm_s16le',
                        sampleRate,
                        frames: 0,
                        ttsFirstAudioMs: firstAudioMs,
                    }, session);
                    announced = true;
                }
                this.sendPcmChunks(session, chunk.data, epoch);
            }
        }
        if (!this.isCurrentTurn(session, epoch, turnId) || ttsAbort.signal.aborted)
            return;
        if (completedResponse)
            sendResponse(completedResponse());
        const totalMs = Math.floor(totalBytes / (sampleRate * 2) * 1000);
        const generationMs = performance.now() - ttsStarted;
        const timing = {
            sttMs: session.timing?.sttMs, sttProcessingMs: session.timing?.sttProcessingMs,
            agentMs: session.timing?.agentMs, ttsFirstAudioMs: firstAudioMs, ttsGenerationMs: generationMs,
            ttsRealTimeFactor: totalMs > 0 ? generationMs / totalMs : 0,
            speechToGenerationEndMs: session.timing ? performance.now() - session.timing.startedAt : undefined,
        };
        this.logger.log({ event: 'voice_turn_timing', sessionId: session.id, turnId, ...timing, outputAudioMs: totalMs });
        this.sendEvent(session.socket, 'voice.assistant.audio.end', { epoch, turnId, totalMs, timing }, session);
        await this.finishSpokenTurn(session, epoch, turnId, totalMs);
    }
    async finishSpokenTurn(session, epoch, turnId, speakMs) {
        if (!this.isCurrentTurn(session, epoch, turnId))
            return;
        this.sendEvent(session.socket, 'voice.assistant.turn.end', {
            turnId,
            status: 'completed',
            speakMs,
        }, session);
        session.speakMs += speakMs;
        session.turnsCompleted++;
        session.turnAbort = undefined;
        session.ttsAbort = undefined;
        session.turnId = undefined;
        await this.resetTurn(session, 'turn_reset');
    }
    async interrupt(session, reason) {
        if (!session.context.settings.bargeInEnabled && reason === 'vad_barge_in')
            return;
        session.epoch = (session.epoch + 1) >>> 0;
        session.incomingSequence = undefined;
        session.interrupts++;
        session.ttsAbort?.abort();
        session.turnAbort?.abort();
        session.sttAbort?.abort();
        session.partialAbort?.abort();
        session.vadAbort?.abort();
        session.ttsAbort = undefined;
        session.turnAbort = undefined;
        session.turnId = undefined;
        session.currentAudio = [];
        session.currentAudioBytes = 0;
        session.audioQueue = [];
        session.pendingAudioBytes = 0;
        session.flowPaused = false;
        session.vadPending = Buffer.alloc(0);
        session.state = 'interrupted';
        this.sendEvent(session.socket, 'voice.assistant.epoch', { epoch: session.epoch, reason: 'interrupt' }, session);
        this.sendEvent(session.socket, 'voice.assistant.interrupt', { epoch: session.epoch }, session);
        await this.persistState(session);
        await this.recordEvent(session, 'interrupt', reason);
        session.state = 'listening';
    }
    async resetTurn(session, reason) {
        session.partialAbort?.abort();
        session.vadAbort?.abort();
        session.currentAudio = [];
        session.currentAudioBytes = 0;
        session.preRoll = [];
        session.vadPending = Buffer.alloc(0);
        session.speechMs = 0;
        session.silenceMs = 0;
        session.utteranceStartedAt = undefined;
        session.lastPartialAt = undefined;
        session.turnId = undefined;
        session.turnAbort = undefined;
        session.ttsAbort = undefined;
        session.state = 'listening';
        session.epoch = (session.epoch + 1) >>> 0;
        session.incomingSequence = undefined;
        this.sendEvent(session.socket, 'voice.assistant.epoch', { epoch: session.epoch, reason }, session);
        await this.persistState(session);
    }
    async pipelineFailure(session, error) {
        if (session.state === 'closed')
            return;
        this.logger.warn({
            event: 'voice_audio_pipeline_failed', sessionId: session.id,
            reason: error instanceof voice_provider_util_1.VoiceProviderError ? error.code : 'AUDIO_PROCESSING_FAILED',
        });
        this.sendError(session, 'VOICE_AUDIO_PROCESSING_FAILED', 'Live audio processing failed. The voice activity service may be busy or unavailable. Please try again.', true);
        session.state = 'error';
        await this.recordEvent(session, 'session_error', 'VOICE_ENGINE_UNAVAILABLE');
        await this.resetTurn(session, 'recovered');
    }
    appendAudio(session, frame) {
        if (session.currentAudioBytes + frame.length > MAX_UTTERANCE_BYTES)
            return;
        session.currentAudio.push(Buffer.from(frame));
        session.currentAudioBytes += frame.length;
    }
    sendPcmChunks(session, data, epoch) {
        const socket = session.socket;
        if (!socket || socket.readyState !== ws_1.WebSocket.OPEN)
            return;
        for (let offset = 0; offset < data.length; offset += MAX_PAYLOAD_BYTES) {
            if (session.epoch !== epoch)
                return;
            let length = Math.min(MAX_PAYLOAD_BYTES, data.length - offset);
            length &= ~1;
            if (length < 2)
                continue;
            if (socket.bufferedAmount + HEADER_BYTES + length > 353_000) {
                this.sendError(session, 'EGRESS_BACKPRESSURE', 'Audio output is temporarily paused.', true);
                session.ttsAbort?.abort();
                return;
            }
            const frame = Buffer.allocUnsafe(HEADER_BYTES + length);
            frame.writeUInt8(2, 0);
            frame.writeUInt32BE(epoch >>> 0, 1);
            frame.writeUInt32BE(session.outgoingSequence >>> 0, 5);
            frame.writeUInt16BE(length, 9);
            data.copy(frame, HEADER_BYTES, offset, offset + length);
            try {
                socket.send(frame, { binary: true });
            }
            catch {
                this.logger.warn(JSON.stringify({ event: 'voice_audio_send_failed', sessionId: session.id }));
                session.ttsAbort?.abort();
                return;
            }
            session.outgoingSequence = (session.outgoingSequence + 1) >>> 0;
        }
    }
    async closeSession(session, reason, errorCode = null) {
        if (session.state === 'closed')
            return;
        session.state = 'closed';
        if (session.audioDiagnostics)
            this.logger.log({
                event: 'voice_audio_diagnostics_closed', sessionId: session.id, reason,
                ingress: session.audioDiagnostics.snapshot(),
            });
        session.turnAbort?.abort();
        session.ttsAbort?.abort();
        session.sttAbort?.abort();
        session.partialAbort?.abort();
        session.vadAbort?.abort();
        if (session.idleTimer)
            clearTimeout(session.idleTimer);
        if (session.sessionTimer)
            clearTimeout(session.sessionTimer);
        if (session.closeTimer)
            clearTimeout(session.closeTimer);
        if (session.resumeTokenHash)
            void this.store.del(`vr:${session.resumeTokenHash}`).catch(() => undefined);
        if (session.slotTimer)
            clearInterval(session.slotTimer);
        this.sessions.delete(session.id);
        await this.releaseSlots(session.id, session.slotScopes ?? []);
        session.currentAudio = [];
        session.audioQueue = [];
        session.pendingAudioBytes = 0;
        session.vadPending = Buffer.alloc(0);
        try {
            await this.persistence.close(session, reason, errorCode);
        }
        catch {
            this.logger.warn(JSON.stringify({
                event: 'voice_session_close_persistence_failed',
                sessionId: session.id,
            }));
        }
        if (session.socket?.readyState === ws_1.WebSocket.OPEN) {
            this.sendEvent(session.socket, 'voice.session.close', { reason }, session);
            session.socket.close(1000, 'CLOSED');
        }
    }
    armTimers(session) {
        if (session.sessionTimer)
            clearTimeout(session.sessionTimer);
        const remaining = Math.max(0, exports.MAX_SESSION_MS - (Date.now() - session.startedAt));
        session.sessionTimer = setTimeout(() => {
            void this.runInTenant(session, () => this.closeSession(session, 'session_timeout'));
        }, remaining);
        this.armIdleTimer(session);
        const rotate = () => {
            if (session.state === 'closed' || !this.sessions.has(session.id))
                return;
            this.rotateResumeToken(session);
            session.closeTimer = setTimeout(rotate, RESUME_ROTATE_MS);
        };
        if (session.closeTimer)
            clearTimeout(session.closeTimer);
        session.closeTimer = setTimeout(rotate, RESUME_ROTATE_MS);
    }
    armIdleTimer(session) {
        if (session.idleTimer)
            clearTimeout(session.idleTimer);
        session.idleTimer = setTimeout(() => {
            void this.runInTenant(session, () => this.closeSession(session, 'idle_timeout'));
        }, session.context.settings.idleTimeoutMs);
    }
    rotateResumeToken(session) {
        const previous = session.resumeTokenHash;
        if (previous)
            void this.store.del(`vr:${previous}`).catch(() => undefined);
        const token = `mzv_${(0, node_crypto_1.randomBytes)(32).toString('base64url')}`;
        const hash = (0, node_crypto_1.createHash)('sha256').update(token).digest('hex');
        session.resumeTokenHash = hash;
        const agent = session.context.agent;
        const record = {
            sessionId: session.id,
            tenantId: agent.tenantId,
            subject: agent.userId ?? `w:${session.context.widgetSessionId ?? ''}`,
            assistantId: session.context.assistantId,
            conversationId: session.context.conversationId ?? null,
            instanceId: INSTANCE_ID,
        };
        void this.store.put(`vr:${hash}`, JSON.stringify(record), RESUME_TTL_MS).then(() => {
            if (session.state === 'closed' || session.resumeTokenHash !== hash) {
                return this.store.del(`vr:${hash}`);
            }
            this.sendEvent(session.socket, 'voice.session.resume_token', { token, expiresInMs: RESUME_TTL_MS }, session);
            return undefined;
        }).catch(() => {
            this.logger.warn(JSON.stringify({ event: 'voice_resume_token_unavailable', sessionId: session.id }));
        });
    }
    checkSequence(session, sequence) {
        const prior = session.incomingSequence;
        if (prior === undefined) {
            session.incomingSequence = sequence;
            return true;
        }
        const delta = (sequence - prior) >>> 0;
        if (delta === 0) {
            void this.recordEvent(session, 'duplicate_frame');
            return false;
        }
        if (delta >= 0x80000000) {
            void this.recordEvent(session, 'stale_frame_dropped');
            return false;
        }
        if (delta > 1) {
            void this.recordEvent(session, 'sequence_gap', `gap_${Math.min(delta - 1, 0xffffffff)}`);
            this.sendError(session, 'SEQUENCE_GAP', 'An audio frame was missed. Voice stopped to avoid incomplete transcription.', false);
            session.sttAbort?.abort();
            session.partialAbort?.abort();
            void this.closeSession(session, 'audio_sequence_gap');
            return false;
        }
        session.incomingSequence = sequence;
        return true;
    }
    checkRate(times, limit) {
        const now = Date.now();
        while (times.length && now - times[0] >= 1000)
            times.shift();
        if (times.length >= limit)
            return false;
        times.push(now);
        return true;
    }
    isCurrentTurn(session, epoch, turnId) {
        return session.state !== 'closed' && session.epoch === epoch && session.turnId === turnId;
    }
    async persistState(session) {
        try {
            await this.persistence.updateState(session);
        }
        catch {
            this.logger.warn(JSON.stringify({
                event: 'voice_state_persistence_failed',
                sessionId: session.id,
            }));
        }
    }
    async recordEvent(session, event, detail) {
        try {
            await this.persistence.event(session, event, detail);
        }
        catch {
            this.logger.warn(JSON.stringify({ event: 'voice_audit_persistence_failed', sessionId: session.id }));
        }
    }
    sendError(session, code, message, recoverable) {
        this.sendEvent(session.socket, 'voice.session.error', { code, message, recoverable, epoch: session.epoch }, session);
    }
    sendEvent(socket, type, data, session) {
        if (!socket || socket.readyState !== ws_1.WebSocket.OPEN)
            return;
        const event = {
            v: 1,
            type,
            ts: new Date().toISOString(),
            ...(session ? { sessionId: session.id, epoch: session.epoch } : {}),
            data,
        };
        try {
            socket.send(JSON.stringify(event));
        }
        catch {
            this.logger.warn(JSON.stringify({
                event: 'voice_event_send_failed',
                sessionId: session?.id ?? null,
                type,
            }));
        }
    }
    fail(socket, code, message, closeCode) {
        this.sendEvent(socket, 'voice.session.error', { code, message, recoverable: closeCode >= 4500 });
        socket.close(closeCode, code);
    }
    async persistRejectedStart(identity, event) {
        this.logger.warn(JSON.stringify({ event, tenantId: identity.tenantId }));
    }
    runInTenant(session, operation) {
        const context = {
            tenantId: session.context.agent.tenantId,
            actorType: session.context.agent.userId ? 'user' : 'widget',
            assistantId: session.context.assistantId,
            permissions: session.context.permissions,
            ...(session.context.agent.userId ? { userId: session.context.agent.userId } : {}),
            requestId: session.context.agent.requestId,
        };
        return tenant_context_store_1.tenantContextStore.run(context, operation);
    }
    bumpEpoch(session, reason) {
        session.epoch = (session.epoch + 1) >>> 0;
        session.incomingSequence = undefined;
        this.sendEvent(session.socket, 'voice.assistant.epoch', { epoch: session.epoch, reason }, session);
    }
};
exports.VoiceSessionManager = VoiceSessionManager;
exports.VoiceSessionManager = VoiceSessionManager = VoiceSessionManager_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(3, (0, common_1.Inject)(stt_port_1.SPEECH_TO_TEXT)),
    __param(4, (0, common_1.Inject)(vad_port_1.VOICE_ACTIVITY)),
    __param(5, (0, common_1.Inject)(tts_port_1.TEXT_TO_SPEECH)),
    __param(6, (0, common_1.Inject)(agent_invocation_port_1.AGENT_INVOCATION)),
    __param(7, (0, common_1.Inject)(shared_state_1.SHARED_STATE)),
    __param(8, (0, common_1.Optional)()),
    __param(9, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [voice_auth_service_1.VoiceAuthService,
        voice_session_repository_1.VoiceSessionRepository,
        conversations_service_1.ConversationsService, Object, Object, Object, Object, Object, voice_library_service_1.VoiceLibraryService,
        product_identity_service_1.ProductIdentityService])
], VoiceSessionManager);
function decodeAudioFrame(data) {
    if (data.length <= HEADER_BYTES)
        return undefined;
    const type = data.readUInt8(0);
    const epoch = data.readUInt32BE(1);
    const sequence = data.readUInt32BE(5);
    const payloadLength = data.readUInt16BE(9);
    if ((type !== 1 && type !== 2) || payloadLength === 0 || payloadLength > MAX_PAYLOAD_BYTES ||
        data.length !== HEADER_BYTES + payloadLength || payloadLength % 2 !== 0)
        return undefined;
    return { type, epoch, sequence, payload: data.subarray(HEADER_BYTES) };
}
function parseEvent(raw) {
    try {
        const value = JSON.parse(raw);
        const data = isRecord(value) ? value.data ?? {} : undefined;
        if (!isRecord(value) || value.v !== 1 || typeof value.type !== 'string' ||
            typeof value.ts !== 'string' || !Number.isFinite(Date.parse(value.ts)) ||
            typeof value.sessionId !== 'string' || !isRecord(data))
            return undefined;
        if (Object.keys(value).some((key) => !['v', 'type', 'ts', 'sessionId', 'data'].includes(key)))
            return undefined;
        return {
            v: 1,
            type: value.type,
            ts: value.ts,
            sessionId: value.sessionId,
            data,
        };
    }
    catch {
        return undefined;
    }
}
function rejectUnknownFields(value, allowed) {
    if (Object.keys(value).some((key) => !allowed.includes(key))) {
        throw new common_1.ForbiddenException('The voice session request is invalid.');
    }
}
function parseLanguage(value) {
    if (value === undefined || value === 'auto')
        return 'auto';
    if (value === 'en' || value === 'hi' || value === 'te')
        return value;
    throw new common_1.ForbiddenException('The selected voice language is invalid.');
}
function normalizeTranscript(value, maxLength) {
    return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
function splitSentences(value) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized)
        return [];
    return normalized.split(/(?<=[.!?。！？])\s+/u).flatMap((sentence) => {
        const parts = [];
        while (sentence.length > 500) {
            const space = sentence.lastIndexOf(' ', 500);
            const boundary = space > 0 ? space : 500;
            parts.push(sentence.slice(0, boundary));
            sentence = sentence.slice(boundary).trimStart();
        }
        if (sentence)
            parts.push(sentence);
        return parts;
    });
}
function defaultVoice(language) {
    return language === 'hi' ? 'hi_IN-pratham-medium' : 'en_US-amy-medium';
}
function stringField(value, maxLength) {
    return typeof value === 'string' ? value.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, maxLength) : undefined;
}
function classifyUserAgent(value) {
    if (!value)
        return null;
    if (/Edg\//.test(value))
        return 'Edge';
    if (/Chrome\//.test(value))
        return 'Chrome';
    if (/Firefox\//.test(value))
        return 'Firefox';
    if (/Safari\//.test(value))
        return 'Safari';
    return 'Other';
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
//# sourceMappingURL=voice-session.manager.js.map