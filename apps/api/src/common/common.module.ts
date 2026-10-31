import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { IdService } from './id.service';
import { AuditService } from '../audit/audit.service';

@Global()
@Module({
  providers: [CryptoService, IdService, AuditService],
  exports: [CryptoService, IdService, AuditService],
})
export class CommonModule {}
