import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { IdService } from './id.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [CryptoService, IdService, AuditService, StorageService],
  exports: [CryptoService, IdService, AuditService, StorageService],
})
export class CommonModule {}
