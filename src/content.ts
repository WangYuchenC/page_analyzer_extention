import { MessageType } from '~types';
import type { ElementInfo } from '~types';

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
  }

  deactivate() {
    if (!this.isActive) return;

    this.isActive = false;
    this.removeOverlay();
    this.unbindEvents();
    document.body.style.cursor = '';
    this.onElementSelected = null;
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

    if (this.onElementSelected) {
      this.onElementSelected(elementInfo);
    }

    this.deactivate();
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
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
      let index = 0;
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
      const pathIndex = index > 0 ? `[${index + 1}]` : '';
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

  switch (type) {
    case MessageType.ELEMENT_HIGHLIGHT:
      if (payload.active) {
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

    case MessageType.GET_PAGE_HTML:
      sendResponse({
        html: document.documentElement.outerHTML,
        title: document.title,
        url: window.location.href,
      });
      break;

    default:
      break;
  }
});

console.log('Page Analyzer content script loaded');
