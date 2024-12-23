# TrueNAS Multi-Cluster Scaling with Cilium & Liqo

A while ago I made the decision to move all my NAS to TrueNAS SCALE. I knew that I wanted to use TrueNAS for many reasons, but the reason I chose to use SCALE over Core was purely for its integrated K3s instance. For the past few years, I've been moving my entire homelab to Kubernetes, and I figured that if I could define and manage workloads in an identical way everywhere, it'd just make my life easier in the long run.

TrueNAS SCALE presents some unique challenges though. You're given a K3s instance that is overall very "managed", to put it in the most kind way possible. You can adjust the Pod and Service CIDRs, and some other very basic networking things, but that's really it.

One of the most notable things that you _cannot_ do is join the K3s instance to an existing K3s cluster, which was something that I really wanted to accomplish. You could probably hack your way around this, but I ended up moving my main cluster to [Talos]() anyway, so any kind of "native" clustering was out the window at that point.

But, _all hope isn't lost_. There are many different solutions for joining together multiple independent clusters. Many of these require the underlying infrastructure to be identical or at least similar (e.g. requiring the same CNI be used), but others allow you to mix and match your distro and CNI. Both [Submariner](https://submariner.io/) and [Skupper](https://skupper.io/) are solutions that are frequently recommended for this type of situation. A Service Mesh like Linkerd could also work, however I am already using Cilium Service Mesh and did not want to switch or add on any additional layers of complexity here.

However, in this scenario, _solving multi-cluster networking isn't enough_. For example, what if I wanted to install a chart where some of the workloads should be scheduled on one cluster, and some on another? What if I want to run Argo Workflows across multiple clusters? There are some projects that go beyond multi-cluster networking and also play a role in managing workloads across clusters. Some popular options in this space include [OCM](https://open-cluster-management.io/), [Karmada](https://karmada.io/), [Admiralty](https://admiralty.io/), and [Liqo](https://liqo.io/), but there are many others (including fully managed options like Anthos).

Among these projects, some of them seem to focus more on multi-region scenarios where you might have unique but computationally similar clusters in an active/active or active/passive topology (e.g. OCM, Karmada), while others seem to focus more on the edge-computing use case where particular workloads are delegated to specialized clusters (e.g. Admiralty, Liqo). In the case of TrueNAS SCALE, I think the latter is more appropriate.

I decided to try Liqo first, because out of the projects specializing in this heterogeneous edge-compute niche, it seemed to be relatively popular, it has some pretty solid documentation available, and it's based on Wireguard (which has performed quite well for me). Ultimately, many of these projects are similar in that they're based on or take heavy inspiration from Virtual Kubelet.

Liqo ended up being quite easy to install, and has since been working quite well for me. With Liqo, it actually _feels like_ you're working with a single cluster, even though you're actually working with multiple K3s instances under the hood. In spite of my clusters being quite different (Talos/Cilium/v1.30 peering with K3s/Flannel/v1.25), I am able to schedule workloads across them, including some stateful workloads with PVCs, and use pod-to-pod/pod-to-service networking seamlessly. The fact that this experience is possible even with clusters that are so incredibly different is honestly very impressive. 

In my opinion, Liqo is a really fantastic solution for this type of situation where you have some specialized clusters that need to be delegated some specific workloads. For example, I can schedule the oCIS "storage" workloads directly on the NAS with direct access to the storage, while my other cluster handles all of the other oCIS workloads.

Some other things I liked:

- Liqo is fully p2p. You install basically the exact same chart on every cluster you want to peer. There is not a management control plane or any need for both a gateway and agent/client deployment. You control what is and is not shared, differences in naming and CIDRs and such, of course, but the underlying deployments are identical.
- Most aspects of Liqo and its peering configuration are managed via Liqo's CRDs. For example, when you peer clusters via liqoctl, it's creating `ForeignCluster` resources that manage the cluster peering, meaning you can manage peering declaratively. They also have a Terraform provider, which could be nice if you just wanted to bootstrap peering and have all other workloads be managed by the peer.
- It handles edge cases like overlapping IP ranges.
- It handles scheduling, networking, and storage.

```
kubectx admin@home

eval $(liqoctl generate peer-command --only-command --context=nas01)
eval $(liqoctl generate peer-command --only-command --context=nas02)

# home -> https://liqo-auth.nas01.cin.macro.network
# home -> https://liqo-auth.nas02.spr.macro.network
```
