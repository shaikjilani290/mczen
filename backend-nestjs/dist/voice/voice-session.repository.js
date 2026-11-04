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
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceSessionRepository = void 0;
const typeorm_1 = require("@nestjs/typeorm");
const common_1 = require("@nestjs/common");
const common_2 = require("@nestjs/common");
const typeorm_2 = require("typeorm");
const uuid_1 = require("../common/ids/uuid");
let VoiceSessionRepository = class VoiceSessionRepository {
    source;
    constructor(source) {
        this.source = source;
    }
    async create(session, clientInfo) {
        const database = this.getDatabase();
        const { context } = session;
        await database.query(`INSERT INTO \`voice_sessions\` (\`id\`,\`tenant_id\`,\`assistant_id\`,\`conversation_id\`,\`user_id\`,
        \`language_code\`,\`state\`,\`stt_engine\`,\`tts_engine\`,\`settings_snapshot\`,\`client_info\`,
        \`started_at\`,\`last_active_at\`)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
            (0, uuid_1.uuidToBinary)(session.id),
            (0, uuid_1.uuidToBinary)(context.agent.tenantId),
            (0, uuid_1.uuidToBinary)(context.assistantId),
            context.conversationId ? (0, uuid_1.uuidToBinary)(context.conversationId) : null,
            context.agent.userId ? (0, uuid_1.uuidToBinary)(context.agent.userId) : null,
            context.language === 'auto' ? 'en' : context.language,
            'listening',
            context.settings.sttEngineId,
            context.settings.ttsEngineId,
            JSON.stringify(safeSettings(context.settings)),
            clientInfo,
            new Date(session.startedAt),
            new Date(session.startedAt),
        ]);
        await this.event(session, 'session_start');
    }
    async event(session, event, detail) {
        await this.getDatabase().query(`INSERT INTO \`voice_session_events\` (\`session_id\`,\`tenant_id\`,\`event\`,\`elapsed_ms\`,\`detail\`)
       VALUES (?,?,?,?,?)`, [
            (0, uuid_1.uuidToBinary)(session.id),
            (0, uuid_1.uuidToBinary)(session.context.agent.tenantId),
            event,
            Math.min(Date.now() - session.startedAt, 0xffffffff),
            detail ? detail.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 255) : null,
        ]);
    }
    async updateConversation(session, conversationId) {
        await this.getDatabase().query(`UPDATE \`voice_sessions\` SET \`conversation_id\`=?,\`last_active_at\`=UTC_TIMESTAMP(3)
       WHERE \`id\`=? AND \`tenant_id\`=? AND \`ended_at\` IS NULL`, [
            (0, uuid_1.uuidToBinary)(conversationId),
            (0, uuid_1.uuidToBinary)(session.id),
            (0, uuid_1.uuidToBinary)(session.context.agent.tenantId),
        ]);
    }
    async updateState(session) {
        await this.getDatabase().query(`UPDATE \`voice_sessions\` SET \`state\`=?,\`language_code\`=?,\`last_active_at\`=UTC_TIMESTAMP(3)
       WHERE \`id\`=? AND \`tenant_id\`=? AND \`ended_at\` IS NULL`, [
            session.state,
            session.context.language === 'auto' ? 'en' : session.context.language,
            (0, uuid_1.uuidToBinary)(session.id),
            (0, uuid_1.uuidToBinary)(session.context.agent.tenantId),
        ]);
    }
    async close(session, reason, errorCode) {
        const now = Date.now();
        const total = Math.min(now - session.startedAt, 0xffffffff);
        await this.getDatabase().query(`UPDATE \`voice_sessions\` SET \`state\`='closed',\`audio_bytes_received\`=?,
        \`turn_count\`=\`turn_count\`+?,\`interrupt_count\`=\`interrupt_count\`+?,
        \`listen_ms\`=?,\`speak_ms\`=?,\`total_ms\`=?,\`error_code\`=?,\`close_reason\`=?,
        \`last_active_at\`=UTC_TIMESTAMP(3),\`ended_at\`=UTC_TIMESTAMP(3)
       WHERE \`id\`=? AND \`tenant_id\`=? AND \`ended_at\` IS NULL`, [
            session.audioBytes,
            session.turnsCompleted,
            session.interrupts,
            Math.min(session.listenMs, 0xffffffff),
            Math.min(session.speakMs, 0xffffffff),
            total,
            errorCode,
            reason.slice(0, 50),
            (0, uuid_1.uuidToBinary)(session.id),
            (0, uuid_1.uuidToBinary)(session.context.agent.tenantId),
        ]);
        await this.event(session, 'session_close', errorCode ?? reason);
    }
    getDatabase() {
        if (!this.source)
            throw new common_1.ServiceUnavailableException('Voice persistence is unavailable.');
        return this.source;
    }
};
exports.VoiceSessionRepository = VoiceSessionRepository;
exports.VoiceSessionRepository = VoiceSessionRepository = __decorate([
    (0, common_2.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, typeorm_1.InjectDataSource)()),
    __metadata("design:paramtypes", [typeorm_2.DataSource])
], VoiceSessionRepository);
function safeSettings(settings) {
    return {
        sttEngineId: settings.sttEngineId,
        ttsEngineId: settings.ttsEngineId,
        sttLanguageHint: settings.sttLanguageHint,
        ttsVoice: settings.ttsVoice,
        vadSensitivity: settings.vadSensitivity,
        endpointSilenceMs: settings.endpointSilenceMs,
        minSpeechMs: settings.minSpeechMs,
        silenceNudgeMs: settings.silenceNudgeMs,
        bargeInEnabled: settings.bargeInEnabled,
        speechRate: settings.speechRate,
    };
}
//# sourceMappingURL=voice-session.repository.js.map