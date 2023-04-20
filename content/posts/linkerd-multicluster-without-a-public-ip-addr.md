+++
categories  = ["Homelab", "Kubernetes", "K8s"]
date        = "2023-04-03"
lastmod     = "2023-04-20 19:50"
type        = ["posts", "post"]
series      = ["My Homelab"]

title = "Linkerd Multi-cluster Without a Public IP Address"
slug = "linkerd-multicluster-without-a-public-ip-addr"
description = """
Linkerd multi-cluster communication is a great feature, but using it in \
scenarios where one cluster does not have a public IP address can be tricky. \
In this article, I'll cover how I tackled this issue in my homelab. \
"""

keywords = [
  "Homelab", "Kubernetes", "K8s", "Linkerd", "Multi-cluster", "Inlets"
]
+++

Recently, I've set up [Linkerd][linkerd] in my homelab, and one of
the features I was really interested in was [multi-cluster communication][multi-cluster].
This allows you to mirror services between clusters. Meaning, apps in one
cluster can communicate with services in another cluster, as if they were in the
same cluster.

Setting up multi-cluster communication with Linkerd is straightforward under
ideal conditions. However, it can be more challenging if one of the clusters
cannot create services of type `LoadBalancer` (with a public, or otherwise
routable IP address). This is the case for me, as I have clusters both at home
and in Hetzner, with my home Kubernetes cluster running behind NAT.

Fortunately, there are ways to work around this! In this post, I'll walk you
through my design and implementation process, discuss the challenges I faced,
and share the workarounds I came up with to make everything run smoothly.
Additionally, I'll explore some alternative options for multi-cluster
communication and potential improvements to my current setup.

> My exact and up-to-date implementation of everything in this article can be
> found in my homelab repo! https://github.com/MacroPower/homelab

## The Basics

One thing that was not immediately clear to me, when I was following the
[multi-cluster setup docs][multi-cluster] for the first time, was how services
are mirrored bi-directionally between clusters. The docs give examples of how to
link a theoretical "east" cluster to a "west" cluster, which can be done via
this command:

```bash
linkerd --context=east multicluster link --cluster-name east |
  kubectl --context=west apply -f -
```

However, this only allows you to mirror services from the "east" cluster to the
"west" cluster. If you want to mirror services from the "west" cluster to the
"east" cluster, you need to run this command a second time, but in the inverse
order:

```bash
linkerd --context=west multicluster link --cluster-name west |
  kubectl --context=east apply -f -
```

This means that if you want bi-directional mirroring between two clusters, each
cluster needs to have the ability to create services of type `LoadBalancer`,
with an IP address that can be reached by the other cluster.

To say it differently, any clusters acting as a source for service mirrors must
be routable from any destination clusters. If the source isn't routable, you
have to find a way to make it so, regardless of the networking situation on the
other cluster.

## The Recommended Solution

Linkerd's [multi-cluster docs][multi-cluster] recommend looking into
[inlets][inlets-alexellis]. The concept is very cool and also pretty simple.

Basically, in your home / non-routable cluster, you can have a client acting as
a sort of proxy to any local services. The client establishes a tunnel to a
server running somewhere accessible from the cloud / routable cluster. This
means that you should be able to just point Linkerd to the inlets server, and
from there it will be routed to the client, and then to the previously
non-routable Linkerd gateway!

![diagram](https://raw.githubusercontent.com/cubed-it/inlets/master/docs/inlets.png)

However, inlets is no longer the open-source project it once was. The author
stopped maintaining the open-source version a while ago, before eventually
deleting all of the source code. Now, it's available for purchase as a monthly
subscription, with personal licenses starting at $20/month. For me, this is a
completely infeasible price to pay. There are still parts of the project that
are open-source, notably [inlets-operator][inlets-operator], but it spins up an
entire VPS for the tunnel, which we then have to pay for, when we already have a
perfectly good K8s cluster we could be hosting it on.

Luckily, a fork of inlets was created, [cubed-it/inlets][inlets-fork]. This will
allow us to manually create a client in our home / non-routable cluster, and a
server in our cloud / routable cluster. Again, very luckily, the fork adds
support for tunneling TCP ports (as opposed to HTTP), which we will need for
both Linkerd and also the K8s API server.

## My Implementation

Conceptually, what I wanted to do was this:

```text
┌────────────────────────────────────────┐     ┌─────────────────────────────────────────┐
│             Cloud Cluster              │  │  │              Home Cluster               │
│                                        │     │                                         │
│ ┌───────────────┐     ┌─────────────┐  │  │  │ ┌─────────────┐      ┌─────────────┐    │
│ │ Inlets Server │◀────│   Ingress   │◀─┼─────┼─│Inlets Client│──┬──▶│   Linkerd   │──┐ │
│ └───────────────┘     └─────────────┘  │  │  │ └─────────────┘  │   │   Gateway   │  │ │
│         ▲                              │     │                  │   └─────────────┘  │ │
│         ├───────────────────┐          │  │  │                  │   ┌─────────────┐  │ │
│         │                   │          │     │                  └──▶│   K8s API   │  │ │
│         │                   │          │  │  │                      └─────────────┘  │ │
│ ┌───────────────┐ ╔══════════════════╗ │     │                      ╔═════════════╗  │ │
│ │Linkerd Service│ ║      Foobar      ║ │  │  │                      ║   Foobar    ║  │ │
│ │    Mirror     │ ║      Mirror      ║─│─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶║   Service   ║◀─┘ │
│ └───────────────┘ ╚══════════════════╝ │  │  │                      ╚═════════════╝    │
│         │                   ▲          │     │                                         │
│         └────────Creates────┘          │  │  │                                         │
└────────────────────────────────────────┘     └─────────────────────────────────────────┘
```

In this implementation, the inlets client and server is entirely contained
within Kubernetes. This is great, because we don't have to pay anything extra,
and also it's great from a security perspective because the only thing we need
to expose outside the cluster is a single endpoint for the tunnel, which can be
done via our normal ingress.

In this section, I will walk you through my implementation for setting up a
secure tunnel between my home and cloud Kubernetes clusters using inlets. We
will be deploying inlets server and client using Helm charts I created for both
the inlets server and client, which works with [cubed-it/inlets][inlets-fork],
and then addressing some of the challenges encountered with Linkerd during the
process.

First, add a new namespace in every cluster:

```bash
kubectl create namespace inlets
```

And create a secret in every cluster with the same token:

```bash
token=$( head -c 16 /dev/urandom | shasum | cut -d" " -f1 )
kubectl create secret generic linkerd-tunnel-token \
  --from-literal=token=${token}
```

In our cloud cluster, we can use the `inlets-server` chart:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
helmCharts:
  - name: inlets-server
    repo: https://jacobcolvin.com/helm-charts/
    version: "0.1.1"
    releaseName: linkerd-tunnel
    namespace: inlets
    valuesInline:
      inlets:
        # Port is the main port that serves any HTTP traffic.
        # Other TCP ports are assigned on the client.
        port: 4191
        disableTransportWrapping: true
        tokenSecretName: linkerd-tunnel-token

      service:
        data-plane:
          type: ClusterIP
          ports:
            kube:
              port: 6443
              protocol: TCP
            proxy:
              port: 4143
              protocol: TCP
            admin:
              port: 4191
              protocol: TCP

      ingress: {}
      #  main:
      #    enabled: true
      #    hosts:
      #      - host: linkerd-tunnel.example.com
      #        paths:
      #          - path: /
      #            pathType: Prefix
      #    tls:
      #      - hosts: [linkerd-tunnel.example.com]
      #    annotations: {}
```

In our home cluster, we can use the `inlets-client` chart:

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
helmCharts:
  - name: inlets-client
    repo: https://jacobcolvin.com/helm-charts/
    version: "0.1.2"
    releaseName: linkerd-tunnel
    namespace: inlets
    valuesInline:
      inlets:
        # The url points to the ingress of the other cluster.
        url: wss://linkerd-tunnel.example.com
        # Since we don't want to restrict the hostnames the other cluster can
        # use, strictForwarding should be false.
        strictForwarding: false
        tokenSecretName: linkerd-tunnel-token

        # Configure upstreams for Linkerd. Any traffic coming to `match` will
        # be forwarded to `target`. If the `match` value is `tcp:PORT`, the
        # server will automatically create a server listening on that port.
        upstreams:
          - # Accessible on inlets.port / 4191.
            target: http://linkerd-gateway.linkerd-multicluster.svc.cluster.local:4191
          - match: tcp:6443
            target: kubernetes.default.svc.cluster.local:443
          - match: tcp:4143
            target: linkerd-gateway.linkerd-multicluster.svc.cluster.local:4143
```

In _theory_, you would expect to then be able to Link the clusters, just by
overriding the defaults for the gateway and API server addresses:

```bash
linkerd --context=home multicluster link --cluster-name home \
    --gateway-addresses "linkerd-tunnel-data-plane.inlets.svc.cluster.local" --gateway-port 4143 \
    --api-server-address "https://linkerd-tunnel-data-plane.inlets.svc.cluster.local:6443" |
  kubectl --context=cloud apply -f -
```

But this is not the case. There are multiple interactions between the normal
output of `linkerd multicluster link` and the inlets tunnel that need to be
accounted for.

## Fixing the probe-gateway service

First of all, the `linkerd multicluster link` command creates a `probe-gateway`
service, which points to the gateway's health endpoint. However, in this case,
that health endpoint is actually another Kubernetes service. Now, I'm not
confident on exactly why this is, but this is not a configuration that works in
Kubernetes. The `probe-gateway` service will time out every time, even though
the endpoint it points to will work just fine. To work around this issue, we
need to change the `probe-gateway` service so that it's of type `ExternalName`,
with an `externalName` of the inlets server service.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: probe-gateway-home
  namespace: linkerd-multicluster
  labels:
    mirror.linkerd.io/mirrored-gateway: "true"
    mirror.linkerd.io/cluster-name: home
spec:
  type: ExternalName
  externalName: linkerd-tunnel-data-plane.inlets.svc.cluster.local
  ports:
  - name: mc-probe
    port: 4191
    protocol: TCP
```

Once this is done, the `linkerd multicluster link` command will work, and the
`linkerd multicluster check` command will actually succeed as well. However, if
you then create a service mirror, it will not work.

## Fixing the service mirror

The service mirror suffers from the same issue as the probe gateway. It creates
a service that points to the gateway's proxy endpoint, which is another
Kubernetes service. Unfortunately, we can't solve this so easily since the
service mirror is created dynamically by Linkerd. But, we can get around this
issue by changing the way that we expose the gateway's proxy endpoint. Instead
of using a normal service, we can create a `LoadBalancer` service, which is very
annoying, but I couldn't find any better workarounds for it. Note that this
service does not need to be exposed outside the cluster, so don't feel a need to
add a firewall exception or anything like that.

This introduces an additional issue. If we already have a `LoadBalancer` in our
cluster for the gateway (for services being mirrored in the other direction),
we can't reuse the same port.

You can implement all of this by first making a slight modification to the
upstreams declared in the `inlets-client` chart, to remap the ports:

```yaml
upstreams:
  - target: http://linkerd-gateway.linkerd-multicluster.svc.cluster.local:4191
  - match: tcp:6443
    target: kubernetes.default.svc.cluster.local:443
  - match: tcp:6143
    target: linkerd-gateway.linkerd-multicluster.svc.cluster.local:4143
```

And also changing the services declared in the `inlets-server` chart:

```yaml
inlets:
  port: 6191
service:
  data-plane:
    type: ClusterIP
    ports:
      kube:
        port: 6443
        protocol: TCP
      admin:
        port: 6191
        protocol: TCP
  data-plane-lb:
    type: LoadBalancer
    # Add any annotations you need, e.g. for MetalLB.
    annotations: {}
    ports:
      proxy:
        port: 6143
        protocol: TCP
```

And the `probe-gateway` service that we changed, we need to change it again for
the new `mc-probe` port:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: probe-gateway-home
  namespace: linkerd-multicluster
  labels:
    mirror.linkerd.io/mirrored-gateway: "true"
    mirror.linkerd.io/cluster-name: home
spec:
  type: ExternalName
  externalName: linkerd-tunnel-data-plane.inlets.svc.cluster.local
  ports:
  - name: mc-probe
    port: 6191 # <-- The new port.
    protocol: TCP
```

## Meshing the inlets pods

As a bit of a plus, using different ports from `linkerd-proxy` means that we can
mesh the inlets pods themselves. You can do this by adding `linkerd.io/inject:
enabled` to the namespace annotations:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: inlets
  annotations:
    linkerd.io/inject: enabled
```

The only change you will need to make is on the client. You will also need to
skip the Linkerd outbound ports, which you can do by adding the following:

```yaml
podAnnotations:
  config.linkerd.io/skip-outbound-ports: "4143,4191"
```

## Linking the clusters

With all these workarounds in place, the architecture looks like this:

```text
┌──────────────────────────────────────────────────────────┐     ┌─────────────────────────────────────┐
│                      Cloud Cluster                       │  │  │            Home Cluster             │
│                                                          │     │                                     │
│ ┌───────────────┐   ┌───────────────┐   ┌─────────────┐  │  │  │ ┌───────────────┐   ┌─────────────┐ │
│ │ Inlets Server │◀──│ Service: 8123 │◀──│   Ingress   │◀─┼─────┼─│ Inlets Client │──▶│   K8s API   │ │
│ └───────────────┘   └───────────────┘   └─────────────┘  │  │  │ └───────────────┘   └─────────────┘ │
│         ▲                                                │     │         │                           │
│         ├─────────────────┬───────────────────┐          │  │  │         │                           │
│         │                 │                   │          │     │         │                           │
│ ┌───────────────┐ ┌───────────────┐ ┌──────────────────┐ │  │  │         │                           │
│ │    K8s API    │ │Gateway Health │ │  Gateway Proxy   │ │     │         └──────────────────┐        │
│ │ Service: 6443 │ │ Service: 6191 │ │ Private LB: 6143 │ │  │  │                            │        │
│ └───────────────┘ └───────────────┘ └──────────────────┘ │     │                            │        │
│         ▲                 ▲                   ▲          │  │  │                            │        │
│         │                 │                   │          │     │                            ▼        │
│ ┌───────────────┐  ┌─────────────┐  ╔══════════════════╗ │  │  │  ╔═════════════╗    ┌─────────────┐ │
│ │Linkerd Service│  │probe-gateway│  ║      Foobar      ║ │     │  ║   Foobar    ║    │   Linkerd   │ │
│ │    Mirror     │─▶│ExternalName │  ║      Mirror      ║─│─ ┼ ─│─▶║   Service   ║◀───│   Gateway   │ │
│ └───────────────┘  └─────────────┘  ╚══════════════════╝ │     │  ╚═════════════╝    └─────────────┘ │
│                                                          │  │  │                                     │
└──────────────────────────────────────────────────────────┘     └─────────────────────────────────────┘
```

Now we can link the two clusters (but for real this time):

```bash
linkerd --context=home multicluster link --cluster-name home \
    --gateway-addresses "<The address of your LoadBalancer>" --gateway-port 6143 \
    --api-server-address "https://linkerd-tunnel-data-plane.inlets.svc.cluster.local:6443" |
  kubectl --context=cloud apply -f -
```

## Other Options

There are tons of other avenues that could be explored for this. I went down
this particular path because it was recommended in the Linkerd docs. However,
basically any solution that would allow our cloud cluster to talk directly to
our homelab would have worked. For example, setting up something like Wireguard
would also have probably been a very reasonable solution.

There are also other options for multi-cluster communication, besides Linkerd.
However, I believe they will all have the same or worse networking requirements.
For example, some solutions require that all individual nodes be routable across
all clusters.

## Future Work

- I don't think there's any reason why a K8s provisioner couldn't be added to
  [inlets-operator][inlets-operator], which means we wouldn't have to use the
  forked version of inlets.

- There may also be a way to modify the service mirrors created by
  [Linkerd][linkerd], such that they can be directly routed through the tunnel,
  instead of having to hit a LoadBalancer first, e.g. by creating them as type
  `ExternalName`.

## Links

- Linkerd: [https://github.com/linkerd/linkerd2][linkerd]
- Linkerd Multi-Cluster: [https://linkerd.io/2.12/tasks/multicluster/][multi-cluster]
- Inlets: [https://blog.alexellis.io/ingress-for-your-local-kubernetes-cluster/][inlets-alexellis]
- Inlets Operator: [https://github.com/inlets/inlets-operator][inlets-operator]
- Inlets Fork by cubed-it: [https://github.com/cubed-it/inlets][inlets-fork]

And finally, again, if you would like to see my exact and up-to-date
implementation of everything above, check out my homelab repo:

- [https://github.com/MacroPower/homelab][homelab]

[homelab]: https://github.com/MacroPower/homelab
[linkerd]: https://github.com/linkerd/linkerd2
[multi-cluster]: https://linkerd.io/2.12/tasks/multicluster/
[inlets-alexellis]: https://blog.alexellis.io/ingress-for-your-local-kubernetes-cluster/
[inlets-operator]: https://github.com/inlets/inlets-operator
[inlets-fork]: https://github.com/cubed-it/inlets
