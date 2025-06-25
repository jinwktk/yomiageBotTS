import type { ILogger } from '../interfaces/github-monitor.interface';

export const LogLevel = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
} as const;

export type LogLevel = typeof LogLevel[keyof typeof LogLevel];

export class LoggerService implements ILogger {
  private prefix: string;
  private logLevel: LogLevel;

  constructor(prefix: string = '', logLevel?: LogLevel) {
    this.prefix = prefix ? `[${prefix}] ` : '';
    this.logLevel = logLevel ?? this.getDefaultLogLevel();
  }

  private getDefaultLogLevel(): LogLevel {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    switch (envLevel) {
      case 'ERROR': return LogLevel.ERROR;
      case 'WARN': return LogLevel.WARN;
      case 'INFO': return LogLevel.INFO;
      case 'DEBUG': return LogLevel.DEBUG;
      default: 
        return process.env.NODE_ENV === 'development' ? LogLevel.INFO : LogLevel.WARN;
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.logLevel >= LogLevel.INFO) {
      console.log(`${this.prefix}${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.logLevel >= LogLevel.WARN) {
      console.warn(`${this.prefix}⚠️  ${message}`, ...args);
    }
  }

  error(message: string, ...args: any[]): void {
    if (this.logLevel >= LogLevel.ERROR) {
      console.error(`${this.prefix}❌ ${message}`, ...args);
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.logLevel >= LogLevel.DEBUG) {
      console.log(`${this.prefix}🐛 ${message}`, ...args);
    }
  }

  static create(prefix: string, logLevel?: LogLevel): LoggerService {
    return new LoggerService(prefix, logLevel);
  }
}