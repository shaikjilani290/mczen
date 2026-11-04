import { Module } from '@nestjs/common';
import { AssistantRepository } from './assistant.repository';
import { AssistantsController } from './assistants.controller';
import { AssistantsService } from './assistants.service';
import { SecretCipher } from './secret-cipher.service';

@Module({
  controllers: [AssistantsController],
  providers: [AssistantsService, AssistantRepository, SecretCipher],
})
export class AssistantsModule {}
