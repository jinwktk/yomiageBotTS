import type { ILogger } from '../interfaces/github-monitor.interface.js';

export class LoggerService implements ILogger {
  private prefix: string;
  private enableDebug: boolean;

  constructor(prefix: string = '', enableDebug: boolean = process.env.NODE_ENV === 'development') {
    this.prefix = prefix ? `[${prefix}] ` : '';
    this.enableDebug = enableDebug;
  }

  info(message: string, ...args: any[]): void {
    console.log(`${this.prefix}${message}`, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`${this.prefix}⚠️  ${message}`, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(`${this.prefix}❌ ${message}`, ...args);
  }

  debug(message: string, ...args: any[]): void {
    if (this.enableDebug) {
      console.log(`${this.prefix}🐛 ${message}`, ...args);
    }
  }

  static create(prefix: string): LoggerService {
    return new LoggerService(prefix);
  }
}