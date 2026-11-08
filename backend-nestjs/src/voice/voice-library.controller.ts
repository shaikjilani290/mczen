import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators';
import type { AuthenticatedUser } from '../auth/auth-context';
import { MAX_VOICE_UPLOAD, VoiceLibraryService } from './voice-library.service';

@Controller('api/voice/profiles')
export class VoiceLibraryController {
  constructor(private readonly library: VoiceLibraryService) {}

  @Get()
  @RequirePermission('assistants:write')
  list() { return this.library.list(); }

  @Post()
  @RequirePermission('assistants:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_VOICE_UPLOAD, files: 1, fields: 3, parts: 4 } }))
  upload(@UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.library.create(file, body, user.userId);
  }

  @Post(':id/process')
  @RequirePermission('assistants:write')
  process(@Param('id') id: string) { return this.library.process(id); }

  @Patch(':id')
  @RequirePermission('assistants:write')
  setActive(@Param('id') id: string, @Body() body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
        !('active' in body) || typeof body.active !== 'boolean') throw new BadRequestException('Only a boolean active field is accepted.');
    return this.library.setActive(id, body.active);
  }

  @Post(':id/preview')
  @RequirePermission('assistants:write')
  async preview(@Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
        !('text' in body) || typeof body.text !== 'string') throw new BadRequestException('Preview text is required.');
    const audio = await this.library.preview(id, body.text);
    response.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(audio);
  }

  @Delete(':id')
  @RequirePermission('assistants:write')
  remove(@Param('id') id: string) { return this.library.remove(id); }
}
