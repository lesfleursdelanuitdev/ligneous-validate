# ligneous-validate

The source of https://validate.ligneous.org/, a page that checks a GEDCOM family tree file in your browser and lists every problem in plain English, with the line it is on. It can also write a repaired copy for format problems it can fix on its own.

## Privacy

Your file stays on your computer. Nothing is uploaded.

- The checker is Go compiled to WebAssembly. It runs in a web worker in your browser.
- The page has no analytics, no third-party scripts or fonts, and sends no file data anywhere.
- Every page carries a Content-Security-Policy meta tag (`default-src 'self'; connect-src 'self'; ...`), so the browser itself blocks requests to other sites.
- An end-to-end test watches all network requests while a file is checked and fails on anything outside the page's own origin.

## Build and test

You need Go 1.23+ and Node.js.

    npm install
    npm run build     # builds the wasm checker, then the page into web/dist/
    npm run check     # go tests, unit tests, build, and browser (Playwright) tests

`npm run dev` serves the page locally. The e2e tests need a Chromium for Playwright; the 20 MB file test takes a couple of minutes.

## Layout

- `check/` Go package: runs the checks, groups and words the findings, and repairs format problems.
- `wasm/` the small Go `main` that exposes `check` to JavaScript.
- `web/` the page (TypeScript, Vite, no runtime dependencies) and its worker.
- `e2e/` Playwright tests and fixtures.
- `scripts/` wasm build script and a smoke test.

## Library

The parsing and validation come from [ligneous-gedcom-lib](https://github.com/lesfleursdelanuitdev/ligneous-gedcom-lib).
