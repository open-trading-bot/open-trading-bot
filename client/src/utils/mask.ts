export const MASKED = '••••';

export function maskAmount(formatted: string, hidden: boolean): string {
  return hidden ? MASKED : formatted;
}
