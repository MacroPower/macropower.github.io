// The entry of the blocking script that head.html loads. It runs before
// the browser parses <body>, so the first paint shows the visitor's
// scheme. Keep it small, because every page waits for it.

import { bootScheme } from "./scheme";

bootScheme();
