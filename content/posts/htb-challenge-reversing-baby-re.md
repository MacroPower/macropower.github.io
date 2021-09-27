+++
categories  = ["HTB", "HTB-Challenge", "Reversing"]
date        = "2020-10-24"
lastmod     = "2020-10-24 17:23"
type        = ["posts", "post"]
series      = ["HTB Writeups"]

title = "HTB Challenge - Reversing - Baby RE"
description = "This is the first challenge I've completed which was retired. By far the easiest solve so far but sharing my short writeup regardless."
slug = "htb-challenge-reversing-baby-re"

keywords = ["htb", "hackthebox", "challenge", "reversing"]
+++

We can start off by running [ltrace](https://man7.org/linux/man-pages/man1/ltrace.1.html), which runs a command and intercepts dynamic library & sys calls.

```bash
ltrace -i -C ./baby
```

We're prompted and can start off by inserting random value, e.g. `asd`.

A call to `strcmp` is intercepted by `ltrace`.

```bash
strcmp("asd\n", "ab[REDACTED]13\n")
```

Let's start by trying to pass `ab[REDACTED]13`.

In this case it was just that simple, and we receive the flag.

```text
HTB{B[REDACTED]Z}
```

There were probably a lot of additional ways this one could have been solved, and I think I got lucky by starting in this direction.
