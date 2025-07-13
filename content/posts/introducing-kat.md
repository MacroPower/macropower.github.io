+++
categories  = ["Kubernetes", "K8s"]
date        = "2025-07-13"
type        = ["posts", "post"]
series      = ["kat"]

title = "Introducing kat: A TUI and rule-based rendering engine for Kubernetes manifests"
slug = "introducing-kat"
description = """
Introducing kat, a terminal UI and rule-based rendering engine for Kubernetes \
manifests. It automatically invokes manifest generators like helm or \
kustomize, and provides a persistent, navigable view of rendered resources, \
with support for live reloading, integrated validation, and more. \
"""

keywords = [
  "Kubernetes", "K8s", "Helm", "Kustomize", "KCL", "TUI", "CLI", "local development"
]
+++

I don't know about you, but one of my favorite tools in the Kubernetes ecosystem is [`k9s`](https://k9scli.io/). It's a terminal UI (TUI) for interacting with your Kubernetes clusters, and at work I have it open pretty much all of the time. After I started using it, I felt like my productivity skyrocketed, since anything you could want is just a few keystrokes away.

However, when it comes to rendering and validating manifests locally, I found myself frustrated with the existing tools (or lack thereof). For me, I found that working with manifest generators like `helm` or `kustomize` often involved a repetitive cycle:

1. Run `helm template`, `kustomize build`, or similar commands
2. Search through many pages of output looking for specific resources
3. Find some issue and make a change to the source files
4. Re-run the rendering commands
5. Re-run whatever search I originally did
6. Find another issue and make a change to the source files
7. Repeat ad nauseam

So, I set out to build something that would make this process easier and more efficient. After a few months of work, I'm excited to introduce you to `kat`!

## What is `kat`?

`kat` automatically invokes manifest generators like `helm` or `kustomize`, and provides a persistent, navigable view of rendered resources, with support for live reloading, integrated validation, and more.

It is made of two main components, which can be used together or independently:

1. A **rule-based engine** for automatically rendering and validating manifests
2. A **terminal UI** for browsing and debugging rendered Kubernetes manifests

Together, these deliver a seamless development experience that maintains context and focus while iterating on Helm charts, Kustomize overlays, and other manifest generators.

![demo](https://github.com/MacroPower/kat/raw/main/docs/assets/demo.gif)

> If you're interested in giving `kat` a try, there are installation and usage instructions available in the repo's README: [github.com/macropower/kat](https://github.com/macropower/kat)

### Features

**Manifest Browsing**: Rather than outputting a single long stream of YAML, `kat` organizes the output into a browsable list structure. Navigate through any number of rendered resources using their group/kind/ns/name metadata.

**Live Reload**: Just use the `-w` flag to automatically re-render when you modify source files, without losing your current position or context when the output changes.

**Integrated Validation**: Run tools like `kubeconform`, `kyverno`, or custom validators automatically on rendered output through configurable hooks. Additionally, you can define custom "plugins", which function the same way as k9s plugins (i.e. commands invoked with a keybind).

**Flexible Configuration**: `kat` allows you to define profiles for different manifest generators (like Helm, Kustomize, etc.). Profiles can be automatically selected based on output of CEL expressions, allowing `kat` to adapt to your project structure.

**And Customization**: `kat` can be configured with your own keybindings, as well as custom themes!

![Themes](https://github.com/MacroPower/kat/raw/main/docs/assets/themes.gif)

## How do I use it?

Let's use a simple example with `helm` to illustrate how `kat` works.

> Note that configuration for `helm` is included in kat's [default configuration](https://github.com/MacroPower/kat/blob/main/pkg/config/config.yaml).

First, we need to define a profile for `helm`. This profile will specify how to render manifests using `helm template`, as well as:

- Any init, preRender, and/or postRender hooks we want to apply
- Any plugins that should be available in this context
- Any UI settings that should differ from the global config

```yaml
# yaml-language-server: $schema=./config.v1beta1.json
apiVersion: kat.jacobcolvin.com/v1beta1
kind: Configuration
profiles:
  helm:
    command: helm
    args: [template, ., --generate-name]
    env: []
    # Reload on edits to YAML and template files.
    source: >-
      files.filter(f, pathExt(f) in [".yaml", ".yml", ".tpl"])
    # Inherit helm environment variables from the caller process.
    envFrom: &helmEnvFrom
      - callerRef:
          pattern: ^HELM_.+
    hooks:
      # Ensure that helm is installed.
      init:
        - command: helm
          args: [version]
      # Build any helm dependencies before rendering.
      preRender:
        - command: helm
          args: [dependency, build]
          envFrom: *helmEnvFrom
      # Validate rendered resources with kubeconform.
      postRender:
        - command: kubeconform
          args: ["-strict", "-summary"]
    ui:
      # Use a custom theme for the helm profile.
      theme: "dracula"
    plugins:
      # Add a plugin to invoke helm dry-run when `H` is pressed.
      dry-run:
        description: invoke helm dry-run
        keys:
          - code: H
        command: helm
        args: [install, ., -g, --dry-run]
        envFrom: *helmEnvFrom
```

Now, we can use this profile to render manifests. For example, if we have a Helm chart in the current directory, we can run:

```bash
kat . helm
```

Next, we can define a `rule`, so that we automatically select the `helm` profile when we run `kat` in a directory containing a helm chart:

```yaml
# yaml-language-server: $schema=./config.v1beta1.json
apiVersion: kat.jacobcolvin.com/v1beta1
kind: Configuration
profiles:
  # ...
rules:
  # If there is a chart file in the current directory, and
  # it defines `apiVersion: v2`, use the `helm` profile.
  - match: >-
      files.exists(f,
        pathBase(f) in ["Chart.yaml", "Chart.yml"] &&
        yamlPath(f, "$.apiVersion") == "v2"
      )
    profile: helm
```

Now, if we have a Helm chart in the current directory, we can simply run:

```bash
kat
```

And `kat` will automatically select the `helm` profile, render, and validate the helm chart for us.

You can continue to define additional profiles and rules to handle other manifest generators like Kustomize, Jsonnet, CUE, KCL, and more. You can also express more complex rules using CEL expressions to match specific project structures or configurations (such as using [flux-local](https://github.com/allenporter/flux-local) if your project contains some Fluxtomizations).

To learn more, check out the [README](https://github.com/MacroPower/kat) and kat's [CEL Expression Guide](https://github.com/MacroPower/kat/blob/main/docs/CEL.md).

## Conclusion

`kat` solved my specific workflow problems when working with Kubernetes manifests locally. And while it may not be a perfect fit for everyone, I hope it can help others who find themselves in a similar situation.

If you're interested in giving it a try, check out the repo here:

[github.com/macropower/kat](https://github.com/macropower/kat) (please ⭐ if you like it!)

Also, a huge thanks to the authors of the following projects (that provided inspiration and/or code):

- [k9s](https://github.com/derailed/k9s) - _A terminal UI to interact with your Kubernetes clusters._
- [bat](https://github.com/sharkdp/bat) - _A `cat(1)` clone with wings._
- [task](https://github.com/go-task/task) - _A task runner for Go._
- [glow](https://github.com/charmbracelet/glow) - _Render markdown on the CLI, with pizzazz!_
- [soft-serve](https://github.com/charmbracelet/soft-serve) - _The mighty, self-hostable Git server for the command line._
- [wishlist](https://github.com/charmbracelet/wishlist) - _The SSH directory._
- [viddy](https://github.com/sachaos/viddy) - _A modern `watch` command._
- [charmbracelet/bubbletea](https://github.com/charmbracelet/bubbletea) - _A powerful TUI framework for Go._
  - ...plus many other fantastic libraries from [_charm_](https://github.com/charmbracelet)
- [alecthomas/chroma](https://github.com/alecthomas/chroma) - _A general-purpose syntax highlighter in pure Go._
- [google/cel-go](https://github.com/google/cel-go) - _A fast, portable, and safe expression evaluation engine._
- [goccy/go-yaml](https://github.com/goccy/go-yaml) - _YAML support for Go._
- [fsnotify](https://github.com/fsnotify/fsnotify) - _Cross-platform filesystem notifications._
- [invopop/jsonschema](https://github.com/invopop/jsonschema) - _JSON Schema generation._
- [santhosh-tekuri/jsonschema](https://github.com/santhosh-tekuri/jsonschema) - _JSON Schema validation._
