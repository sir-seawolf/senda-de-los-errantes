import {copy, validate, assertRoundTrip} from '../src/comparison.js';

export class GeneratorCheck {
  constructor(frame) {
    this.frame = frame;
    this.queue = Promise.resolve();
    this.labels = {};
  }

  check(data) {
    const operation = this.queue.then(() => this.run(data));
    this.queue = operation.catch(() => {});
    return operation;
  }

  async run(data) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('El generador v4 no responde. Recarga e inténtalo de nuevo.')), 20000);
      this.frame.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      this.frame.src = '../../ficha_v4.html';
    });
    const win = this.frame.contentWindow;
    if (typeof win.applyData !== 'function' || typeof win.collectData !== 'function') {
      throw Error('El generador v4 no está disponible. No se puede aprobar la ficha.');
    }
    const template = copy(win.collectData());
    validate(data, template);
    win.applyData(copy(data));
    assertRoundTrip(data, copy(win.collectData()));
    for (const field of win.document.querySelectorAll('input[id],select[id],textarea[id]')) {
      const skill = field.id.startsWith('sktot-') ? field.closest('tr')?.cells[0]?.textContent : null;
      const label = skill || field.labels?.[0]?.textContent?.trim().split('\n')[0];
      if (label) {
        this.labels[field.id] = label;
      }
    }
    return template;
  }
}
