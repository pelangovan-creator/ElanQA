import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { IdService } from './id.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from './storage.service';
import { ExportService } from './export/export.service';

@Global()
@Module({
  providers: [CryptoService, IdService, AuditService, StorageService, ExportService],
  exports: [CryptoService, IdService, AuditService, StorageService, ExportService],
})
export class CommonModule {}
