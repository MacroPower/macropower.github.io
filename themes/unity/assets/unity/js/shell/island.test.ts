import { describe, expect, it } from "vitest";

import { renderBanner } from "./banner";
import { parseShellIsland, type ShellIsland } from "./island";
import { makeShell, type TestShell } from "./testkit";

// The island a bare site's home page writes: no posts, pages, blog, or
// home body.
const BARE: ShellIsland = {
  handle: "user",
  host: "example.org",
  name: "",
  title: "",
  focus: "",
  since: "",
  socials: [],
  posts: [],
  pages: [],
  cwdTitle: true,
  ascii: "ART",
  colors: "YYY",
};

const FULL: ShellIsland = {
  ...BARE,
  name: "Jane Doe",
  since: "2024-01-01",
  socials: [{ label: "github", url: "https://github.com/jane", display: "github.com/jane" }],
  posts: [{
    slug: "welcome", title: "Welcome", date: "2024-03-05", categories: ["Homelab"],
    url: "/posts/welcome/", permalink: "https://example.org/posts/welcome/",
  }],
  pages: [{ slug: "about", date: "2024-01-01", url: "/about/", content: "\nHi.\n" }],
  blog: { dir: "posts", url: "/posts/" },
  readme: "# Hi",
  solitaire: "/solitaire/",
};

const parse = (value: unknown): ShellIsland | null => parseShellIsland(JSON.stringify(value));

// A shell over the island, as the entrypoint builds it.
const shellOver = (island: ShellIsland): TestShell => {
  const { since: _, ...rest } = island;
  return makeShell({ ...rest, uptime: "0 days" });
};

describe("parseShellIsland", () => {
  it("keeps a well-formed island as written", () => {
    expect(parse(BARE)).toEqual(BARE);
    expect(parse(FULL)).toEqual(FULL);
  });

  it("keeps the empty date of an undated post and page", () => {
    const undated: ShellIsland = {
      ...FULL,
      posts: [{ ...FULL.posts[0]!, date: "" }],
      pages: [{ ...FULL.pages[0]!, date: "" }],
    };
    expect(parse(undated)).toEqual(undated);
  });

  it("returns null for text that is not a JSON object", () => {
    for (const text of ["", "{", "null", "42", '"island"', "[]", "true"]) {
      expect(parseShellIsland(text), text).toBeNull();
    }
  });

  it("reads a missing or wrong-typed field as empty or false, except the handle", () => {
    expect(parse({})).toEqual({
      handle: "user", host: "", name: "", title: "", focus: "", since: "",
      socials: [], posts: [], pages: [], cwdTitle: false, ascii: "", colors: "",
    });
    expect(parse({ ...BARE, handle: "", name: 7, socials: "github", posts: null, pages: {}, cwdTitle: "yes" }))
      .toEqual({ ...BARE, name: "", cwdTitle: false });
  });

  it("drops list entries and optional fields with wrong-typed values", () => {
    const island = parse({
      ...FULL,
      socials: [null, "github", { label: "x", url: 1, display: "x" }, ...FULL.socials],
      posts: [{ ...FULL.posts[0], title: null }, { ...FULL.posts[0], categories: ["a", 2, null] }],
      pages: [[], { slug: "cv", date: "2024-01-15", url: "/cv/" }, ...FULL.pages],
      blog: { dir: "posts" },
      readme: 5,
      solitaire: ["/solitaire/"],
    });
    expect(island).toEqual({
      ...BARE,
      name: FULL.name,
      since: FULL.since,
      socials: FULL.socials,
      posts: [{ ...FULL.posts[0], categories: ["a"] }],
      pages: FULL.pages,
    });
  });

  // A payload without posts or socials used to throw inside the boot,
  // which left the terminal blank.
  it("boots a shell and a banner from an island without any field", () => {
    const island = parse({})!;
    const { lines } = renderBanner({ ...island, uptime: "0 days" }, 80);
    expect(lines.length).toBeGreaterThan(0);
    const sh = shellOver(island);
    expect(sh.run("ls").status).toBe(0);
    expect(sh.run("cat README.md").stdout).toContain("Welcome to");
  });

  it("feeds the filesystem from a full island", () => {
    const sh = shellOver(parse(FULL)!);
    expect(sh.run("ls ~/posts").stdout).toBe("welcome.md\n");
    expect(sh.run("cat ~/about.md").stdout).toBe("Hi.\n");
    expect(sh.run("cat ~/README.md").stdout).toBe("# Hi\n");
  });
});
