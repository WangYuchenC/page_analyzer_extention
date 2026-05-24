import { MessageType } from '~types';
import type { ElementInfo } from '~types';
import { debugLog, errorLog, infoLog } from '~utils/logger';

class ElementPicker {
  private isActive = false;
  private overlay: HTMLElement | null = null;
  private highlightedElement: HTMLElement | null = null;
  private originalOutline = '';
  private onElementSelected: ((element: ElementInfo) => void) | null = null;

  activate(callback: (element: ElementInfo) => void) {
    if (this.isActive) return;

    this.isActive = true;
    this.onElementSelected = callback;
    this.createOverlay();
    this.bindEvents();
    document.body.style.cursor = 'crosshair';
    debugLog('ElementPicker', 'Activated');
  }

  deactivate() {
    if (!this.isActive) return;

    this.isActive = false;
    this.removeOverlay();
    this.unbindEvents();
    document.body.style.cursor = '';
    this.onElementSelected = null;
    debugLog('ElementPicker', 'Deactivated');
  }

  private createOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'page-analyzer-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 999999;
      pointer-events: none;
      background: transparent;
    `;
    document.body.appendChild(this.overlay);
    debugLog('ElementPicker', 'Overlay created');
  }

  private removeOverlay() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    if (this.highlightedElement) {
      this.highlightedElement.style.outline = this.originalOutline;
      this.highlightedElement = null;
    }
  }

  private bindEvents() {
    document.addEventListener('mouseover', this.handleMouseOver, true);
    document.addEventListener('mouseout', this.handleMouseOut, true);
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('keydown', this.handleKeyDown, true);
  }

  private unbindEvents() {
    document.removeEventListener('mouseover', this.handleMouseOver, true);
    document.removeEventListener('mouseout', this.handleMouseOut, true);
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('keydown', this.handleKeyDown, true);
  }

  private handleMouseOver = (e: MouseEvent) => {
    if (!this.isActive) return;
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target === this.overlay || target.id === 'page-analyzer-overlay') return;

    if (this.highlightedElement && this.highlightedElement !== target) {
      this.highlightedElement.style.outline = this.originalOutline;
    }

    if (target !== this.highlightedElement) {
      this.originalOutline = target.style.outline;
      target.style.outline = '2px solid #3b82f6';
      target.style.outlineOffset = '2px';
      this.highlightedElement = target;
    }
  };

  private handleMouseOut = (e: MouseEvent) => {
    if (!this.isActive) return;
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target === this.highlightedElement) {
      target.style.outline = this.originalOutline;
      this.highlightedElement = null;
    }
  };

  private handleClick = (e: MouseEvent) => {
    if (!this.isActive) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target.id === 'page-analyzer-overlay') return;

    const elementInfo = this.extractElementInfo(target);
    debugLog('ElementPicker', 'Element clicked:', elementInfo.tagName, elementInfo.cssSelector);

    (window as any).__pageAnalyzerSelectedElement = elementInfo;

    if (this.onElementSelected) {
      this.onElementSelected(elementInfo);
    }

    this.deactivate();
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      debugLog('ElementPicker', 'Escape pressed, deactivating');
      this.deactivate();
    }
  };

  private extractElementInfo(element: HTMLElement): ElementInfo {
    const rect = element.getBoundingClientRect();
    const attributes: Record<string, string> = {};

    for (const attr of element.attributes) {
      attributes[attr.name] = attr.value;
    }

    return {
      tagName: element.tagName.toLowerCase(),
      id: element.id || undefined,
      className: element.className || undefined,
      text: element.innerText?.slice(0, 200),
      xpath: this.getXPath(element),
      cssSelector: this.getCssSelector(element),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      outerHTML: element.outerHTML.slice(0, 2000),
      innerText: element.innerText?.slice(0, 500) || '',
      attributes,
    };
  }

  private getXPath(element: HTMLElement): string {
    const paths: string[] = [];
    let current: HTMLElement | null = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = current.previousSibling;

      while (sibling) {
        if (
          sibling.nodeType === Node.ELEMENT_NODE &&
          (sibling as HTMLElement).tagName === current.tagName
        ) {
          index++;
        }
        sibling = sibling.previousSibling;
      }

      const tagName = current.tagName.toLowerCase();
      const pathIndex = index > 1 ? `[${index}]` : '';
      paths.unshift(`${tagName}${pathIndex}`);

      current = current.parentElement;
    }

    return paths.length ? `/${paths.join('/')}` : '';
  }

  private getCssSelector(element: HTMLElement): string {
    const path: string[] = [];
    let current: HTMLElement | null = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break;
      }

      if (current.className) {
        const classes = current.className
          .split(' ')
          .filter((c) => c && !c.includes(':'))
          .slice(0, 2);
        if (classes.length > 0) {
          selector += `.${classes.join('.')}`;
        }
      }

      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter(
            (sibling) => sibling.tagName === current!.tagName
          )
        : [];

      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }
}

const picker = new ElementPicker();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;
  debugLog('ContentScript', 'Received message:', type, payload);

  switch (type) {
    case MessageType.CLICK_ELEMENT: {
      const { selector, waitBefore = 0, waitAfter = 500 } = payload || {};
      debugLog('ContentScript', 'Click element:', selector);
      (async () => {
        try {
          if (!selector || typeof selector !== 'string') {
            sendResponse({ success: false, error: 'Selector is required' });
            return;
          }
          
          await new Promise(resolve => setTimeout(resolve, waitBefore));
          
          const element = document.querySelector(selector);
          if (!element) {
            sendResponse({ success: false, error: `Element not found: ${selector}` });
            return;
          }
          
          (element as HTMLElement).click();
          debugLog('ContentScript', 'Clicked element:', selector);
          
          await new Promise(resolve => setTimeout(resolve, waitAfter));
          
          sendResponse({ success: true, message: `Clicked element: ${selector}` });
        } catch (e) {
          errorLog('ContentScript', 'Click error:', e);
          sendResponse({ success: false, error: `Click error: ${(e as Error).message}` });
        }
      })();
      return true;
    }

    case MessageType.INPUT_TEXT: {
      const { selector, text, submit = false } = payload || {};
      debugLog('ContentScript', 'Input text:', selector, text?.slice(0, 20));
      (async () => {
        try {
          if (!selector || typeof selector !== 'string') {
            sendResponse({ success: false, error: 'Selector is required' });
            return;
          }
          if (text === undefined || text === null) {
            sendResponse({ success: false, error: 'Text is required' });
            return;
          }
          
          const element = document.querySelector(selector);
          if (!element) {
            sendResponse({ success: false, error: `Element not found: ${selector}` });
            return;
          }
          
          (element as HTMLInputElement).value = String(text);
          
          const inputEvent = new Event('input', { bubbles: true });
          element.dispatchEvent(inputEvent);
          
          if (submit) {
            element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
          
          sendResponse({ success: true, message: `Input text: ${text.length} characters` });
        } catch (e) {
          errorLog('ContentScript', 'Input error:', e);
          sendResponse({ success: false, error: `Input error: ${(e as Error).message}` });
        }
      })();
      return true;
    }

    case MessageType.SCROLL_PAGE: {
      const { direction, amount = 500 } = payload || {};
      debugLog('ContentScript', 'Scroll page:', direction, amount);
      (async () => {
        try {
          switch (direction) {
            case 'top':
              window.scrollTo({ top: 0, behavior: 'smooth' });
              break;
            case 'bottom':
              window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
              break;
            case 'up': {
              const scrollTop = window.scrollY - amount;
              window.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
              break;
            }
            case 'down': {
              const scrollTop = window.scrollY + amount;
              window.scrollTo({ top: scrollTop, behavior: 'smooth' });
              break;
            }
            default:
              sendResponse({ success: false, error: `Invalid direction: ${direction}` });
              return;
          }
          
          await new Promise(resolve => setTimeout(resolve, 800));
          
          sendResponse({ success: true, message: `Scrolled ${direction}`, currentScrollY: window.scrollY });
        } catch (e) {
          errorLog('ContentScript', 'Scroll error:', e);
          sendResponse({ success: false, error: `Scroll error: ${(e as Error).message}` });
        }
      })();
      return true;
    }

    case MessageType.HOVER_ELEMENT: {
      const { selector, waitAfter = 500 } = payload || {};
      debugLog('ContentScript', 'Hover element:', selector);
      (async () => {
        try {
          if (!selector || typeof selector !== 'string') {
            sendResponse({ success: false, error: 'Selector is required' });
            return;
          }
          
          const element = document.querySelector(selector);
          if (!element) {
            sendResponse({ success: false, error: `Element not found: ${selector}` });
            return;
          }
          
          const hoverEvent = new MouseEvent('mouseover', {
            bubbles: true,
            cancelable: true,
          });
          element.dispatchEvent(hoverEvent);
          
          await new Promise(resolve => setTimeout(resolve, waitAfter));
          
          sendResponse({ success: true, message: `Hovered element: ${selector}` });
        } catch (e) {
          errorLog('ContentScript', 'Hover error:', e);
          sendResponse({ success: false, error: `Hover error: ${(e as Error).message}` });
        }
      })();
      return true;
    }

    case MessageType.WAIT_FOR_ELEMENT: {
      const { selector, timeout = 10000 } = payload || {};
      debugLog('ContentScript', 'Wait for element:', selector, { timeout });
      (async () => {
        try {
          if (!selector || typeof selector !== 'string') {
            sendResponse({ success: false, error: 'Selector is required' });
            return;
          }
          
          const startTime = Date.now();
          const checkInterval = 100;
          
          while (Date.now() - startTime < timeout) {
            if (document.querySelector(selector)) {
              sendResponse({ success: true, message: `Element found: ${selector}`, waitTime: Date.now() - startTime });
              return;
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
          }
          
          if (!document.querySelector(selector)) {
            sendResponse({ success: false, error: `Element not found within ${timeout}ms: ${selector}` });
          }
        } catch (e) {
          errorLog('ContentScript', 'Wait error:', e);
          sendResponse({ success: false, error: `Wait error: ${(e as Error).message}` });
        }
      })();
      return true;
    }

    case MessageType.EXECUTE_SCRIPT: {
      const { script } = payload || {};
      debugLog('ContentScript', 'Execute script:', script?.slice(0, 50));
      (async () => {
        try {
          if (!script || typeof script !== 'string') {
            sendResponse({ success: false, error: 'Script is required' });
            return;
          }
          
          const result = await (new Function(`return (async () => {\n${script}\n})()`))();
          sendResponse({ success: true, result: typeof result === 'string' ? result : JSON.stringify(result) });
        } catch (e) {
          errorLog('ContentScript', 'Execute script error:', e);
          sendResponse({ success: false, error: `Script error: ${(e as Error).message}` });
        }
      })();
      return true;
    }

    // 原有消息类型继续处理
    case MessageType.ELEMENT_HIGHLIGHT:
      if (payload?.active) {
        picker.activate((elementInfo) => {
          chrome.runtime.sendMessage({
            type: MessageType.ELEMENT_SELECTED,
            payload: elementInfo,
          });
        });
      } else {
        picker.deactivate();
      }
      sendResponse({ success: true });
      break;

    case MessageType.QUERY_SELECTOR: {
      const { selector, maxResults = 5, includeHtml = false } = payload || {};
      debugLog('ContentScript', 'Query selector:', selector, { maxResults, includeHtml });
      try {
        const elements = Array.from(document.querySelectorAll(selector)).slice(0, maxResults);
        debugLog('ContentScript', `Found ${elements.length} elements for selector:`, selector);
        sendResponse({
          count: elements.length,
          elements: elements.map((el) => ({
            tagName: el.tagName.toLowerCase(),
            text: (el as HTMLElement).innerText?.slice(0, 2000) || el.textContent?.slice(0, 2000) || '',
            html: includeHtml ? el.innerHTML.slice(0, 3000) : undefined,
            attributes: Object.fromEntries(Array.from(el.attributes).map((a: Attr) => [a.name, a.value])),
          })),
        });
      } catch (e) {
        errorLog('ContentScript', 'Invalid selector:', selector, e);
        sendResponse({ count: 0, elements: [], error: `Invalid selector: ${(e as Error).message}` });
      }
      break;
    }

    case MessageType.SEARCH_PAGE: {
      const { query, maxResults: searchMax = 10, contextChars = 80 } = payload || {};
      debugLog('ContentScript', 'Search page:', query, { maxResults: searchMax, contextChars });
      try {
        if (!query || typeof query !== 'string') {
          sendResponse({ count: 0, matches: [], error: 'Search query is required' });
          break;
        }
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'gi');
        const matches: Array<{ context: string; element: string }> = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null) && matches.length < searchMax) {
          const text = node.textContent || '';
          let match: RegExpExecArray | null;
          while ((match = regex.exec(text)) !== null && matches.length < searchMax) {
            const start = Math.max(0, match.index - contextChars);
            const end = Math.min(text.length, match.index + match[0].length + contextChars);
            const context = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
            const el = node.parentElement;
            matches.push({
              context,
              element: el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''}` : 'unknown',
            });
          }
        }
        debugLog('ContentScript', `Found ${matches.length} matches for query:`, query);
        sendResponse({ count: matches.length, matches });
      } catch (e) {
        errorLog('ContentScript', 'Search error:', e);
        sendResponse({ count: 0, matches: [], error: `Search error: ${(e as Error).message}` });
      }
      break;
    }

    case MessageType.GET_PAGE_SUMMARY: {
      debugLog('ContentScript', 'Getting page summary');
      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => ({
        level: parseInt(h.tagName[1]),
        text: (h as HTMLElement).innerText.slice(0, 200),
      }));
      const mainEl = document.querySelector('main, article, #content, .content, [role="main"]') || document.body;
      const summary = {
        url: window.location.href,
        title: document.title,
        metaDescription: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
        language: document.documentElement.lang || '',
        headings,
        linkCount: document.querySelectorAll('a').length,
        imageCount: document.querySelectorAll('img').length,
        textContentLength: document.body.innerText.length,
        mainContentPreview: (mainEl as HTMLElement).innerText?.slice(0, 2000) || '',
      };
      debugLog('ContentScript', 'Page summary:', summary.title, { headings: headings.length, links: summary.linkCount, images: summary.imageCount });
      sendResponse(summary);
      break;
    }

    case MessageType.GET_SELECTED_ELEMENT: {
      const saved = (window as any).__pageAnalyzerSelectedElement;
      debugLog('ContentScript', 'Get selected element:', saved ? 'found' : 'not found');
      sendResponse(saved ? { found: true, element: saved } : { found: false, message: 'No element selected. Use the element picker first.' });
      break;
    }

    default:
      debugLog('ContentScript', 'Unknown message type:', type);
      sendResponse({ error: `Unknown message type: ${type}` });
      break;
  }
});

infoLog('ContentScript', 'Page Analyzer content script loaded on:', window.location.href);
