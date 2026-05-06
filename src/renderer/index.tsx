/// <reference types="vite/client" />
import * as Sentry from "@sentry/electron/renderer";

Sentry.init();

void import("./bootstrap.js").then((m) => {
  m.mount();
});
