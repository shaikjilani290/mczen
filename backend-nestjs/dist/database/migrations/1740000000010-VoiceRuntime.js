"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceRuntime1740000000010 = void 0;
class VoiceRuntime1740000000010 {
    async up(queryRunner) {
        await queryRunner.query(`
      ALTER TABLE \`assistant_voice_settings\`
        ADD COLUMN \`stt_engine\` VARCHAR(50) NOT NULL DEFAULT 'faster-whisper-small-int8',
        ADD COLUMN \`stt_language_hint\` ENUM('auto','en','hi','te') NOT NULL DEFAULT 'auto',
        ADD COLUMN \`tts_engine\` VARCHAR(50) NOT NULL DEFAULT 'piper',
        ADD COLUMN \`tts_voice_fallback\` VARCHAR(100) NULL,
        ADD COLUMN \`vad_sensitivity\` DECIMAL(3,2) NOT NULL DEFAULT 0.50,
        ADD COLUMN \`endpoint_silence_ms\` SMALLINT UNSIGNED NOT NULL DEFAULT 700,
        ADD COLUMN \`min_speech_ms\` SMALLINT UNSIGNED NOT NULL DEFAULT 80,
        ADD COLUMN \`barge_in_enabled\` TINYINT(1) NOT NULL DEFAULT 1,
        ADD COLUMN \`silence_nudge_after_s\` SMALLINT UNSIGNED NOT NULL DEFAULT 10,
        ADD COLUMN \`session_idle_timeout_s\` SMALLINT UNSIGNED NOT NULL DEFAULT 300
    `);
        await queryRunner.query(`
      ALTER TABLE \`assistant_language_settings\`
        ADD COLUMN \`tts_voice\` VARCHAR(100) NULL,
        ADD COLUMN \`tts_rate\` DECIMAL(3,2) NULL,
        ADD COLUMN \`voice_enabled\` TINYINT(1) NOT NULL DEFAULT 0
    `);
        await queryRunner.query(`
      UPDATE \`assistant_language_settings\` als
      JOIN \`assistant_voice_settings\` avs
        ON avs.\`assistant_id\`=als.\`assistant_id\` AND avs.\`tenant_id\`=als.\`tenant_id\`
      SET als.\`voice_enabled\`=IF(avs.\`speech_enabled\`=1 AND als.\`is_enabled\`=1
          AND als.\`language_code\` IN ('en','hi'),1,0),
        als.\`tts_voice\`=CASE
          WHEN als.\`language_code\`='en' AND avs.\`voice_gender\`='male' THEN 'en_US-lessac-medium'
          WHEN als.\`language_code\`='en' THEN 'en_US-amy-medium'
          WHEN als.\`language_code\`='hi' AND avs.\`voice_gender\`='female' THEN 'hi_IN-priyamvada-medium'
          WHEN als.\`language_code\`='hi' THEN 'hi_IN-pratham-medium'
          ELSE NULL
        END
      WHERE als.\`language_code\` IN ('en','hi')
    `);
        await queryRunner.query(`
      CREATE TABLE \`voice_sessions\` (
        \`id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`assistant_id\` BINARY(16) NOT NULL,
        \`conversation_id\` BINARY(16) NULL,
        \`user_id\` BINARY(16) NULL,
        \`language_code\` CHAR(7) NOT NULL,
        \`state\` ENUM('idle','listening','detecting_end_of_speech','transcribing','thinking','speaking','interrupted','error','closed') NOT NULL DEFAULT 'idle',
        \`stt_engine\` VARCHAR(50) NOT NULL,
        \`tts_engine\` VARCHAR(50) NOT NULL,
        \`settings_snapshot\` JSON NULL,
        \`turn_count\` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        \`interrupt_count\` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
        \`listen_ms\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`speak_ms\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`total_ms\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`audio_bytes_received\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
        \`error_code\` VARCHAR(50) NULL,
        \`close_reason\` VARCHAR(50) NULL,
        \`client_info\` VARCHAR(255) NULL,
        \`started_at\` DATETIME(3) NOT NULL,
        \`last_active_at\` DATETIME(3) NOT NULL,
        \`ended_at\` DATETIME(3) NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_voice_sessions_id_tenant\` (\`id\`,\`tenant_id\`),
        KEY \`ix_voice_sessions_tenant_started\` (\`tenant_id\`,\`started_at\`),
        KEY \`ix_voice_sessions_assistant_started\` (\`assistant_id\`,\`started_at\`),
        KEY \`ix_voice_sessions_state\` (\`state\`),
        KEY \`ix_voice_sessions_last_active\` (\`last_active_at\`),
        CONSTRAINT \`fk_voice_sessions_tenants\` FOREIGN KEY (\`tenant_id\`)
          REFERENCES \`tenants\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_voice_sessions_assistant\` FOREIGN KEY (\`assistant_id\`,\`tenant_id\`)
          REFERENCES \`assistants\` (\`id\`,\`tenant_id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_voice_sessions_conversation\` FOREIGN KEY (\`conversation_id\`,\`tenant_id\`)
          REFERENCES \`conversations\` (\`id\`,\`tenant_id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_voice_sessions_users\` FOREIGN KEY (\`user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
        await queryRunner.query(`
      CREATE TABLE \`voice_session_events\` (
        \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`session_id\` BINARY(16) NOT NULL,
        \`tenant_id\` BINARY(16) NOT NULL,
        \`event\` ENUM('session_start','session_resume','turn_start','endpoint_detected','transcript_final',
          'interrupt','tts_engine_fallback','stt_engine_fallback','session_limit_rejected',
          'oversize_frame_rejected','sequence_gap','session_error','session_close',
          'malformed_frame','stale_frame_dropped','duplicate_frame','late_agent_response_discarded')
          NOT NULL,
        \`elapsed_ms\` INT UNSIGNED NULL,
        \`detail\` VARCHAR(255) NULL,
        \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        KEY \`ix_voice_session_events_session\` (\`session_id\`),
        KEY \`ix_voice_session_events_tenant_event\` (\`tenant_id\`,\`event\`),
        CONSTRAINT \`fk_voice_session_events_sessions\` FOREIGN KEY (\`session_id\`,\`tenant_id\`)
          REFERENCES \`voice_sessions\` (\`id\`,\`tenant_id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    }
    async down(queryRunner) {
        await queryRunner.query('DROP TABLE IF EXISTS `voice_session_events`');
        await queryRunner.query('DROP TABLE IF EXISTS `voice_sessions`');
        await queryRunner.query(`
      ALTER TABLE \`assistant_language_settings\`
        DROP COLUMN \`voice_enabled\`,
        DROP COLUMN \`tts_rate\`,
        DROP COLUMN \`tts_voice\`
    `);
        await queryRunner.query(`
      ALTER TABLE \`assistant_voice_settings\`
        DROP COLUMN \`session_idle_timeout_s\`,
        DROP COLUMN \`silence_nudge_after_s\`,
        DROP COLUMN \`barge_in_enabled\`,
        DROP COLUMN \`min_speech_ms\`,
        DROP COLUMN \`endpoint_silence_ms\`,
        DROP COLUMN \`vad_sensitivity\`,
        DROP COLUMN \`tts_voice_fallback\`,
        DROP COLUMN \`tts_engine\`,
        DROP COLUMN \`stt_language_hint\`,
        DROP COLUMN \`stt_engine\`
    `);
    }
}
exports.VoiceRuntime1740000000010 = VoiceRuntime1740000000010;
//# sourceMappingURL=1740000000010-VoiceRuntime.js.map