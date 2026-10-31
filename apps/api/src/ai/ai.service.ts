import { Global, Injectable, Logger, Module } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Thin wrapper over the Claude API for structured (schema-validated) JSON generation.
 * - Disabled when ANTHROPIC_API_KEY is unset: callers must use their rule-based fallback.
 * - Model from CLAUDE_MODEL (default claude-opus-5-5).
 * - Server-side refusal fallback is enabled ("default" routing) so a declined request is retried
 *   on a suitable model inside the same call; a final refusal returns null (caller falls back).
 * Never throws: any API failure is logged and returns null so the rule-based path takes over.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic | null;
  readonly model = process.env.CLAUDE_MODEL || 'claude-opus-5-5';

  constructor() {
    this.client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ maxRetries: 3 }) : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async parse<S extends z.ZodType>(opts: { schema: S; system: string; user: string; effort?: Effort; maxTokens?: number }): Promise<z.infer<S> | null> {
    if (!this.client) return null;
    try {
      const res = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: opts.maxTokens ?? 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
        output_config: { effort: opts.effort ?? 'medium', format: zodOutputFormat(opts.schema) },
      });
      if (res.stop_reason === 'refusal') {
        this.logger.warn(`AI request declined (${res.stop_details?.category ?? 'unknown'}); using rule-based fallback`);
        return null;
      }
      if (res.stop_reason === 'max_tokens') {
        this.logger.warn('AI response truncated (max_tokens); using rule-based fallback');
        return null;
      }
      return (res.parsed_output as z.infer<S> | null) ?? null;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) this.logger.error('ANTHROPIC_API_KEY rejected; using rule-based fallback');
      else if (err instanceof Anthropic.RateLimitError) this.logger.warn('Claude rate limit hit after retries; using rule-based fallback');
      else if (err instanceof Anthropic.APIError) this.logger.error(`Claude API error ${err.status}: ${err.message}`);
      else this.logger.error(`AI call failed: ${(err as Error).message}`);
      return null;
    }
  }
}

@Global()
@Module({ providers: [AiService], exports: [AiService] })
export class AiModule {}
