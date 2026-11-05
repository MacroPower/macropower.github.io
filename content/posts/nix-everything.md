+++
categories  = ["Nix", "AI"]
date        = "2026-11-04"
type        = ["posts", "post"]

title = "Nix Everything"
slug = "nix-everything"
description = "Why I think Nix is the future of machine configuration"

keywords = [
  "Nix", "NixOS", "nix-darwin", "home-manager", "AI",
  "dotfiles", "sandbox", "Lima", "workmux", "terrarium"
]
+++

I think [Nix](https://nixos.org/) is the future of machine configuration.

Nix has been around for a long time now. And up until recently, my impression
was that it was _exclusively_ for the uber nerds, sitting somewhere between Arch
Linux and TempleOS. The benefits of Nix have always been hard to ignore, but it
required a time investment I was not willing to make. Generally I've seen this
same sentiment among my peers.

What I want to propose in this article is that this sentiment is no longer
accurate. This is because, in my opinion, **Nix is the ideal tool in its class
for coding agents**.

## Wait, what's a Nix? Why do the robots like it?

Nix describes a whole machine in code:

- [Flakes](https://nix.dev/concepts/flakes) pin every input to an exact revision
  via a lockfile.
- A single build produces the entire machine configuration that the code
  describes.
- Everything shares one vocabulary. A shell alias, a patched package, and a
  system service are edits to the same tree.
- Two machines on the same platform that build the same flake get the same
  result.

Agents edit a module, build the configuration, read the error, and try again.
Building a configuration does not activate it, so failed attempts never touch
the running system. When an activated change misbehaves, the previous generation
is still there.

That loop lets me describe features instead of writing them. I tell the agent
what I want my machine to do, and it iterates until the build passes and the
feature works. The loop is the same for my shell, for a systemd service, for a
patch to an upstream package, and for the agent's own hooks and permissions.
When something breaks, it's isolated and easily reverted.

## Why would a human ever dislike this?

My major issues with Nix, pre-2026 edition:

1. The learning curve. Nix is a lazy functional language with its own module
   system, and its error messages are often opaque.
2. The ecosystem has not settled. Flakes are still experimental. Multiple
   implementations, for example [Nix](https://github.com/NixOS/nix) and
   [Lix](https://lix.systems/), diverge in small ways.
3. macOS is a second-class platform.
   [nix-darwin](https://github.com/nix-darwin/nix-darwin) covers _most_ system
   settings and packages, but you still encounter things that must be changed via
   the settings/privacy GUI.
4. On a managed laptop, MDM profiles can sometimes own the settings that Nix
   also wants to own, and the two can fight if you aren't careful.

I argue that coding agents make the above items non-issues. The overall
difficulty, general nuance, and complex interactions that come with Nix can be
easily absorbed by coding agents circa 2026.

One major downside persists, inherent to Nix being a monolithic toolchain. It is
most functional when used on teams with little to no fragmentation, where every
team member, agent, and CI pipeline uses identical toolchains. Each
exception brings back ad-hoc scripts and branching setup docs, which then
results in bugs that only one laptop can reproduce. If alignment is an issue in
your team/org, I recommend [Dagger](https://dagger.io/). Dagger is a much heavier
tool, but it works much better in these scenarios.

## One flake, many machines

My [dotfiles](https://github.com/MacroPower/dotfiles) are a single flake with
several outputs:

- A few different Macs, through
  [nix-darwin](https://github.com/nix-darwin/nix-darwin) and
  [home-manager](https://github.com/nix-community/home-manager). The flake owns
  their system settings, casks, shell, and every tool I use.
- A NixOS VM named `terrarium`, where my coding agents run.
- A home-manager configuration for a portable Linux container. CI builds it with
  [Dagger](https://dagger.io/) and publishes the image on every push.

Every one of them imports the same home modules, so my shell, git, editor, tmux,
and Claude Code configuration are the _same everywhere_. Host files set options,
and the modules decide what those options mean on each platform.

Claude Code's own configuration is one of those modules. It generates the
settings file, the hooks, the MCP servers, the skills, the permission rules, and
the sandbox allowlists from Nix. For example, the `terrarium` host sets three
options and inherits the rest:

```nix
dotfiles.claude = {
  # Start Claude Code with permission prompts off. That is only safe inside the VM, so no other host sets it.
  dangerouslySkipPermissions = true;
  # Let me watch and steer sessions from my phone. (I don't like giving Anthropic free RCE on my Macs.)
  remoteControl = true;
  # Let kubectl inside the guest use the clusters that the guest created itself.
  guestKubeconfigLocal = true;
};
```

> As with my machine config, agents iterate on their own local Kubernetes
> clusters to arrive at working Talos cluster configs and Argo applications,
> rather than having access to my live clusters.

I _never_ edit my machine's dotfiles by hand. Home-manager links them from the
repository on every activation and overwrites whatever drifted.

## The agent sandbox

[workmux](https://github.com/raine/workmux) runs my agents. It gives each task a
git worktree and a tmux window, and its [Lima](https://lima-vm.io/) backend runs
the agent pane inside a VM. Home-manager generates its configuration too, and
that configuration points the backend at the image:

```yaml
sandbox:
  enabled: true
  backend: lima
  image: file:///Users/jacobcolvin/.lima/_images/terrarium.qcow2
  lima:
    isolation: shared
    projects_dir: /Users/jacobcolvin/Documents/repos
    skip_default_provision: true
```

Lima mounts my repositories directory into the guest at the same path it has on
the Mac. Worktree paths are therefore valid on both sides.

### Testing machines

The VM is where I test changes to the machines. The agent runs inside a NixOS
host that the flake built, with a writable checkout of the flake mounted in. It
can rebuild its own machine via the following loop:

1. Edit a module.
2. Run `dagger check`. [Dagger](https://dagger.io/) runs each check function
   from the repository's modules in its own container. The Nix module's checks
   evaluate every host and home-manager configuration, validate the flake's
   outputs, and lint the tree. Evaluation does not build anything, but it
   catches the type errors, missing options, and bad references that make up
   most mistakes. A change to a shared module must evaluate for every machine at
   once, not only for the one the agent runs on.
3. Run `nixos-rebuild switch` for the guest's own host, so the new generation
   activates on the machine the agent is sitting in.

If the new generation misbehaves, the previous one is a reboot away. If the
agent breaks the VM beyond repair, I can delete it and create it again from the
image. The repositories survive because they live on my Mac, not in the VM.
Changes that work in the VM then go to the Macs with `darwin-rebuild switch`
on the host.

### Sandbox isolation

The guest has none of the Mac's SSH keys, cloud credentials, or kubeconfigs. The
few narrowly scoped API tokens it needs arrive as environment variables that a
wrapper reads from [sops](https://github.com/getsops/sops) on the host. A shim
from the VM lets MCP servers run specific commands on the host, where they have
additional access and credentials. These are gated by workmux's host-command
allowlist and Claude Code permissions, giving me a narrow, deliberate way out of
the sandbox. For example, agents can issue themselves new read-only k8s
ServiceAccount tokens, even though they have no permissions to manage
ServiceAccounts otherwise.

Network egress is the part of a sandbox that most setups leave open. I use
[Terrarium](https://github.com/MacroPower/terrarium), my own egress filter built
around [Envoy](https://www.envoyproxy.io/). It reads
[Cilium](https://cilium.io/) network policy, so an allowlist of domains with
HTTP rules is the same YAML I write for my Kubernetes clusters.

## Patches

For most of my career, the software I used was whatever its maintainers decided
it was. When a tool did something I disliked, I had three options:

- Open a pull request and hope for the best.
- Fork the project and maintain the fork forever.
- Live with it (most likely).

Coding agents utilizing Nix gave me a fourth option. Agents read unfamiliar
codebases and write working patches in a few minutes, and Nix applies each patch
every time it builds the program. **Together they make changing someone else's
software about as cheap as changing a config file.** My dotfiles apply several
patches, spanning features, fixes, and performance improvements.

Nix builds every package from a recipe called a _derivation_, and you can edit
that recipe without forking nixpkgs.

- An [_overlay_](https://wiki.nixos.org/wiki/Overlays) is a function that
  receives the package set and returns the packages you want to replace.
- Inside it,
  [`overrideAttrs`](https://nixos.org/manual/nixpkgs/stable/#sec-pkg-overrideAttrs)
  takes an existing derivation and changes any of its attributes, including the
  list of `patches` that Nix applies to the source before it builds.

For example, here is an overlay that patches
[devbox](https://www.jetify.com/devbox):

```nix
devboxOverlay = _final: prev: {
  devbox = prev.devbox.overrideAttrs (old: {
    patches = (old.patches or [ ]) ++ [ ../pkgs/make-devbox-work-better.patch ];
  });
};
```

Every program on my machines that depends on devbox now gets the patched build.
A few properties of this setup make it safe to do casually:

- The patch lives in my repository next to the code that applies it, so each
  change has a history and a stated reason.
- If upstream rewrites the lines a patch touches, the patch fails to apply and
  the build stops. I learn about the breakage when I rebuild, not when the
  program misbehaves.
- Deleting the patch and rebuilding restores the stock package.

Nix has offered these properties for years, but writing and maintaining a patch
like this was rarely worth the effort. Coding agents changed that. The examples
that follow are all based on patches from my dotfiles.

### Example: A One-Line Change

When workmux started [Claude Code](https://github.com/anthropics/claude-code),
it passed `--dangerously-skip-permissions`, which enabled bypass mode and
overrode `--permission-mode plan`.

I wanted each pane to start in the permission mode that my settings choose, with
bypass mode available when I ask for it. Claude Code has a flag for exactly
that, so the fix is one line:

```diff
--- a/src/multiplexer/agent.rs
+++ b/src/multiplexer/agent.rs
@@ -91,7 +91,7 @@ impl AgentProfile for ClaudeProfile {
     }

     fn skip_permissions_flag(&self) -> Option<&'static str> {
-        Some("--dangerously-skip-permissions")
+        Some("--allow-dangerously-skip-permissions")
     }

     fn auto_name_command(&self) -> Option<&'static str> {
```

Each pane now starts in the permission mode that my Claude Code settings choose,
and I can still switch to bypass mode during the session.

### Example: An Unmerged Fix

A [Lix](https://lix.systems/) upgrade left me stuck between two versions:

- Lix 2.95 removed
  [`builtins.fetchClosure`](https://nix.dev/manual/nix/latest/language/builtins.html#builtins-fetchClosure).
- A nixpkgs bump removed Lix 2.94, so I had to move to 2.95.
- Devbox used `fetchClosure` to pull packages from the binary cache, and devbox
  0.18.3 and later refused to start on Lix 2.95.

Someone had already opened
[jetify-com/devbox#2997](https://github.com/jetify-com/devbox/pull/2997), which
replaces `fetchClosure` with `builtins.appendContext` and removes the Lix check.
Nobody had merged the pull request, and it did not apply cleanly to devbox
0.18.4 (the release that nixpkgs built at the time).

My devbox overlay applies that pull request, rebased onto 0.18.4. I moved to Lix
2.95 with the same nixpkgs bump, **without waiting for a devbox release**. When
a devbox release includes the change, I will delete the patch file and the
overlay.

### Example: Closed Source

Patching does not always require source code. Claude Code ships as a single
executable that [Bun](https://bun.sh/) compiles from a minified JavaScript
bundle, and the bundle sits inside the binary as plain text. If there's no
precompiled bytecode present (no longer the case as of Claude Code 2.1.250), an
edit to that plain text bundle changes the program.

The Claude Code sandbox denied writes to any directory named `config` or `hooks`
at the root of the working directory, as a defense against bare git
repositories. The check never looked for the files that mark a bare repository,
such as `HEAD`, `objects`, and `refs`. As a result, every ordinary repository
with a top-level `config/` directory became read-only whenever the sandbox ran.

While debugging, an agent searched the binary for the deny list and read the
surrounding code. The list was the literal `["hooks","config"]`. A 60-line
Python script replaced it with an empty array of the same length:

```python
PATTERN = b'["hooks","config"]'
REPLACEMENT = b"[" + b" " * 16 + b"]"  # empty array, identical length

count = data.count(PATTERN)
if count != 1:
    sys.exit(f"expected exactly 1 occurrence of {PATTERN!r}, found {count}")

with open(path, "wb") as f:
    f.write(data.replace(PATTERN, REPLACEMENT))
```

A few details keep the edit safe:

- The padding keeps every byte after the list at its original offset. Bun's
  table of module lengths, and the Mach-O and ELF layouts, stay valid.
- The minifier named the list's variable differently on each platform, `H` on
  linux-arm64 and `U` on darwin-arm64. The script matches the array literal
  instead of the assignment for that reason.
- When an upstream release changes the literal, the count check stops the build.

The overlay runs the script on the raw binary before Nix wraps it. Editing the
binary breaks its code signature on macOS, so the overlay also adds the hook
that signs the result again:

```nix
claude-code = prev.llm-agents.claude-code.overrideAttrs (old: {
  nativeBuildInputs =
    (old.nativeBuildInputs or [ ])
    ++ [ prev.python3 ]
    ++ prev.lib.optionals prev.stdenv.hostPlatform.isDarwin [
      prev.darwin.autoSignDarwinBinariesHook
    ];
  postInstall = (old.postInstall or "") + ''
    python3 ${../pkgs/claude-code-unprotect-config-dir.py} $out/bin/claude
  '';
});
```

The package's version check then runs the patched, wrapped binary, so **a broken
edit fails the build and can be fixed immediately**.

## Magic wrappers

Nix can also wrap any binary with different flags and environment variables, or
another binary entirely. For example, you can set defaults, sandbox the process,
or intercept its traffic.

[tflint](https://github.com/terraform-linters/tflint) runs each of its plugins
as a separate process and talks to it over Unix sockets through
[go-plugin](https://github.com/hashicorp/go-plugin). go-plugin honored
`PLUGIN_UNIX_SOCKET_DIR` only in the plugin processes, so tflint itself always
created the socket for its plugins' callbacks in the system temp directory. The
Claude Code sandbox pointed `TMPDIR` at a directory that blocked socket binds,
so **tflint failed inside it**.

My dotfiles fix tflint with a wrapper instead of a patch:

```nix
tflintWrapped = pkgs.symlinkJoin {
  name = "tflint-wrapped";
  paths = [ pkgs.tflint ];
  nativeBuildInputs = [ pkgs.makeWrapper ];
  postBuild = ''
    wrapProgram $out/bin/tflint \
      --run "mkdir -p ${config.home.homeDirectory}/.tflint.d/tmp" \
      --set TMPDIR "${config.home.homeDirectory}/.tflint.d/tmp"
  '';
};
```

[`wrapProgram`](https://nixos.org/manual/nixpkgs/stable/#fun-wrapProgram)
replaces `bin/tflint` with a shell script that creates the directory, sets
`TMPDIR`, and runs the original binary. The sandbox allows writes and socket
binds under `~/.tflint.d/tmp`, so the plugins start inside it.

## Binaries at the speed of shell

Small commands usually start as shell aliases or scripts. Scripts have no types,
no tests, and no dependency management, so they stay small and tend to be
slightly broken. Generally the reason you'd still use a shell script is
simplicity (just `./run.sh`), not because of some inherent advantage. After
all, who wants thousands of lines of boilerplate and a CI pipeline that breaks
every 3 months?

Nix lets you have the best of both worlds. In my dotfiles, I have a collection
of small programs that each live in their own directory under `tools/`. For
example, a tiny Go program:

```text
tools/cookie
├── cows/
├── fortunes/
├── go.mod
├── go.sum
├── main.go
├── main_test.go
└── package.nix
```

`cookie` prints a fortune, with an optional cow. It exists because I wanted one
on the neovim start screen. It is around 500 lines of Go.

The derivation in `package.nix` is the entire build and release system:

```nix
{
  lib,
  buildGoModule,
}:

buildGoModule {
  pname = "cookie";
  version = "0.1.0";

  src = ./.;
  vendorHash = "sha256-yqtj+zCo7u2UwaQ12bHCHPNucgQNkvkN7nfkLynB67Y=";

  meta = {
    description = "Tiny fortune cookie generator";
    homepage = "https://github.com/MacroPower/dotfiles/tree/main/tools/cookie";
    license = lib.licenses.asl20;
    mainProgram = "cookie";
  };
}
```

[`buildGoModule`](https://nixos.org/manual/nixpkgs/stable/#sec-language-go)
downloads the module's dependencies into a separate derivation that `vendorHash`
pins, compiles the program, and runs `go test ./...` before it installs
anything.

One line in `lib/default.nix` turns the file into a package that every host
configuration can see:

```nix
cookie = final.callPackage paths.cookie { };
```

The store path for `cookie` is automatically added to the `PATH` (via
home-manager), and other configs can reference it at
`${pkgs.cookie}/bin/cookie`.

The next `darwin-rebuild switch` or `nixos-rebuild switch` builds every
derivation the configuration references, runs its tests, and links the result
in. There is no separate release step.

```console
$ cookie -s -cow tux
 ╭──────────────────────────────────────────╮
 │ Kaablamm! You hear an explosion in the   │
 │ distance.                                │
 ╰──────────────────────────────────────────╯
   \
    \
        .--.
       |o_o |
       |:_/ |
      //   \ \
     (|     | )
    /'\_   _/`\
    \___)=(___/
```

The point of this is that programs are much easier for agents to iterate on,
because they are significantly easier to test. With Nix acting as your entire
build and release system, there's very little downside to just using Go or Rust
for basically everything.

## Some of this just sounds like Docker...

Docker and Nix make the same promise: the thing you built is the thing you run.
How they accomplish this is entirely different.

- Docker describes a guest filesystem and the process that starts inside it.
- Nix describes packages, and considers your entire machine to be just another
  package (one with a lot of dependencies).

Inherently, _composition_ is very different between these two. Docker images
compose with other images only by copying files out of them. With Nix, the
entire machine and all of its software is just a collection of store paths, all
of which can reference each other.

That difference is why one set of home modules produces a Mac, a VM, and a
container. It is also why Nix can configure my entire machine, and Docker
cannot.

That said, containers win as the unit of deployment; I do not fight that. For
example, containers offer isolation primitives that Nix does not. And good luck
getting that derivation running on your Kubernetes cluster.

### Nix in Docker, and Docker in Nix

In many cases, Nix and Docker can complement each other.

For example, `oci.jacobcolvin.com/shell` is a portable container built from my
flake. A Dagger function starts from the [Lix](https://lix.systems/) image,
mounts `/nix` as a cache volume, builds the `dev@<arch>` home-manager
configuration, and activates it. Trimmed to the steps that matter:

```go
ctr.
	WithDirectory("/dotfiles", m.Source).
	WithWorkdir("/dotfiles").
	WithExec([]string{"nix", "build", ".#homeConfigurations.\"dev@aarch64-linux\".activationPackage"}).
	WithExec([]string{"./result/activate"})
```

It imports the same home modules as my Macs, so the image has the same fish,
git, tmux, neovim, and Claude Code configuration. Nix decides the contents.
Dagger handles the layers, zstd compression, the multi-arch manifest, and
publishing. The image runs as a utility container that I can reach over SSH.

On the host side, Nix is what installs and configures Docker and keeps it
consistent across all of my machines.

## Upgrades

A skill in my dotfiles repository, `/flake-upgrade`, handles the upgrade with
more patience than I have:

1. It bumps the lock and diffs it against the last commit.
2. It spawns one read-only agent per changed input. Each agent reads the
   upstream changelog and reports what this repository must change.
3. It applies the migrations, rebases any patch that stopped applying, and runs
   the checks.
4. It reports what it adopted and what it left for me.

> Inputs that only carry packages, such as nixpkgs, get a different treatment in
> step #2. The flake has an `inventory` output that lists every package
> each host installs. A second script evaluates the diff of this output to
> find all packages whose version changed. The agent then reads individual
> changelogs instead of thousands of nixpkgs commits.

## In conclusion

The agents I used at the start of 2025 struggled to fix code that I pointed at
explicitly. The agents I use in 2026 read a codebase they have never seen, find
the function that caused some problem, comb through git logs to find when and
why the behavior changed, then propose a working fix with little to no feedback.
That ability changes what is reasonable to delegate to agents.

What an agent still needs is a _loop_. It must be able to make a change, run
something that says whether the change worked, and undo the change when it did
not. **Imperative machine setup has no such loop.** `brew` has no rollback, and
ad-hoc edits to your system settings have no `git blame`.

Nix gives machines the loop that traditional code has always had. The
configuration is text, builds pass or print an error, and activation is
reversible and reproducible. The whole machine can be built as a VM, handed to
an agent, broken, and thrown away as needed.

In reality, the future of machine configuration may or may not be Nix, but for
the above reasons I expect it will at least be something similar.
