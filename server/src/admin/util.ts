import type { Request } from 'express';

/** Normalize Express route params (string | string[]) to a single string */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}
