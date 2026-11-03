import { ZodError } from 'zod';
import type { Failure } from '../shared/types';
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export function fail(code: string, message: string): never {
  throw new AppError(code, message);
}
export function publicError(error: unknown): Failure {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  if (error instanceof ZodError)
    return {
      code: 'INVALID_INPUT',
      message: error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
    };
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'EACCES' || code === 'EPERM')
    return {
      code: 'PERMISSION',
      message:
        'Permission denied. Choose a writable directory. On Windows, symlinks may require Developer Mode.',
    };
  if (code === 'ENOENT')
    return {
      code: 'NOT_FOUND',
      message: 'A required file or directory no longer exists. Refresh and try again.',
    };
  if (code === 'ENOSPC')
    return { code: 'DISK_FULL', message: 'Not enough disk space. Free space before retrying.' };
  return {
    code: 'OPERATION_FAILED',
    message:
      'The operation failed. Original content has been preserved where possible. Refresh before retrying.',
  };
}
