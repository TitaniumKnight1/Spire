import * as Sentry from "@sentry/electron/main";
import { app } from "electron";
import { handleMediaProtocol, registerMediaScheme } from "./services/mediaProtocol.js";
import { startMediaPlaybackDebugSession } from "./services/mediaPlaybackDebugLog.js";
import { getLibraryDirectory } from "./utils/paths.js";

Sentry.init({
  dsn: "https://0e30021df36e6778d23aa79af87cf918@o4511329904951296.ingest.us.sentry.io/4511329999388672",
});

registerMediaScheme();

void app.whenReady().then(() => {
  const libraryDirectory = getLibraryDirectory();
  handleMediaProtocol(libraryDirectory);
  startMediaPlaybackDebugSession({ libraryDirectory });
});

// Load the rest of the main process only after Sentry is initialized (avoids hoisted imports
// running module-scope code such as electron-updater before Sentry.init).
require("./main-app.js");
