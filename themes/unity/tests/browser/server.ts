// A static file server for a built site. It answers the way a static host
// does, and it sends the Content Security Policy that README.md documents
// for the theme with every response.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".mjs": "text/javascript; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
};

// README.md's Customizing section documents this policy. The home terminal
// also needs inline styles, because xterm.js adds style elements at runtime.
const POLICY = "script-src 'self'; style-src 'self'";
const TERMINAL_POLICY = "script-src 'self'; style-src 'self' 'unsafe-inline'";

export interface Server {
  /** The server's origin, with a trailing slash. */
  url: string;
  /** Serves the files under root from then on. */
  serve(root: string): void;
  close(): Promise<void>;
}

/** Listens on an unused local port and answers 503 until serve() names
 *  the directory to serve. The site's build needs the server's URL first. */
export async function listen(): Promise<Server> {
  let root = "";
  const server = createServer((req, res) => {
    if (!root) {
      res.writeHead(503).end();
      return;
    }
    const found = lookup(root, new URL(req.url ?? "/", "http://localhost").pathname);
    const file = found ?? join(root, "404.html");
    const policy = file === join(root, "index.html") ? TERMINAL_POLICY : POLICY;
    res.writeHead(found ? 200 : 404, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Content-Security-Policy": policy,
    });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    serve: (dir) => {
      root = dir;
    },
    close: () => {
      server.closeAllConnections();
      return new Promise((done) => server.close(() => done()));
    },
  };
}

// The file under root that a URL path names, or undefined when no file
// matches. A path that ends in a slash names the index.html under it.
function lookup(root: string, pathname: string): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const file = join(root, normalize(path.endsWith("/") ? `${path}index.html` : path));
  if (!file.startsWith(root + sep)) return undefined;
  try {
    return statSync(file).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}
