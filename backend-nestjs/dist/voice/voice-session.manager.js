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
const stt_port_1 = require("./stt/stt.port");
const vad_port_1 = require("./vad/vad.port");
const tts_port_1 = require("./tts/tts.port");
const HEADER_BYTES = 11;
const MAX_PAYLOAD_BYTES = 14_400;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_UTTERANCE_BYTES = 20 * 1024 * 1024;
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
    logger = new common_1.Logger(VoiceSessionManager_1.name);
    sessions = new Map();
    ingressWindowStart = Date.now();
    ingressWindowBytes = 0;
    constructor(auth, persistence, conversations, stt, vad, tts, agent, store) {
        this.auth = auth;
        this.persistence = persistence;
        this.conversations = conversations;
        this.stt = stt;
        this.vad = vad;
        this.tts = tts;
        this.agent = agent;
        this.store = store;
    }
    async begin(socket, identity, input, userAgent) {
        rejectUnknownFields(input, ['assistantId', 'conversationId', 'language', 'resumeToken', 'lastEpoch', 'audioFormat', 'voiceId']);
        if (input.audioFormat !== undefined && input.audioFormat !== 'pcm_s16le/16000/mono') {
            return this.fail(socket, 'AUDIO_FORMAT_MISMATCH', 'Only 16 kHz mono PCM16 audio is supported.', 4410);
        }
        if (typeof input.resumeToken === 'string') {
            await this.resume(socket, identity, input.resumeToken, input.lastEpoch);
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
        if (input.voiceId !== undefined) {
            const selectedLanguage = language === 'auto' ? defaultLanguage : language;
            if (typeof input.voiceId !== 'string' || !this.tts.supportsVoice(selectedLanguage, input.voiceId)) {
                return this.fail(socket, 'INVALID_VOICE', 'The selected voice is unavailable.', 4410);
            }
            settings.ttsVoice = input.voiceId;
        }
        if (language === 'auto' && allowedLanguages.length === 0) {
            throw new common_1.ForbiddenException('Voice is not enabled for this assistant.');
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
        try {
            await this.runInTenant(session, async () => {
                let conversationId;
                if (typeof requestedConversationId === 'string') {
                    const prepared = await this.conversations.prepareAgentTurn(requestedConversationId, agentContext);
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
                this.sessions.set(sessionId, session);
                session.slotTimer = setInterval(() => void this.renewSlots(session), SLOT_RENEW_MS);
                session.slotTimer.unref?.();
                this.sendEvent(socket, 'voice.session.started', {
                    sessionId,
                    epoch: session.epoch,
                    settings: {
                        sttEngineId: settings.sttEngineId,
                        ttsEngineId: settings.ttsEngineId,
                        vadSensitivity: settings.vadSensitivity,
                        endpointSilenceMs: settings.endpointSilenceMs,
                        audioFormat: 'pcm_s16le/16000/mono',
                        defaultLanguage,
                        allowedLanguages,
                        ttsLanguages,
                        voices: session.context.voiceOptions,
                        conversationId: conversationId ?? null,
                    },
                    language,
                }, session);
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
        await Promise.all(scopes.map((scope) => this.store.releaseSlot(scope, member).catch(() => undefined)));
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
        if (event.type === 'voice.audio.end') {
            await this.finalizeUtterance(session, 'client_end');
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
            this.sendError(session, 'INGRESS_BACKPRESSURE', 'The voice service is temporarily busy.', true);
            return;
        }
        session.audioBytes += frame.payload.length;
        session.pendingAudioBytes += frame.payload.length;
        session.audioQueue.push(frame.payload);
        let droppedBytes = 0;
        while (session.pendingAudioBytes > 64_000 && session.audioQueue.length > 1) {
            const dropped = session.audioQueue.shift();
            session.pendingAudioBytes -= dropped.length;
            droppedBytes += dropped.length;
        }
        session.lastActivityAt = now;
        this.armIdleTimer(session);
        if (droppedBytes > 0) {
            this.sendEvent(session.socket, 'voice.session.error', {
                code: 'INGRESS_BACKPRESSURE',
                message: 'Older audio was dropped to keep the live stream responsive.',
                recoverable: true,
                droppedMs: Math.floor(droppedBytes / 32),
            }, session);
        }
        this.drainAudio(session);
    }
    onDisconnect(socket) {
        const session = [...this.sessions.values()].find((item) => item.socket === socket);
        if (!session || session.state === 'closed')
            return;
        session.socket = undefined;
        session.ttsAbort?.abort();
        session.turnAbort?.abort();
        session.sttAbort?.abort();
        session.partialAbort?.abort();
        session.currentAudio = [];
        session.currentAudioBytes = 0;
        session.audioQueue = [];
        session.pendingAudioBytes = 0;
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
                    const payload = session.audioQueue.shift();
                    try {
                        await this.runInTenant(session, () => this.consumeAudio(session, payload));
                    }
                    catch {
                        await this.pipelineFailure(session);
                    }
                    finally {
                        session.pendingAudioBytes = Math.max(0, session.pendingAudioBytes - payload.length);
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
    async resume(socket, identity, token, lastEpoch) {
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
        this.sendEvent(socket, 'voice.session.resumed', { sessionId: session.id, epoch: session.epoch }, session);
        await this.recordEvent(session, 'session_resume');
        this.rotateResumeToken(session);
        this.armTimers(session);
    }
    async consumeAudio(session, payload) {
        const extended = session;
        for (let offset = 0; offset < payload.length; offset += FRAME_BYTES) {
            const piece = payload.subarray(offset, Math.min(payload.length, offset + FRAME_BYTES));
            session.vadPending = Buffer.concat([session.vadPending, piece]);
            while (session.vadPending.length >= FRAME_BYTES) {
                const vadFrame = session.vadPending.subarray(0, FRAME_BYTES);
                session.vadPending = session.vadPending.subarray(FRAME_BYTES);
                session.listenMs += 20;
                const controller = new AbortController();
                const result = await this.vad.detect({
                    streamId: session.id,
                    audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: vadFrame },
                    signal: controller.signal,
                });
                const speech = result.speech && result.probability >= session.context.settings.vadSensitivity;
                if (speech) {
                    if (session.state === 'speaking' && session.context.settings.bargeInEnabled) {
                        await this.interrupt(session, 'vad_barge_in');
                    }
                    if (session.state === 'listening' || session.state === 'interrupted') {
                        session.currentAudio = [...extended.preRoll];
                        session.currentAudioBytes = session.currentAudio.reduce((sum, block) => sum + block.length, 0);
                        session.speechMs = 0;
                        session.silenceMs = 0;
                        session.utteranceStartedAt = Date.now();
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
                        if (session.state === 'detecting_end_of_speech' &&
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
                if (session.currentAudioBytes > MAX_UTTERANCE_BYTES) {
                    this.sendError(session, 'UTTERANCE_TOO_LARGE', 'The spoken turn is too long.', true);
                    await this.resetTurn(session, 'turn_reset');
                }
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
        session.state = 'transcribing';
        this.sendEvent(session.socket, 'voice.assistant.thinking', { hint: 'transcribing' }, session);
        await this.persistState(session);
        await this.recordEvent(session, 'endpoint_detected', reason);
        const audio = Buffer.concat(session.currentAudio);
        session.partialAbort?.abort();
        session.sttAbort?.abort();
        const controller = new AbortController();
        session.sttAbort = controller;
        try {
            const result = await this.stt.transcribe({
                audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, data: audio },
                language: session.context.language === 'auto'
                    ? session.context.settings.sttLanguageHint
                    : session.context.language,
                partial: false,
                signal: controller.signal,
            });
            if (session.epoch !== epoch || session.state !== 'transcribing') {
                await this.recordEvent(session, 'late_agent_response_discarded', 'stale_transcription');
                return;
            }
            const text = normalizeTranscript(result.text, 2000);
            if (!text) {
                await this.resetTurn(session, 'turn_reset');
                return;
            }
            session.context.language = session.context.language === 'auto' ? result.language : session.context.language;
            this.sendEvent(session.socket, 'voice.transcript.final', {
                text,
                language: result.language,
                confidence: result.confidence ?? null,
                durationMs: Date.now() - (session.utteranceStartedAt ?? Date.now()),
            }, session);
            await this.recordEvent(session, 'transcript_final', `language_${result.language}`);
            await this.invokeAgent(session, text, epoch);
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
            if (session.sttAbort === controller)
                session.sttAbort = undefined;
        }
    }
    async invokeAgent(session, text, epoch) {
        if (session.state !== 'transcribing' || session.epoch !== epoch)
            return;
        session.state = 'thinking';
        const turnId = (0, node_crypto_1.randomUUID)();
        session.turnId = turnId;
        session.turnAbort = new AbortController();
        await this.persistState(session);
        this.sendEvent(session.socket, 'voice.assistant.thinking', {}, session);
        await this.recordEvent(session, 'turn_start', 'agent');
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
                const response = await this.agent.invoke(text, session.context.agent, session.turnAbort.signal);
                if (session.state !== 'thinking' || session.epoch !== epoch || session.turnId !== turnId) {
                    await this.recordEvent(session, 'late_agent_response_discarded');
                    return;
                }
                await this.speakResponse(session, response, epoch, turnId);
            });
        }
        catch {
            if (this.sessions.get(session.id) === session && session.epoch === epoch && session.turnId === turnId) {
                this.sendError(session, 'AGENT_UNAVAILABLE', 'The assistant could not complete this turn.', true);
                await this.resetTurn(session, 'recovered');
            }
        }
    }
    async speakResponse(session, response, epoch, turnId) {
        if (!response || typeof response.answer !== 'string' || response.answer.length > 32_000) {
            throw new Error('Invalid agent response.');
        }
        const sentences = splitSentences(response.answer);
        this.sendEvent(session.socket, 'voice.assistant.response', {
            success: response.success,
            answer: response.answer,
            model: response.model,
            toolCalls: response.toolCalls.slice(0, 50),
            sources: response.sources.slice(0, 50),
            turnId,
        }, session);
        for (const sentence of sentences) {
            if (!this.isCurrentTurn(session, epoch, turnId))
                return;
            this.sendEvent(session.socket, 'voice.assistant.text.delta', { delta: sentence, turnId }, session);
        }
        if (!response.success || !sentences.length) {
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
            this.tts.supportsVoice(language, session.context.settings.ttsVoice)
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
        for (const sentence of sentences) {
            const iterable = this.tts.synthesize({
                text: sentence,
                language,
                voice,
                rate,
                signal: ttsAbort.signal,
            });
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
                    this.sendEvent(session.socket, 'voice.assistant.audio.chunk', {
                        epoch,
                        turnId,
                        encoding: 'pcm_s16le',
                        sampleRate,
                        frames: 0,
                    }, session);
                    announced = true;
                }
                this.sendPcmChunks(session, chunk.data, epoch);
            }
        }
        if (!this.isCurrentTurn(session, epoch, turnId) || ttsAbort.signal.aborted)
            return;
        const totalMs = Math.floor(totalBytes / (sampleRate * 2) * 1000);
        this.sendEvent(session.socket, 'voice.assistant.audio.end', { epoch, turnId, totalMs }, session);
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
        session.interrupts++;
        session.ttsAbort?.abort();
        session.turnAbort?.abort();
        session.sttAbort?.abort();
        session.partialAbort?.abort();
        session.ttsAbort = undefined;
        session.turnAbort = undefined;
        session.turnId = undefined;
        session.currentAudio = [];
        session.currentAudioBytes = 0;
        session.audioQueue = [];
        session.pendingAudioBytes = 0;
        session.pendingAudioBytes = 0;
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
        session.currentAudio = [];
        session.currentAudioBytes = 0;
        session.speechMs = 0;
        session.silenceMs = 0;
        session.utteranceStartedAt = undefined;
        session.lastPartialAt = undefined;
        session.turnId = undefined;
        session.turnAbort = undefined;
        session.ttsAbort = undefined;
        session.state = 'listening';
        session.epoch = (session.epoch + 1) >>> 0;
        this.sendEvent(session.socket, 'voice.assistant.epoch', { epoch: session.epoch, reason }, session);
        await this.persistState(session);
    }
    async pipelineFailure(session) {
        if (session.state === 'closed')
            return;
        this.sendError(session, 'VOICE_ENGINE_UNAVAILABLE', 'The voice service is temporarily unavailable.', true);
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
        session.turnAbort?.abort();
        session.ttsAbort?.abort();
        session.sttAbort?.abort();
        session.partialAbort?.abort();
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
        void this.releaseSlots(session.id, session.slotScopes ?? []);
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
            this.sendError(session, 'SEQUENCE_GAP', 'An audio frame was missed.', true);
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
    __metadata("design:paramtypes", [voice_auth_service_1.VoiceAuthService,
        voice_session_repository_1.VoiceSessionRepository,
        conversations_service_1.ConversationsService, Object, Object, Object, Object, Object])
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
    return normalized.match(/[^.!?。！？]+[.!?。！？]*/g)?.map((item) => item.trim()).filter(Boolean) ?? [normalized];
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