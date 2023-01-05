+++
categories  = ["Homelab", "Kubernetes", "K8s"]
date        = "2023-01-05"
lastmod     = "2023-01-05 18:40"
type        = ["posts", "post"]
series      = ["My Homelab"]

title = "Backups for K8s and Beyond"
description = "A unified solution for backing up my entire Kubernetes-centric homelab and all my other devices."
slug = "backups-for-k8s-and-beyond"

keywords = ["Homelab", "Kubernetes", "K8s", "Restic", "k8up"]
+++

## Intro

Recently I have been moving my homelab to Kubernetes. This has presented the
need for a backup solution for any persistent data I might have there. For quite
some time, I have been using [Duplicati](https://github.com/duplicati/duplicati)
for my backups, but I haven't been completely content with its performance, and
have heard many horror stories of restores not working properly. So, I wanted to
take this opportunity to find a backup solution that worked well for my personal
computers (I have Windows, Linux, and Darwin hosts), my storage servers (UnRaid
and FreeNAS), as well as Kubernetes. Assuming that such a solution exists, of
course!

## Choosing a Tool

There were a few solutions that I had heard mentioned lot on /r/homelab, and I
took a look at all of them. Those being [Duplicacy](https://duplicacy.com/),
[Borg](https://www.borgbackup.org/), and [Restic](https://github.com/restic/restic).

[Duplicacy](https://duplicacy.com/) seems like a good solution for some people,
and the interface looked very nice. However, you do need to purchase a license
to use all of its features, so I chose to avoid it unless I couldn't find
anything else that worked. I also wasn't sure how I'd use it for any of my
Kubernetes needs; it didn't seem like a very popular use-case for the tool.

[Borg](https://www.borgbackup.org/) and [Restic](https://github.com/restic/restic)
both seemed like great tools. Ultimately, I decided to go with Restic purely
because of its ecosystem, but again, they both seem like very nice solutions.
Borg also probably has a better ecosystem for the majority of users, but I
believe Restic's is better in my particular case.

Restic didn't have any particularly nice client GUIs that I could find, but for
someone like me who likes to use version control as much as they can, there's
[resticprofile](https://github.com/creativeprojects/resticprofile), which is a
fantastic tool that makes managing Restic on client machines very easy, and it
works very well on my Windows, Linux, and Darwin hosts. I also found that
[Restic Browser](https://github.com/emuell/restic-browser) could serve as a very
usable GUI for doing restores. It's still very bare-bones, but it does the job.
Restic also has several solutions for interacting with K8s that looked very
promising. Furthermore, Restic as well as all of these other tools are written
in Go, which I very much prefer to Python, which is what Borg is written in. I
assume this is one of the main reasons the Kubernetes ecosystem around Restic is
so much more developed.

## Integrating with Kubernetes

There are several tools out there that exist to make backing up persistent
storage on Kubernetes with Restic much easier. Typically, they are operators
that allow you define things like a backup schedule and what PVCs you want to be
in which Restic repo. Again, I took a look at three relatively popular options.

The first product that I found was [Stash](https://github.com/stashed/stash).
Stash is interesting because it has CRDs for a lot of different things you might
want to backup or restore. I reached out to the sales team to see what an
Enterprise License would cost (enterprise is needed for the most useful
features), but they did not reply to me, I assume because I only have a few
Kubernetes nodes to my name. From there, I was going to see if I could just
build from source with license checks disabled, but it's clear to me that at
least some enterprise functionality isn't present in the normal public repo, so
that's off the table as well.

Another very popular choice is [Velero](https://github.com/vmware-tanzu/velero).
However, I am immediately very apprehensive about it because it was made by
Hepito, who sold out to VMware some time ago. This had lead to a good amount of
abandonware. It does look like Velero is still being supported, but it's still
important to realize that this acquisition altered the goals of the project. And
I would have to pray that VMware does not alter them further. Additionally and
very annoyingly, despite heavily using Restic, Velero does not support the
Restic REST server backend. Meaning, I would be hugely limited in my potential
storage options.

Ultimately, I ended up going with [k8up](https://github.com/k8up-io/k8up). In
stark contrast to the other solutions I outlined, K8up is an active CNCF sandbox
project, which makes me much more comfortable with using it. I really didn't see
any downsides to it for me personally, as it included most (if not all) of the
enterprise features from Stash (such as support for backing up databases), and
it also supports using the Restic REST server as a backend, which Velero was
missing.

## My Implementation

Below is a minimized account of how I implemented everything. For all the exact,
ugly details, feel free to take a look at my [homelab GitHub repo](https://github.com/MacroPower/homelab).

First, I created a `backup` namespace for everything centralized:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: backup
```

Next, I set up my Restic REST server. I used Rclone to do this, which basically
allows you to use anything that Rclone supports as storage for Restic. I ended
up creating a [new helm chart for Rclone](https://github.com/MacroPower/helm-charts/tree/main/charts/rclone),
just because I couldn't find any existing ones that I liked very much. Unlike
many others, it just runs `rclone rcd`, so you can use this chart for basically
anything, and just send commands to serve/copy/sync/etc as needed.

Basically, the only extra values I supplied were to set my config file and add
an extra port for Restic. This is my Kustomization:

```yaml
helmCharts:
  - name: rclone
    repo: https://jacobcolvin.com/helm-charts/
    version: '0.3.0'
    releaseName: rclone
    namespace: backup
    valuesInline:
      image:
        repository: rclone/rclone
        tag: '1.60.1'

      configSecretName: rclone-config

      extraPorts:
        - name: restic
          containerPort: 50001
          protocol: TCP
```

I SSHed to the container and set up my remote `ResticRemote`. Then I saved this
to my secret provider for the `rclone-config` secret, so it won't be lost.

I then created a Job to run the following command after the sync completes, to
start the Restic server:

```bash
curl -v -X POST -H 'Content-Type: application/json' -d '{
  "_async": true,
  "_group": "job/restic",
  "command": "serve",
  "arg": ["restic", "ResticRemote:/"],
  "opt": {
    "addr": ":50001"
  }
}' http://rclone.backup.svc.cluster.local:5572/core/command
```

There are probably a lot of different ways to handle this and I'm sure it's
mostly down to preference. So I won't go into further detail on exactly how my
Job is setup and such, but if you're curious, it's all public on my GitHub repo.

For my machines I wanted to back up, I used Traefik as an ingress for this. This
is where I added things like authentication, certs, and such. Normally I use
Cloudflare to proxy traffic, but in this case I thought it'd be better to not do
that, as I am potentially sending quite a lot of data back and forth and don't
want to have to deal with any potential complications there. I also use both
external-dns and cert-manager, so this was as simple as adding/replacing a few
annotations, to disable proxying and switch to my Let's Encrypt issuer:

```yaml
'external-dns.alpha.kubernetes.io/cloudflare-proxied': 'false'
'cert-manager.io/issuer': 'letsencrypt-prod'
```

From there I was able to start using Restic on my personal machines. I used
resticprofile to do the vast majority of the heavy lifting here. If you would
like to see examples of the profiles I configured, you can check out my
[dotfiles repo](https://github.com/MacroPower/dotfiles).

Moving on to using this infrastructure to actually start backing up PVCs and
such that are also hosted by Kubernetes. First, I installed the k8up Backup
Operator. Note that the `resources` part is required, because they don't include
CRDs in the helm repo. You can also download the CRD and point to the file.
Also, the `BACKUP_GLOBAL_OPERATOR_NAMESPACE` environment variable is important.
It tells any Jobs in other namespaces that they should use the operator from the
`backup` namespace. Obviously you'd want to configure this differently if there
were lots of people using one cluster.

```yaml
helmCharts:
  - name: k8up
    repo: https://k8up-io.github.io/k8up
    version: '4.0.1'
    releaseName: k8up
    namespace: backup
    valuesInline:
      k8up:
        envVars:
          - name: BACKUP_GLOBAL_OPERATOR_NAMESPACE
            value: backup

resources:
  - https://github.com/k8up-io/k8up/releases/download/k8up-4.0.1/k8up-crd.yaml
```

With that installed, now we can use the `Schedule` CR to start backing things
up. While in this configuration, the operator is centralized, the `Schedule` is
not. There should be one CR in each namespace containing things you want to back
up. Here's an example `Schedule` for a `foobar` namespace.

```yaml
apiVersion: k8up.io/v1
kind: Schedule
metadata:
  name: foobar-schedule
  namespace: foobar
spec:
  backend:
    rest:
      url: http://rclone-restic.backup.svc.cluster.local:50001/macropower/foobar
    repoPasswordSecretRef:
      name: restic-credentials
      key: repo-key
  backup:
    schedule: '0 4 * * *' # 04:00
    failedJobsHistoryLimit: 2
    successfulJobsHistoryLimit: 2
  check:
    schedule: '0 1 * * 1' # 01:00 on Monday
    failedJobsHistoryLimit: 2
    successfulJobsHistoryLimit: 2
  prune:
    schedule: '0 1 * * 0' # 00:00 on Monday
    failedJobsHistoryLimit: 2
    successfulJobsHistoryLimit: 2
    retention:
      keepLast: 3
      keepDaily: 7
      keepWeekly: 5
      keepMonthly: 12
```

Note that this `Schedule` has its very own repo to use at `macropower/foobar`, and
also its own encryption key in the `restic-credentials` secret. A different
namespace with its own `Schedule` could have its own repo, credentials, or any
other attributes that aren't configured on the operator.

Once the `Schedule` is created, anything inside the namespace it lives in
(`foobar` in this example) can be backed up via an annotation. For example,
below I have two PVCs, one for `music` and one for `anime`:

```yaml
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: music
  namespace: foobar
  annotations:
    'k8up.io/backup': 'true'
spec:
  # ...

---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: anime
  namespace: foobar
spec:
  # ...
```

`music` has the backup annotation, so it will be backed up every day per our
`Schedule`. However, `anime` does not have this annotation, so it will not be
included in backups.

Here's a diagram showing how everything works together:

![k8up diagram](./k8up.drawio.svg)

## Databases and Other Edge Cases

Lastly, to deal with databases, you of course can't simply backup their PVC.
Thankfully, k8up has a really simple way of addressing databases and basically
any other edge cases. You can add annotations on the Pod itself, and k8up can
run commands inside your containers to collect and backup data. Personally, I
use TimescaleDB which is backed up almost exactly in the same way as Postgres. I
was able to just add the following annotations:

```yaml
podAnnotations:
  'k8up.io/backup': 'true'
  'k8up.io/backupcommand': sh -c 'PGUSER="postgres" PGPASSWORD="$PATRONI_SUPERUSER_PASSWORD" pg_dumpall --clean'
  'k8up.io/file-extension': .sql
```

This just creates a snapshot of the `db.sql` file resulting from the `pg_dump`
command. I am not sure how or even if I could automate restores with Timescale,
because they do require [a bit of extra work][timescale restore] compared to
vanilla Postgres. But, hopefully this isn't something I'll have to do very
often.

## Conclusion

I hope someone found this article helpful. If you would like to see my
exact and up-to-date implementation of everything above, please check out my homelab repo:

- [https://github.com/MacroPower/homelab][homelab]

And of course a huge thanks to the authors of the following projects:

- Restic
- K8up
- resticprofile
- Restic Browser

[timescale restore]: https://docs.timescale.com/timescaledb/latest/how-to-guides/backup-and-restore/pg-dump-and-restore/#restoring-an-entire-database-from-backup
[homelab]: https://github.com/MacroPower/homelab
