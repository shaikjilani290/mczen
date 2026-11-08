import { Module } from '@nestjs/common';
import { DocumentStorage, LocalDocumentStorage } from './document-storage';
import { KnowledgeContentService } from './knowledge-content.service';
import { KnowledgeDocumentsService } from './knowledge-documents.service';
import { KNOWLEDGE_RETRIEVER, MysqlKnowledgeRetriever } from './knowledge-retriever';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeRepository } from './knowledge.repository';

/** Must not import AgentModule: AgentModule imports this module for the knowledge_search tool. */
@Module({
  controllers: [KnowledgeController],
  providers: [
    KnowledgeRepository,
    KnowledgeContentService,
    KnowledgeDocumentsService,
    MysqlKnowledgeRetriever,
    { provide: KNOWLEDGE_RETRIEVER, useExisting: MysqlKnowledgeRetriever },
    { provide: DocumentStorage, useClass: LocalDocumentStorage },
  ],
  exports: [KNOWLEDGE_RETRIEVER, KnowledgeRepository],
})
export class KnowledgeModule {}
