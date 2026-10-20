export type Severity = 'error' | 'warn' | 'info' | 'ok';

export interface WarningItem {
  severity: Severity;
  key: string;
  params?: Record<string, string | number>;
}
