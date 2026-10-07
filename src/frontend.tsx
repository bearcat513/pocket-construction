/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { FeedbackProvider } from "./components/app/feedback";
import { BookingEmbed } from "./components/site/Booking";
import { BOOKING_EMBED_PATH } from "./lib/booking";

const elem = document.getElementById("root")!;

// The booking calendar alone, for an iframe on another website. Decided here
// rather than inside App, so a stranger's page never starts the app: no
// session check, no preferences, nothing but the calendar.
const embedded = window.location.pathname === BOOKING_EMBED_PATH;

const app = (
  <StrictMode>
    {embedded ? (
      <BookingEmbed />
    ) : (
      <FeedbackProvider>
        <App />
      </FeedbackProvider>
    )}
  </StrictMode>
);

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
(import.meta.hot.data.root ??= createRoot(elem)).render(app);
