+++
categories  = ["Homelab", "Kubernetes", "K8s", "Hardware"]
date        = "2023-04-02"
lastmod     = "2023-04-02 14:00"
type        = ["posts", "post"]
series      = ["My Homelab"]

title = "Building a Twin-ITX Cluster"
description = "Doesn't it seem like a waste of space to have only a single mini-itx system in 1.5U-2U of rack space?"
slug = "building-a-twin-itx-cluster"

keywords = ["Homelab", "Kubernetes", "K8s", "Hardware", "Turing", "Raspberry", "Pi"]
+++

I am building a cluster that includes a [Turing Pi](https://turingpi.com/) (a
mini-ITX cluster board), alongside a normal mini-ITX system. I wanted to put
both of these in a single chassis to save space, which is possible with a "dual
mini-itx", or "twin-itx" chassis. This article covers most of the chassis I
discovered.

As of writing, I have made a purchase (I went with the MyElectronics chassis)
and am waiting for it to arrive. I will eventually be writing another article
covering my exact setup.

## 1U

1U chassis will not fit a Turing Pi. So, I did not evaluate these.

## 1.5U

I gave up on this idea for a couple reasons.

One, we don't yet know whether newer compute modules will fit. CM4s should, but
there's no telling how much clearance will be needed for RK1, etc.

Two, the second system, which I want to be a more normal x86 system, is not
optimized for 1.5U. Next to no fans are going to fit in 1.5U, and fanless are
all optimized for 1U with those loud and awful fans.

For this reason the 2U list is likely more complete.

### OnLogic MK150

**Items**:

- [MK150](https://www.onlogic.com/mk150/)
- [AKDB-MK15X](https://www.onlogic.com/akdb-mk15x/)

**Notes:** Normal mini-itx chassis that can be adapted into a dual-mainboard
chassis.

**Cost:** $202 + $15

### DV Industrial Computer DS12

**Items**:

- [DS12 TWIN](http://inpc.com.ua/data/ds12.html)

**Notes:** Deep but with no hotswap. Thermals make no sense to me.

**Cost:** I have no idea what it costs.

## 2U

### MyElectronics Dual Mini-ITX

**Items**:

- [MyElectronics 6875](https://www.myelectronics.nl/us/19-inch-2u-mini-itx-case-for-dual-mini-itx-short-d.html)

**Notes:** No hotswap, but is short depth. Looks nice, makes sense from a
thermals perspective. Is built specifically for PicoPSU, and a normal PSU will
not fit. Allows you to have front-io even without headers, via adapters that
plug into the back of your system.

**Cost:** ~$295

### S208

**Items**:

- [GeneSys S208B-TWIN-ITX](https://www.genesysgroup.com.tw/s208b-twinitx.htm)
- [PlinkUSA TWIN-ITX-S2082](http://www.plinkusa.net/webTWIN-ITX-S2082.htm)

**Notes:** Hotswap. Nice layout. I reached out via email but could not get in
contact with them.

**Cost:** $290

**Threads:**

- https://forums.servethehome.com/index.php?threads/2u-dual-itx-case.9386/

### Travla / TAWA Series

**Items**:

- [TAWA-T2240](https://www.kiwatek.com/corp/index.php?route=product/product&path=75_78&product_id=62)
- [TAWA-T2241](https://www.kiwatek.com/corp/index.php?route=product/product&path=75_78&product_id=63)
- [TAWA-T2242](https://www.kiwatek.com/corp/index.php?route=product/product&path=75_78&product_id=229)
- [TAWA-T2280](https://www.kiwatek.com/corp/index.php?route=product/product&path=75_78&product_id=230)
- [TAWA-T2900](https://www.kiwatek.com/corp/index.php?route=product/product&path=75_78&product_id=256)

All these are also available under the "Travla" brand [here](https://www.mini-itx.com/store/?c=63).

**Notes:** Number of different options. They tend to have really odd layouts
internally. TAWA-T2900 has all front i/o which is unique.

**Cost:** I have no idea what it costs.

**Threads:**

- https://forums.servethehome.com/index.php?threads/travla-2u-t2280-t2281.10288/
- https://forums.servethehome.com/index.php?threads/dual-itx-cases.8230/
- https://www.reddit.com/r/sffpc/comments/ejek9k/travla_t2241_2u_dual_miniitx_case_19l_with_2x/

### Cablematic CK018

**Items**:

- [Cablematic CK01800](https://cablematic.com/en/products/server-case-rackmount-chassis-19-inch-ipc-mini-itx-2u-4x35-inch-depth-360mm-CK01800/)

**Notes:** Deep but with no hotswap.

**Cost:** ~$125

### RM-2270

**Items**:

- [Circotech RM-2270](https://www.circotech.com/rm-2270-2u-rackmount-case-for-dual-mini-itx-motherboard-system-14-deep.html)
- [KRI RM-2270](https://www.amazon.com/KRI-Rackmount-Chassis-RM-2270-Mini-ITX/dp/B08JNFV99V)

**Notes:** Deep but with no hotswap.

**Cost:** $279

### iStarUSA D-218M2-ITX

**Items**:

- [iStarUSA D-218M2-ITX](http://www.istarusa.com/en/istarusa/products.php?model=D-218M2-ITX)

**Notes:** Deep but with no hotswap. There are some packages you can get that
include PSUs, but they were out of stock when I looked.

**Cost:** ~$130

**Threads:**

- https://forums.servethehome.com/index.php?threads/dual-mitx-rackmount-2u-istarusa-d-218m2-itx.1303/

## Misc Threads and other Articles

- https://www.reddit.com/r/homelab/comments/onfh15/2u4u_dual_itx_case/
- https://www.reddit.com/r/homelab/comments/u7fecx/looking_to_build_a_dual_mini_itx_server_rack/
- https://www.reddit.com/r/homelab/comments/l7ifrb/dual_mini_itx_rackmount_servers/
- https://www.reddit.com/r/homelab/comments/vskcrw/looking_for_unique_case_looking_for_a_rack_mount/
- https://forums.servethehome.com/index.php?threads/looking-for-dual-mini-itx-cases.26835/
- https://forums.servethehome.com/index.php?threads/4-mini-itx-boards-in-1u-chassi.10453/
- https://www.reddit.com/r/homelab/comments/4evfn6/dual_miniitx_rackmount_chassis/
- https://www.reddit.com/r/sffpc/comments/aeldtb/has_anyone_ever_made_a_smallish_itx_dual_system/
- https://www.reddit.com/r/sffpc/comments/hm4sr4/are_there_any_dual_itx_cases/
- https://www.reddit.com/r/sffpc/comments/wjsm4n/any_dual_itx_cases/
- https://www.reddit.com/r/homelab/comments/en84r2/mitx_multi_node_case/
- https://www.reddit.com/r/homelab/comments/u6062c/dual_server_chassis/
