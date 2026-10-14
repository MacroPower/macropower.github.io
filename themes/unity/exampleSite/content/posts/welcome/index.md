+++
categories = ["Meta"]
date = "2024-02-10"
title = "Welcome to the desktop"
description = "A first post to exercise the blog list, reader, and terminal."
toc = true
+++

This example post shows up in three places: the blog's Nautilus-style
file list, the Dash's Files category, and the home terminal under
`~/posts/`.

## Markdown works

Code blocks are highlighted by Hugo:

```go
func main() {
	fmt.Println("hello from unity")
}
```

Add `{lineNos=table}` after the language to number the lines:

```sh {lineNos=table}
hugo new content posts/hello.md
hugo server -D
```

> Blockquotes, lists, and images all render inside the page window.

GitHub-style alerts render as info bars:

> [!TIP]
> Hover a heading to reveal the link to its section.

> [!WARNING]- Collapsed by default
> A `+` or `-` after the alert type makes it collapsible.

## Math

With Goldmark's passthrough extension enabled, TeX renders to MathML at
build time, inline like \(e^{i\pi} + 1 = 0\) or as a block:

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

## Images and links

This post is a page bundle, so an image beside its `index.md` resolves
by file name. The theme's render hook loads it lazily and gives it a
width and height:

![The Ubuntu roundel](roundel.png "A 180px Ubuntu roundel")

Links to other content files resolve to their permalinks, so this one
reaches [the first part of the series](/posts/series-part-1.md). A
root-relative link to a static file, like this
[sample CV](/files/sample-cv.pdf), resolves under the site's `baseURL`.

The `spotify` shortcode embeds an album, track, playlist, artist,
episode, or show:

{{< spotify type="album" id="4aawyAB9vmqN3uQ7FjRGTy" >}}

The theme's `youtube` shortcode takes the same arguments as Hugo's, but
its player gets its 16:9 size from the stylesheet, so the page does not
need style attributes:

{{< youtube id="0RKpf3rK57I" loading="lazy" >}}
