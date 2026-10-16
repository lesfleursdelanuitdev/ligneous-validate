import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import source from '../public/nomodule.js?raw';

// web/public/nomodule.js runs only in browsers too old for the module script.
describe('nomodule.js', () => {
  it('puts the browser message in the status line', () => {
    const status = { textContent: '', className: '' };
    const document = { getElementById: (id: string) => (id === 'status' ? status : null) };
    new Function('document', source)(document);
    expect(status.textContent).toBe("This browser couldn't start the checker. Try a current version of Firefox, Chrome, Safari or Edge.");
    expect(status.className).toBe('problem');
  });
  it('is loaded from index.html as an external nomodule script', () => {
    expect(html).toContain('<script nomodule defer src="/nomodule.js"></script>');
  });
});
