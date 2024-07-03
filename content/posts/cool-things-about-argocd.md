## App of Apps and ApplicationSets

Nothing is stopping you from using Argo Applications to manage other Argo Applications. (Note: This is also true for Flux Kustomizations!) This can be incredibly powerful for defining a set of Applications that are all related, and can be managed together. Or, a set of sets, a set of sets of sets, and so on. This can allow you to bootstrap an entire cluster with one Application, manage common configuration and lifecycles, selectively apply features like pruning and self-healing, and more. ApplicationSets are a native CRD that can make managing these sets of Applications easier at times, and are worth looking into also.

Read more: https://argo-cd.readthedocs.io/en/stable/operator-manual/declarative-setup/#app-of-apps
Read more: https://argo-cd.readthedocs.io/en/stable/operator-manual/applicationset/

## Local Development

ArgoCD has a feature that allows you to sync from a local directory. This is incredibly useful for local development, as it allows you to test changes to your manifests without having to push them to a repository and wait for the sync to happen. You can also diff, dry run, and such. This is especially useful when you're working on a new feature, or when you're trying to debug a problem. Additionally, server side apply can be used in these scenarios for compatibility with validating and mutating webhooks, so you can be immediately informed if your changes will cause your Deployment to violate a security policy, for example, rather than firing for effect.

(Essentially, no need to create a shell script that converts HelmRelease to a kustomization/chart.yaml)

## Multiple Sources

One incredibly cool (beta) feature that ArgoCD offers is the ability to define multiple sources for an Application. This means that you can build a single Application that pulls from multiple repositories, and even use different tools for each. For example, an application can manage a Helm chart from a Helm repository, a Kustomization from a Git repository, and some Jsonnet from a different directory in the same Git repository.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: guestbook
  namespace: argocd
spec:
  project: default
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  sources:
    - chart: elasticsearch
      repoURL: https://helm.elastic.co
      targetRevision: 8.5.1
    - repoURL: https://github.com/argoproj/argocd-example-apps.git
      path: guestbook
      targetRevision: HEAD
    - repoURL: https://github.com/MacroPower/homelab
      path: applications/base/guestbook
      ref: base
      directory:
        include: '*.jsonnet'
        jsonnet:
          libs: [vendor]
      targetRevision: main
```

One other important thing to note, however, is that this feature will not allow you to use local sources as described above, at least for now. Additionally, it's worth thinking about how multiple sources could complicate such a feature. So, at the end of the day, it might be worth considering whether you want to use multiple sources, or the App-of-Apps pattern.

Read more: https://argo-cd.readthedocs.io/en/stable/user-guide/multiple_sources/

## Kustomizing Helm charts

Don't you hate it when you have a Helm chart that you want to use, but it's not quite right? Maybe it's missing a label, or you want to add a sidecar, or you want to change the service type. You could fork the chart, but that's a pain to maintain.

Luckily, you can modify the Kustomize arguments that ArgoCD uses. This means that you can enable Helm support, and then use Kustomize to modify the Helm chart before it's applied.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-cm
  namespace: argocd
data:
  kustomize.buildOptions: --enable-helm --load-restrictor LoadRestrictionsNone
```

Read more: https://argo-cd.readthedocs.io/en/stable/user-guide/kustomize/

## Circular Dependencies

How many times have you found yourself in this situation? You have a new Application you want to add to your cluster, and that Application contains a Deployment that installs CRDs that you want to use. So, you create the Application, it rolls out a Deployment which installs CRDs, and then you implement those CRDs. Cool! But next time you create a new cluster, or just reinstall the application, ArgoCD refuses to sync since the Application contains CRDs that are installed by itself. You could create two seperate Applications to get around this, but that's kind of a pain in many cases! An alternative is setting:

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-options: SkipDryRunOnMissingResource=true
```

What this does is prevent ArgoCD from failing the dry run if the annotated resource is implementing a CRD that does not yet exist. You can then define a particular sync order to ensure that CRDs are installed before the resources that use them, if you don't want to have to potentially re-sync multiple times.

Read more: https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/

## Sync Order

Sometimes resources have dependencies that alter how they are implimented, mutated, and/or validated. For example, a CR may require a CRD to be available, a mutating webhook might have different behavior based on the contents of a ConfigMap, or a validating policy might need an exception applied to allow resources to pass. In these cases, you can use sync phases or waves to ensure that some resources are healthy before others.

```yaml
metadata:
  annotations:
    argocd.argoproj.io/hook: PreSync
```

Read more: https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/

## Why is it Out of Sync???

Sometimes resources are always out of sync with the desired state, which will either break things for a while when you do sync, constantly fight with self-healing, or just be annoying. Many times this is due to something mutating the resource, and not doing so via a mutating webhook (in that case it can be dealt with by using server side apply). In these cases, you can set ignoreDifferences on the Application to tell ArgoCD to ignore certain fields when comparing the live state to the desired state.

```yaml
ignoreDifferences:
  - group: apps
    kind: Deployment
    jsonPointers:
      - /spec/replicas
```

Read more: https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/

A very similar problem can occur when new resources are generated, for example as a response to another resource being created. This is common in multi-cluster setups where Services are automatically copied from cluster to cluster by a service mesh (which results in those resources having annotations that make ArgoCD assume it should manage them). In these cases, you can set the compare-options to IgnoreExtraneous to tell ArgoCD to ignore the resource if it is not in the desired state.

```yaml
metadata:
  annotations:
    argocd.argoproj.io/compare-options: IgnoreExtraneous
```

Read more: https://argo-cd.readthedocs.io/en/stable/user-guide/compare-options/

## Large CRDs

One issue I've run into a lot is certain CRDs ending up too large after the last-applied annotation is added.

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-options: Replace=true
```

Most of the time you can easily write a patch for this:

```yaml
patches:
  - target:
      group: apiextensions.k8s.io
      version: v1
      kind: CustomResourceDefinition
      name: prometheuses.monitoring.coreos.com
    patch: |-
      - op: add
        path: /metadata/annotations
        value:
          'argocd.argoproj.io/sync-options': 'Replace=true'
```
