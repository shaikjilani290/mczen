import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/auth-context';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators';
import { KnowledgeContentService } from './knowledge-content.service';
import { KnowledgeDocumentsService } from './knowledge-documents.service';
import { MAX_UPLOAD_BYTES, UploadedFileLike } from './document-extractor';
import {
  parseArticle, parseArticleQuery, parseCategory, parseDocumentMeta, parseDocumentQuery, parseSearchQuery,
} from './knowledge.dto';

const UPLOAD = FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10, parts: 12 } });

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
};

/**
 * Tenant knowledge administration. The tenant always comes from the verified
 * context (guard + ALS) inside the repository; ids in routes are looked up
 * within that tenant so foreign ids return 404, and bodies/queries/multipart
 * fields reject unknown keys (including any tenantId).
 */
@Controller('api/knowledge')
export class KnowledgeController {
  constructor(private readonly content: KnowledgeContentService, private readonly documents: KnowledgeDocumentsService) {}

  @Get('dashboard')
  @RequirePermission('knowledge:read')
  dashboard() { return this.content.dashboard(); }

  @Get('search')
  @RequirePermission('knowledge:read')
  search(@Query() query: unknown) { return this.content.search(parseSearchQuery(query)); }

  // ----- categories -----

  @Get('categories')
  @RequirePermission('knowledge:read')
  categories() { return this.content.listCategories(); }

  @Post('categories')
  @RequirePermission('knowledge:write')
  createCategory(@Body() body: unknown) { return this.content.createCategory(parseCategory(body)); }

  @Patch('categories/:id')
  @RequirePermission('knowledge:write')
  updateCategory(@Param('id') id: string, @Body() body: unknown) { return this.content.updateCategory(id, parseCategory(body, true)); }

  @Delete('categories/:id')
  @HttpCode(200)
  @RequirePermission('knowledge:write')
  deleteCategory(@Param('id') id: string) { return this.content.deleteCategory(id); }

  // ----- articles -----

  @Get('articles')
  @RequirePermission('knowledge:read')
  listArticles(@Query() query: unknown) { return this.content.listArticles(parseArticleQuery(query)); }

  @Post('articles')
  @RequirePermission('knowledge:write')
  createArticle(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.content.createArticle(parseArticle(body), user.userId);
  }

  @Get('articles/:id')
  @RequirePermission('knowledge:read')
  getArticle(@Param('id') id: string) { return this.content.getArticle(id); }

  @Patch('articles/:id')
  @RequirePermission('knowledge:write')
  updateArticle(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    return this.content.updateArticle(id, parseArticle(body, true), user.userId);
  }

  @Post('articles/:id/archive')
  @HttpCode(200)
  @RequirePermission('knowledge:write')
  archiveArticle(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.content.archiveArticle(id, user.userId);
  }

  // ----- documents -----

  @Get('documents')
  @RequirePermission('knowledge:read')
  listDocuments(@Query() query: unknown) { return this.documents.list(parseDocumentQuery(query)); }

  @Post('documents')
  @UseInterceptors(UPLOAD)
  @RequirePermission('knowledge:write')
  upload(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: UploadedFileLike | undefined, @Body() body: unknown) {
    return this.documents.upload(file, parseDocumentMeta(body), user.userId);
  }

  @Get('documents/:id')
  @RequirePermission('knowledge:read')
  getDocument(@Param('id') id: string) { return this.documents.get(id); }

  @Patch('documents/:id')
  @RequirePermission('knowledge:write')
  updateDocument(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    return this.documents.update(id, parseDocumentMeta(body, true), user.userId);
  }

  @Put('documents/:id/file')
  @UseInterceptors(UPLOAD)
  @RequirePermission('knowledge:write')
  replaceFile(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @UploadedFile() file: UploadedFileLike | undefined) {
    return this.documents.replaceFile(id, file, user.userId);
  }

  @Post('documents/:id/reprocess')
  @HttpCode(200)
  @RequirePermission('knowledge:write')
  reprocess(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.documents.reprocess(id, user.userId); }

  @Post('documents/:id/archive')
  @HttpCode(200)
  @RequirePermission('knowledge:write')
  archiveDocument(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) { return this.documents.archive(id, user.userId); }

  @Get('documents/:id/download')
  @RequirePermission('knowledge:read')
  async download(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { data, filename, fileType } = await this.documents.download(id);
    res.set({
      'Content-Type': CONTENT_TYPES[fileType] ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(data);
  }
}
