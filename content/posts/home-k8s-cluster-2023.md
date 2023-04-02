+++
categories  = ["Homelab", "Kubernetes", "K8s", "Hardware"]
date        = "2020-10-24"
lastmod     = "2020-10-24 17:23"
type        = ["posts", "post"]
series      = ["My Homelab"]

title = "My Kubernetes Cluster - 2023"
description = ""
slug = "home-k8s-cluster-2023"

keywords = ["Homelab", "Kubernetes", "K8s", "Hardware", "Turing", "Raspberry", "Pi"]
+++

## Chassis

#### MyElectronics Dual Mini-ITX

https://www.myelectronics.nl/us/19-inch-2u-mini-itx-case-for-dual-mini-itx-short-d.html

No hotswap but is short depth. Looks nice, makes sense from a thermals
perspective. Is built specifically for PicoPSU.

~$295

## Mainboard

### Supermicro m11sdv-8c+-ln4f

https://www.supermicro.com/en/products/motherboard/m11sdv-8c+-ln4f

https://www.wiredzone.com/shop/product/10028799-supermicro-m11sdv-8c-ln4f-motherboard-mini-itx-with-embedded-3146

https://jorgedelacruz.uk/2022/02/23/supermicro-my-preference-homelab-choice-for-2022-supermicro-a-server-5019d-ftn4/

https://jorgedelacruz.uk/2020/10/05/supermicro-analysis-of-the-best-home-lab-server-2020-supermicro-m11sdv-8c-ln4f/#comment-1723

https://rolando.anton.sh/blog/2020/09/12/home-lab-part-5-the-ultimate-small-form-factor-server-for-home-lab/

It's kind of old, and the price has stayed about the same since it released.
But, the trend seems to have been that old prices stay the same, while newer
stuff gets more expensive. And the specs are still pretty good.

~$800

The memory is normal 204-pin DDR4, so you can
just buy normal memory as opposed trying to get ECC SODIMMs.

https://store.supermicro.com/us_en/64gb-ddr4-3200-mem-dr464l-cl05-er32.html

$190 for 64GB

## Power Supplies

### Picopsu-160-XT

https://www.mini-box.com/picoPSU-160-XT

- https://www.mini-box.com/12v-16A-AC-DC-Power-Adapter

$45 + $60

### Supermicro

https://www.serverparts.pl/en/mcp-180-30202-0n-i9551
http://www.atic.ca/index.php?page=details&psku=296344
https://www.ahead-it.eu/en/shop/hardware/supermicro/spare-parts-1/supermicro-mcp-180-30202-0n-y-split-dc-lockable-input-dc5-5-to-2x4p-40cm-22awg-rohs

https://www.wiredzone.com/shop/product/10025244-supermicro-mcp-250-10133-0n-180w-dc-power-adapter-with-usa-power-cord-10642

https://www.mini-box.com/12v-16A-AC-DC-Power-Adapter

https://forums.servethehome.com/index.php?threads/20-pin-atx-supermicro-pj1-port.24166/

https://forums.servethehome.com/index.php?threads/two-motherboards-with-single-psu.34797/

https://smallformfactor.net/forum/threads/supermicro-embedded-amd-epyc-motherboards.10464/
-> https://smallformfactor.net/forum/threads/project-pure-3l-apu-case-meanwell-support.8588/page-14

https://www.reddit.com/r/homelab/comments/pt273y/how_do_you_power_an_8pin_12v_dc_input_on/
https://www.reddit.com/r/HomeServer/comments/b37xs5/help_with_lack_of_8pin_12v_power/

https://www.mini-box.com/4pin-miniDIN-miniFIT-JR-adapter -> 4 to 8 pin

https://www.mini-box.com/130W-AC-DC-Power-Adapter
https://www.mini-box.com/P4-DC-Jack-Cable

#### Example builds

https://www.asinfo.com/supermicro-superserver/9507-supermicro-superserver-sys-e302-12d-8c.html
https://www.supermicro.com/en/products/chassis/1U/E30/SCE300
https://www.supermicro.com/en/Aplus/system/Embedded/AS-5019D-FTN4.cfm

## Tpi

https://pine64.com/product/soquartz-4gb-compute-module-w/
https://pine64.com/product/64gb-emmc-module/

## Total Cost

### arm64

$150 (1/2 chassis) + $105 (power) + $260 (tpi) + $400 (modules) = ~$915 / system

### x86

$150 (1/2 chassis) + $105 (power) + $800 (soc) + $190 (memory) = ~$1145 / system

### Total

$915 + $1145 = $2060 / 2u 5-node multi-arch cluster

$2060 \* 3 = $6180 / 6u 15-node multi-arch cluster
