import { BadRequestException, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Response } from 'express';
import { renderDocx } from './docx';
import { EXPORT_FORMATS, ExportDoc, ExportFormat, MIME } from './model';
import { closePdfBrowser, renderPdf } from './pdf';
import { renderXlsx } from './xlsx';

@Injectable()
export class ExportService implements OnModuleDestroy {
  async render(doc: ExportDoc, format: string): Promise<{ data: Buffer; mime: string; ext: ExportFormat }> {
    if (!EXPORT_FORMATS.includes(format as ExportFormat)) throw new BadRequestException(`format must be one of ${EXPORT_FORMATS.join(', ')}`);
    const f = format as ExportFormat;
    const data = f === 'xlsx' ? await renderXlsx(doc) : f === 'pdf' ? await renderPdf(doc) : await renderDocx(doc);
    return { data, mime: MIME[f], ext: f };
  }

  async send(res: Response, doc: ExportDoc, format: string, baseName: string) {
    const out = await this.render(doc, format || 'xlsx');
    const name = `${baseName.replace(/[^A-Za-z0-9._-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.${out.ext}`;
    res.setHeader('Content-Type', out.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(out.data);
  }

  async onModuleDestroy() {
    await closePdfBrowser();
  }
}
