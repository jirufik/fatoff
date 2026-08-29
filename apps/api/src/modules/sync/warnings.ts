import type { SyncWarningDto, WarningKind } from '@fatoff/contracts';

import { YazioApiError, YazioAuthError } from '../yazio/yazio-client';

/**
 * Сбор проблем, а не их проглатывание.
 *
 * Выгрузка истории — тысячи запросов, и падение одного из них не должно ронять
 * всю работу. Но и молча превращаться в пустой день оно не должно: каждая
 * неудача становится строкой, которую видно в интерфейсе и в выгрузке.
 */
export class WarningCollector {
  private readonly items: SyncWarningDto[] = [];

  get length(): number {
    return this.items.length;
  }

  all(): SyncWarningDto[] {
    return [...this.items];
  }

  /** Сбой запроса. */
  record(phase: string, endpoint: string, key: string | null, error: unknown): void {
    this.items.push({
      phase,
      endpoint,
      key,
      kind: kindOf(error),
      status: error instanceof YazioApiError ? error.status : null,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  /** Странность в данных, а не в запросе. */
  note(phase: string, key: string | null, message: string): void {
    this.items.push({ phase, endpoint: phase, key, kind: 'data', status: null, message });
  }
}

function kindOf(error: unknown): WarningKind {
  if (error instanceof YazioApiError) return 'http';
  if (error instanceof YazioAuthError) return 'http';
  if (error instanceof SyntaxError) return 'decode';
  return 'transport';
}
