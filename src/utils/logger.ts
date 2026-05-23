// Debug logger for Page Analyzer
// Set localStorage.setItem('page-analyzer-debug', 'true') to enable debug logs

const DEBUG_KEY = 'page-analyzer-debug';

export function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem(DEBUG_KEY) === 'true';
  } catch {
    return false;
  }
}

export function enableDebug(): void {
  try {
    localStorage.setItem(DEBUG_KEY, 'true');
    console.log('[PageAnalyzer] Debug mode enabled');
  } catch {
    console.warn('[PageAnalyzer] Failed to enable debug mode');
  }
}

export function disableDebug(): void {
  try {
    localStorage.removeItem(DEBUG_KEY);
    console.log('[PageAnalyzer] Debug mode disabled');
  } catch {
    console.warn('[PageAnalyzer] Failed to disable debug mode');
  }
}

export function debugLog(prefix: string, ...args: unknown[]): void {
  if (isDebugEnabled()) {
    console.log(`[PageAnalyzer:${prefix}]`, ...args);
  }
}

export function errorLog(prefix: string, ...args: unknown[]): void {
  console.error(`[PageAnalyzer:${prefix}]`, ...args);
}

export function warnLog(prefix: string, ...args: unknown[]): void {
  console.warn(`[PageAnalyzer:${prefix}]`, ...args);
}

export function infoLog(prefix: string, ...args: unknown[]): void {
  console.info(`[PageAnalyzer:${prefix}]`, ...args);
}
