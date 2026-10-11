+++
categories = ["Meta"]
date = "2024-02-10"
title = "Welcome to the desktop"
description = "A first post to exercise the blog list, reader, and terminal."
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

> Blockquotes, lists, and images all render inside the page window.

This post is a page bundle, so an image beside its `index.md` resolves
by file name. The theme's render hook loads it lazily and gives it a
width and height:

![The Ubuntu roundel](roundel.png "A 180px Ubuntu roundel")

Links to other content files resolve to their permalinks, so this one
reaches [the first part of the series](/posts/series-part-1.md).

The `spotify` shortcode embeds an album, track, playlist, or artist:

{{< spotify type="album" id="4aawyAB9vmqN3uQ7FjRGTy" >}}
